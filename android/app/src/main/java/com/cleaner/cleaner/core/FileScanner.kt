package com.cleaner.cleaner.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Scans storage for files. No UI, no React. All work on IO dispatcher.
 * Caller must provide scan roots (e.g. from Context.getExternalFilesDir() or user-selected dirs).
 */
class FileScanner {

    /**
     * Scans all files under the given roots. Emits each file on IO thread.
     */
    fun scanAllFiles(
        roots: List<File>,
        showHidden: Boolean = false,
        skipDir: (File) -> Boolean = { false }
    ): Flow<File> = flow {
        withContext(Dispatchers.IO) {
            roots.forEach { root ->
                DirectoryScanner.scan(
                    root = root,
                    showHidden = showHidden,
                    skipDir = skipDir,
                    onLockedDir = null
                ) { file -> emit(file) }
            }
        }
    }

    /**
     * Collects all files under roots into a list. Runs entirely on IO.
     * Use with care for very large trees; consider streaming via scanAllFiles instead.
     */
    suspend fun scanAllFilesToList(
        roots: List<File>,
        showHidden: Boolean = false,
        skipDir: (File) -> Boolean = { false }
    ): List<FileEntry> = withContext(Dispatchers.IO) {
        val list = mutableListOf<FileEntry>()
        roots.forEach { root ->
            DirectoryScanner.scan(
                root = root,
                showHidden = showHidden,
                skipDir = skipDir
            ) { file ->
                list.add(FileEntry(file.absolutePath, file.length(), file.lastModified()))
            }
        }
        list
    }

    /**
     * Scans for empty directories under roots.
     */
    suspend fun scanEmptyFolders(
        roots: List<File>,
        showHidden: Boolean = false
    ): List<File> = withContext(Dispatchers.IO) {
        val empty = mutableListOf<File>()
        roots.forEach { root ->
            if (!root.exists()) return@forEach
            val stack = ArrayDeque<File>()
            stack.addFirst(root)
            while (stack.isNotEmpty()) {
                val dir = stack.removeFirst()
                if (!dir.isDirectory) continue
                if (!showHidden && dir.isHidden) continue
                if (dir.isProtectedAndroidDir()) continue
                val children = dir.listFiles()?.filter { showHidden || !it.isHidden }.orEmpty()
                if (children.isEmpty()) {
                    empty.add(dir)
                } else {
                    children.filter { it.isDirectory }.forEach { stack.addLast(it) }
                }
            }
        }
        empty
    }
}
