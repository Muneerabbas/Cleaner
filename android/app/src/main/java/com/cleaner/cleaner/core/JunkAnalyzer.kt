package com.cleaner.cleaner.core

import java.io.File

/**
 * Classifies files as junk (cache, temp, etc.) by path and extension. No UI, no React.
 */
object JunkAnalyzer {

    private val TEMP_EXTENSIONS = setOf("tmp", "temp", "bak", "swp", "~", "cache")
    private val CACHE_DIR_NAMES = setOf("cache", "Cache", ".cache", "caches")
    private val JUNK_DIR_NAMES = setOf("temp", "tmp", "Temp", "TMP", ".tmp", ".temp")

    enum class JunkCategory {
        CACHE,
        TEMP,
        LOG,
        APK_LEFTOVER,
        OTHER_JUNK,
        NOT_JUNK
    }

    fun classify(file: File): JunkCategory {
        val path = file.absolutePath
        val name = file.name
        val ext = name.substringAfterLast('.', "").lowercase()

        if (ext in TEMP_EXTENSIONS) return JunkCategory.TEMP
        if (name.endsWith(".log") || name.endsWith(".log.1")) return JunkCategory.LOG
        if (ext == "apk" && name.lowercase().contains("base") && path.contains("cache")) return JunkCategory.APK_LEFTOVER

        val pathSegments = path.split(File.separatorChar).map { it.lowercase() }
        if (pathSegments.any { it in CACHE_DIR_NAMES.map(String::lowercase) }) return JunkCategory.CACHE
        if (pathSegments.any { it in JUNK_DIR_NAMES.map(String::lowercase) }) return JunkCategory.TEMP

        return JunkCategory.NOT_JUNK
    }

    fun isJunk(file: File): Boolean = classify(file) != JunkCategory.NOT_JUNK
}
