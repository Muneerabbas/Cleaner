package com.cleaner.cleaner.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Detects duplicate files by size then content hash (partial). No UI, no React.
 * All hashing runs on IO dispatcher to avoid blocking main thread.
 */
class DuplicateDetector(
    private val chunkSize: Int = 100
) {
    private val hashCache = ConcurrentHashMap<String, String>()

    /**
     * Groups files by size, then hashes same-size candidates and returns groups of duplicates.
     * deepSearch for images is not implemented here (no perceptual hash) to keep core dependency-free.
     */
    suspend fun detectDuplicates(
        files: List<FileEntry>,
        forceRefresh: Boolean = false
    ): List<List<FileEntry>> = withContext(Dispatchers.IO) {
        val entries = files.filter { entry ->
            val f = File(entry.path)
            f.exists() && f.isFile && f.canRead() && !f.isProtectedAndroidDir()
        }
        val groupsBySize = entries.groupBy { it.size }.filter { it.value.size > 1 }
        if (groupsBySize.isEmpty()) return@withContext emptyList()

        val candidates = groupsBySize.values.flatten()
        val hashed = coroutineScope {
            candidates.chunked(chunkSize).map { chunk ->
                async {
                    chunk.mapNotNull { entry ->
                        val file = File(entry.path)
                        val key = "partial:${entry.path}:${entry.modified}"
                        val hash = hashCache[key] ?: file.partialHash()?.also { hashCache[key] = it }
                        hash?.let { it to entry }
                    }
                }
            }.awaitAll().flatten()
        }
        hashed.groupBy({ it.first }, { it.second })
            .values
            .filter { it.size > 1 }
            .toList()
    }
}
