package com.cleaner.cleaner.core

import java.io.File

/**
 * Validates file paths for cleanup operations.
 * No UI, no Android View, no React. Pure logic.
 * Protects against system folder deletion and dangerous paths.
 */
object PathValidator {

    private val DANGEROUS_SEGMENTS = setOf(
        "android", "data", "obb", "system", "vendor", "root",
        "cache", "dalvik-cache", "recovery", "boot", "efi",
        "proc", "sys", "dev", "acct", "config", "mnt"
    )

    private val PROTECTED_ANDROID_SUBPATHS = setOf("data", "obb")

    /**
     * Returns true if the path is under a protected Android app directory
     * (e.g. .../Android/data or .../Android/obb). Such paths must not be deleted.
     */
    fun isProtectedAndroidPath(path: String): Boolean {
        val segments = path.split(File.separatorChar).filter { it.isNotEmpty() }
        segments.forEachIndexed { index, segment ->
            if (segment.equals("Android", ignoreCase = true)) {
                val next = segments.getOrNull(index + 1)?.lowercase()
                if (next in PROTECTED_ANDROID_SUBPATHS) return true
            }
        }
        return false
    }

    /**
     * Returns true if the path is a system or dangerous root-level directory.
     */
    fun isDangerousRootPath(path: String): Boolean {
        val normalized = File(path).absolutePath
        val segments = normalized.split(File.separatorChar).filter { it.isNotEmpty() }
        if (segments.isEmpty()) return true
        val first = segments.first().lowercase()
        return first in setOf("system", "vendor", "data", "root", "proc", "sys", "dev", "acct", "config", "mnt", "cache", "recovery", "boot", "efi")
    }

    /**
     * Returns true if the path is allowed for scanning/deletion given the allowed roots.
     * If allowedRoots is empty, only validates that path is not dangerous (no scope check).
     */
    fun isPathAllowed(path: String, allowedRoots: List<String>): Boolean {
        if (isProtectedAndroidPath(path)) return false
        if (isDangerousRootPath(path)) return false
        val canonical = try {
            File(path).canonicalPath
        } catch (e: Exception) {
            return false
        }
        if (allowedRoots.isEmpty()) return true
        return allowedRoots.any { root ->
            canonical == root || canonical.startsWith(root + File.separatorChar)
        }
    }

    /**
     * Filters a list of paths to only those allowed for cleanup.
     * Logs (via callback) any rejected paths for debugging.
     */
    fun filterAllowedPaths(
        paths: List<String>,
        allowedRoots: List<String>,
        onRejected: ((path: String, reason: String) -> Unit)? = null
    ): List<String> {
        return paths.filter { path ->
            when {
                isProtectedAndroidPath(path) -> {
                    onRejected?.invoke(path, "PROTECTED_ANDROID")
                    false
                }
                isDangerousRootPath(path) -> {
                    onRejected?.invoke(path, "DANGEROUS_ROOT")
                    false
                }
                !isPathAllowed(path, allowedRoots) -> {
                    onRejected?.invoke(path, "OUTSIDE_ALLOWED_ROOTS")
                    false
                }
                else -> true
            }
        }
    }
}
