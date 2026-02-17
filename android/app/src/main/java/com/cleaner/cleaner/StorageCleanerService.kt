package com.cleaner.cleaner

import android.content.Context
import android.os.Environment
import com.cleaner.cleaner.core.CleanupExecutor
import com.cleaner.cleaner.core.DuplicateDetector
import com.cleaner.cleaner.core.FileEntry
import com.cleaner.cleaner.core.FileScanner
import com.cleaner.cleaner.core.JunkAnalyzer
import com.cleaner.cleaner.core.PathValidator
import com.cleaner.cleaner.core.TrashHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Single entry point for all storage cleaning. No UI, no React references.
 * Uses Application context only for ContentResolver and storage roots.
 * All heavy work on Dispatchers.IO.
 */
class StorageCleanerService(private val context: Context) {
    data class CompressionResult(
        val archivePath: String,
        val sourceFileCount: Int,
        val sourceBytes: Long,
        val archiveBytes: Long,
        val skippedPaths: List<String>
    )

    private val fileScanner = FileScanner()
    private val duplicateDetector = DuplicateDetector()
    private val trashPaths = mutableSetOf<String>()

    private val allowedRoots: List<String>
        get() = getStorageRoots().map { it.absolutePath }.filter { PathValidator.isPathAllowed(it, emptyList()) }

    /**
     * Returns scan roots: app-specific external dir first, then legacy external storage if available.
     * Android 10+: getExternalFilesDir is always available; getExternalStorageDirectory may be restricted.
     */
    private fun getStorageRoots(): List<File> {
        val list = mutableListOf<File>()
        context.getExternalFilesDir(null)?.takeIf { it.exists() }?.let { list.add(it) }
        @Suppress("DEPRECATION")
        try {
            val external = Environment.getExternalStorageDirectory()
            if (external.exists() && external !in list) list.add(external)
        } catch (_: Exception) { }
        return list
    }

    /**
     * Scan all files under allowed roots. Runs on IO.
     */
    suspend fun scanAllFiles(showHidden: Boolean = false): List<FileEntry> =
        withContext(Dispatchers.IO) {
            val roots = getStorageRoots().filter { it.exists() }
            fileScanner.scanAllFilesToList(roots, showHidden) { dir ->
                TrashHelper.isTrashed(dir)
            }
        }

    /**
     * Scan for large files (>= minSizeBytes). Runs on IO.
     */
    suspend fun scanLargeFiles(minSizeBytes: Long = 100L * 1024 * 1024, limit: Int? = null): List<FileEntry> =
        withContext(Dispatchers.IO) {
            val all = scanAllFiles()
            val filtered = all.filter { it.size >= minSizeBytes }
                .sortedByDescending { it.size }
            if (limit != null) filtered.take(limit) else filtered
        }

    /**
     * Scan for files that are good candidates for compression.
     * Skips already compressed/archive formats.
     */
    suspend fun scanCompressibleFiles(minSizeBytes: Long = 10L * 1024 * 1024, limit: Int? = 500): List<FileEntry> =
        withContext(Dispatchers.IO) {
            val nonCompressible = setOf(
                "zip", "rar", "7z", "gz", "bz2", "xz", "zst",
                "jpg", "jpeg", "png", "webp", "heic", "gif",
                "mp4", "mkv", "avi", "mov", "mp3", "aac", "flac",
                "apk", "aab", "iso", "pdf"
            )
            val all = scanAllFiles()
            val filtered = all
                .filter { it.size >= minSizeBytes }
                .filter { entry ->
                    val ext = File(entry.path).extension.lowercase(Locale.US)
                    ext !in nonCompressible
                }
                .sortedByDescending { it.size }
            if (limit != null) filtered.take(limit) else filtered
        }

    /**
     * Detect duplicate file groups. Runs on IO (hashing).
     */
    suspend fun detectDuplicates(): List<List<FileEntry>> =
        withContext(Dispatchers.IO) {
            val files = scanAllFiles()
            duplicateDetector.detectDuplicates(files)
        }

    /**
     * Scan for junk (cache, temp). Runs on IO.
     */
    suspend fun scanJunk(): List<FileEntry> =
        withContext(Dispatchers.IO) {
            val files = scanAllFiles()
            files.filter { JunkAnalyzer.isJunk(File(it.path)) }
        }

    /**
     * Scan empty folders. Runs on IO.
     */
    suspend fun scanEmptyFolders(): List<String> =
        withContext(Dispatchers.IO) {
            val roots = getStorageRoots().filter { it.exists() }
            fileScanner.scanEmptyFolders(roots).map { it.absolutePath }
        }

    /**
     * Get trashed files (files with .trashed- prefix under roots).
     */
    suspend fun getTrashFiles(): List<FileEntry> =
        withContext(Dispatchers.IO) {
            val roots = getStorageRoots().filter { it.exists() }
            val list = mutableListOf<FileEntry>()
            roots.forEach { root ->
                scanForTrashedFiles(root) { file -> list.add(FileEntry(file.absolutePath, file.length(), file.lastModified())) }
            }
            list
        }

    private fun scanForTrashedFiles(root: File, onFile: (File) -> Unit) {
        if (!root.exists()) return
        val stack = ArrayDeque<File>()
        stack.add(root)
        while (stack.isNotEmpty()) {
            val current = stack.removeLast()
            current.listFiles()?.forEach { child ->
                when {
                    TrashHelper.isTrashed(child) -> onFile(child)
                    child.isDirectory && !child.isProtectedAndroidDir() -> stack.add(child)
                }
            }
        }
    }

    /**
     * Delete or move to trash. Validates paths, supports dry-run. Runs on IO.
     */
    suspend fun cleanup(
        paths: List<String>,
        dryRun: Boolean,
        moveToTrash: Boolean
    ): CleanupExecutor.Result = withContext(Dispatchers.IO) {
        val deleter = AndroidFileDeleter(
            contentResolver = context.contentResolver,
            trashOriginalPaths = trashPaths,
            onTrashSizeChange = { }
        )
        val executor = CleanupExecutor(deleter, PathValidator, allowedRoots)
        executor.execute(paths, dryRun, moveToTrash)
    }

    /**
     * Restore files from trash to their original paths (or Downloads if unknown).
     */
    suspend fun restoreFromTrash(paths: List<String>): List<String> =
        withContext(Dispatchers.IO) {
            val toRestore = paths.map { File(it) }.filter { it.exists() }
            val restored = mutableListOf<String>()
            @Suppress("DEPRECATION")
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            toRestore.forEach { file ->
                val originalPath = synchronized(trashPaths) { TrashHelper.resolveOriginalPath(file, trashPaths) }
                val dest = originalPath?.let { File(it) } ?: File(downloadsDir, file.name)
                dest.parentFile?.takeIf { !it.exists() }?.mkdirs()
                if (file.renameTo(dest)) {
                    synchronized(trashPaths) { originalPath?.let { trashPaths.remove(it) } }
                    restored.add(dest.absolutePath)
                }
            }
            restored
        }

    /**
     * Compress selected files into a single zip archive under Downloads/CleanerCompressed.
     */
    suspend fun compressFiles(paths: List<String>, archiveName: String? = null): CompressionResult =
        withContext(Dispatchers.IO) {
            val allowed = PathValidator.filterAllowedPaths(paths, allowedRoots)
                .map { File(it) }
                .filter { it.exists() && it.isFile }

            if (allowed.isEmpty()) {
                throw IllegalArgumentException("No valid files selected for compression.")
            }

            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val safeName = (archiveName?.trim()?.ifEmpty { null } ?: "cleaner_archive_$timestamp")
                .replace(Regex("[^A-Za-z0-9._-]"), "_")
            val finalName = if (safeName.endsWith(".zip", ignoreCase = true)) safeName else "$safeName.zip"

            @Suppress("DEPRECATION")
            val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val outDir = File(downloads, "CleanerCompressed").apply { mkdirs() }
            val outFile = File(outDir, finalName)

            val usedEntryNames = mutableSetOf<String>()
            var sourceBytes = 0L
            val skipped = mutableListOf<String>()

            ZipOutputStream(FileOutputStream(outFile)).use { zos ->
                allowed.forEachIndexed { idx, file ->
                    val entryName = uniqueZipEntryName(file.name, idx, usedEntryNames)
                    val zipEntry = ZipEntry(entryName).apply { time = file.lastModified() }
                    try {
                        zos.putNextEntry(zipEntry)
                        BufferedInputStream(FileInputStream(file)).use { input ->
                            val buf = ByteArray(DEFAULT_BUFFER_SIZE)
                            while (true) {
                                val read = input.read(buf)
                                if (read <= 0) break
                                zos.write(buf, 0, read)
                            }
                        }
                        zos.closeEntry()
                        sourceBytes += file.length()
                    } catch (_: Exception) {
                        skipped.add(file.absolutePath)
                        runCatching { zos.closeEntry() }
                    }
                }
            }

            CompressionResult(
                archivePath = outFile.absolutePath,
                sourceFileCount = allowed.size - skipped.size,
                sourceBytes = sourceBytes,
                archiveBytes = outFile.length(),
                skippedPaths = skipped
            )
        }
}

private fun File.isProtectedAndroidDir(): Boolean = PathValidator.isProtectedAndroidPath(absolutePath)

private fun uniqueZipEntryName(baseName: String, index: Int, used: MutableSet<String>): String {
    if (baseName !in used) {
        used.add(baseName)
        return baseName
    }
    val dot = baseName.lastIndexOf('.')
    val name = if (dot > 0) baseName.substring(0, dot) else baseName
    val ext = if (dot > 0) baseName.substring(dot) else ""
    var n = index + 1
    while (true) {
        val candidate = "${name}_$n$ext"
        if (candidate !in used) {
            used.add(candidate)
            return candidate
        }
        n += 1
    }
}
