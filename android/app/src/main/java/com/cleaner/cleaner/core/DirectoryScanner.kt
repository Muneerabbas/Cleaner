package com.cleaner.cleaner.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Recursively scans directories. No UI, no Android View, no React.
 * Skips protected Android dirs and optionally hidden files.
 * All I/O is designed to be called from background threads.
 */
object DirectoryScanner {

    suspend fun scan(
        root: File,
        showHidden: Boolean = false,
        skipDir: (File) -> Boolean = { false },
        onLockedDir: ((File) -> Unit)? = null,
        onFile: suspend (File) -> Unit
    ) = withContext(Dispatchers.IO) {
        if (!root.exists()) return@withContext
        val iterator = root.walkTopDown()
            .onEnter { dir ->
                if ((!showHidden && dir.isHidden) || skipDir(dir)) {
                    if (dir.isProtectedAndroidDir()) onLockedDir?.invoke(dir)
                    return@onEnter false
                }
                if (dir.isProtectedAndroidDir()) {
                    onLockedDir?.invoke(dir)
                    return@onEnter false
                }
                true
            }
            .iterator()

        while (iterator.hasNext()) {
            val file = iterator.next()
            if (file.isFile && (showHidden || !file.isHidden)) {
                onFile(file)
            }
        }
    }

    fun scanSync(
        root: File,
        showHidden: Boolean = false,
        skipDir: (File) -> Boolean = { false },
        onFile: (File) -> Unit
    ) {
        if (!root.exists()) return
        root.walkTopDown()
            .onEnter { dir ->
                if ((!showHidden && dir.isHidden) || skipDir(dir)) return@onEnter false
                if (dir.isProtectedAndroidDir()) return@onEnter false
                true
            }
            .filter { it.isFile && (showHidden || !it.isHidden) }
            .forEach { onFile(it) }
    }
}
