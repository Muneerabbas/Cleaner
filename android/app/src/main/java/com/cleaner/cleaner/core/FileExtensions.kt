package com.cleaner.cleaner.core

import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.security.MessageDigest

private const val PARTIAL_HASH_SIZE = 1 * 1024 * 1024 // 1MB
private const val BUFFER_SIZE = 8192

/**
 * Pure Kotlin file extensions. No Android, no React, no View.
 */

fun File.partialHash(): String? = runCatching {
    val digest = MessageDigest.getInstance("MD5")
    val buffer = ByteArray(BUFFER_SIZE)

    if (length() <= PARTIAL_HASH_SIZE * 2) {
        FileInputStream(this).use { stream ->
            var read = stream.read(buffer)
            while (read > 0) {
                digest.update(buffer, 0, read)
                read = stream.read(buffer)
            }
        }
    } else {
        FileInputStream(this).use { stream ->
            var remaining = PARTIAL_HASH_SIZE
            while (remaining > 0) {
                val read = stream.read(buffer, 0, minOf(buffer.size, remaining))
                if (read <= 0) break
                digest.update(buffer, 0, read)
                remaining -= read
            }
        }
        RandomAccessFile(this, "r").use { raf ->
            raf.seek(length() - PARTIAL_HASH_SIZE)
            var remaining = PARTIAL_HASH_SIZE
            while (remaining > 0) {
                val read = raf.read(buffer, 0, minOf(buffer.size, remaining))
                if (read <= 0) break
                digest.update(buffer, 0, read)
                remaining -= read
            }
        }
    }
    digest.digest().joinToString("") { "%02x".format(it) }
}.getOrNull()

/**
 * Returns true if this file is under a protected Android directory
 * (e.g. .../Android/data or .../Android/obb).
 */
fun File.isProtectedAndroidDir(): Boolean =
    PathValidator.isProtectedAndroidPath(absolutePath)
