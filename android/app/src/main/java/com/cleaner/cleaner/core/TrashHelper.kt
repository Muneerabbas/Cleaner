package com.cleaner.cleaner.core

import java.io.File

/**
 * Trash naming and path resolution. No UI, no React.
 */
object TrashHelper {
    const val TRASHED_PREFIX = ".trashed-"
    private val trailingIndexRegex = Regex("(.+)-\\d+$")

    fun isTrashed(file: File): Boolean = file.name.startsWith(TRASHED_PREFIX)

    fun buildTrashedName(originalName: String, index: Int = 0): String {
        val suffix = if (index <= 0) "" else "-$index"
        return "$TRASHED_PREFIX$originalName$suffix"
    }

    fun deriveOriginalNameCandidates(trashedName: String): List<String> {
        val stripped = trashedName.removePrefix(TRASHED_PREFIX)
        val candidates = mutableListOf(stripped)
        val match = trailingIndexRegex.matchEntire(stripped)
        if (match != null) {
            candidates.add(match.groupValues[1])
        }
        return candidates.distinct()
    }

    fun resolveOriginalPath(trashedFile: File, originalPaths: Set<String>): String? {
        val parent = trashedFile.parentFile ?: return null
        val candidates = deriveOriginalNameCandidates(trashedFile.name)
        candidates.forEach { candidateName ->
            val candidatePath = File(parent, candidateName).absolutePath
            if (candidatePath in originalPaths) return candidatePath
        }
        candidates.forEach { candidateName ->
            val matches = originalPaths.filter { File(it).name == candidateName }
            if (matches.size == 1) return matches.first()
        }
        return File(parent, candidates.first()).absolutePath
    }
}
