package com.cleaner.cleaner.core

import java.io.File

/**
 * Lightweight representation of a discovered file.
 * No UI, no Android View, no React.
 */
data class FileEntry(
    val path: String,
    val size: Long = 0L,
    val modified: Long = 0L
) {
    fun toFile(): File = File(path)
}
