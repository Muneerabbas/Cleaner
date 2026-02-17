package com.cleaner.cleaner

import android.content.ContentResolver
import android.content.ContentUris
import android.os.Build
import android.provider.MediaStore
import com.cleaner.cleaner.core.CleanupExecutor
import com.cleaner.cleaner.core.TrashHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Android implementation of SafeFileDeleter. Uses ContentResolver for MediaStore fallback (Android 10+).
 * All I/O on IO dispatcher. No UI references.
 */
class AndroidFileDeleter(
    private val contentResolver: ContentResolver,
    private val trashOriginalPaths: MutableSet<String>,
    private val onTrashSizeChange: (Long) -> Unit
) : com.cleaner.cleaner.core.SafeFileDeleter {

    override suspend fun delete(paths: List<String>, moveToTrash: Boolean): CleanupExecutor.Result =
        withContext(Dispatchers.IO) {
            val files = paths.map { File(it) }.filter { it.exists() }
            if (moveToTrash) {
                moveToTrash(files)
                CleanupExecutor.Result.Success(deletedCount = files.size, failedPaths = emptyList())
            } else {
                val results = deleteFiles(files)
                val failed = results.filter { !it.success }.map { it.file.absolutePath }
                val successCount = results.count { it.success }
                results.filter { it.success }.sumOf { it.deletedBytes }.let { if (it > 0) onTrashSizeChange(-it) }
                CleanupExecutor.Result.Success(deletedCount = successCount, failedPaths = failed)
            }
        }

    private fun deleteFiles(files: Collection<File>): List<FileDeletionResult> {
        val results = mutableListOf<FileDeletionResult>()
        files.forEach { file ->
            val originalSize = file.captureSize()
            val success = runCatching {
                when {
                    !file.exists() -> false
                    file.deleteRecursively() -> true
                    else -> {
                        val uri = resolveMediaStoreUri(file)
                        uri != null && contentResolver.delete(uri, null, null) > 0
                    }
                }
            }.getOrDefault(false)
            results.add(FileDeletionResult(file, success, originalSize))
        }
        return results
    }

    private fun moveToTrash(files: List<File>) {
        files.forEach { file ->
            if (file.exists() && !TrashHelper.isTrashed(file)) {
                val destination = createTrashedDestination(file)
                val originalPath = file.absolutePath
                if (file.renameTo(destination)) {
                    synchronized(trashOriginalPaths) { trashOriginalPaths.add(originalPath) }
                    onTrashSizeChange(file.length())
                }
            }
        }
    }

    private fun createTrashedDestination(file: File): File {
        val parent = file.parentFile ?: return file
        var index = 0
        var destination = File(parent, TrashHelper.buildTrashedName(file.name, index))
        while (destination.exists()) {
            index++
            destination = File(parent, TrashHelper.buildTrashedName(file.name, index))
        }
        return destination
    }

    private fun File.captureSize(): Long {
        if (!exists()) return 0L
        return runCatching {
            if (isFile) length() else walkTopDown().filter { it.isFile }.sumOf { it.length() }
        }.getOrDefault(0L)
    }

    private fun resolveMediaStoreUri(file: File) = run {
        val volume = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.VOLUME_EXTERNAL else "external"
        val collection = MediaStore.Files.getContentUri(volume)
        val projection = arrayOf(MediaStore.Files.FileColumns._ID)
        val selection = "${MediaStore.Files.FileColumns.DATA}=?"
        val selectionArgs = arrayOf(file.absolutePath)
        contentResolver.query(collection, projection, selection, selectionArgs, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID))
                ContentUris.withAppendedId(collection, id)
            } else null
        }
    }
}

private data class FileDeletionResult(val file: File, val success: Boolean, val deletedBytes: Long)
