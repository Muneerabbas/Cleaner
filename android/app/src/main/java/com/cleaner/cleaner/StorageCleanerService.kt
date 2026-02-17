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
import java.io.File

/**
 * Single entry point for all storage cleaning. No UI, no React references.
 * Uses Application context only for ContentResolver and storage roots.
 * All heavy work on Dispatchers.IO.
 */
class StorageCleanerService(private val context: Context) {

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
}

private fun File.isProtectedAndroidDir(): Boolean = PathValidator.isProtectedAndroidPath(absolutePath)
