package com.cleaner.cleaner.core

/**
 * Executes cleanup by delegating to a [SafeFileDeleter]. No direct file I/O here.
 * Supports dry-run: when dryRun is true, no delete/move is performed.
 * No UI, no React.
 */
class CleanupExecutor(
    private val deleter: SafeFileDeleter,
    private val pathValidator: PathValidator = PathValidator,
    private val allowedRoots: List<String>
) {

    sealed class Result {
        data class Success(val deletedCount: Int, val failedPaths: List<String>) : Result()
        data class Rejected(val reason: String, val rejectedPaths: List<String>) : Result()
        data class Error(val message: String) : Result()
    }

    /**
     * Deletes or moves to trash the given paths. Paths are validated first.
     * When dryRun is true, returns Success(deletedCount = 0, failedPaths = empty) without calling deleter.
     */
    suspend fun execute(
        paths: List<String>,
        dryRun: Boolean,
        moveToTrash: Boolean
    ): Result {
        val allowed = pathValidator.filterAllowedPaths(paths, allowedRoots)
        if (allowed.size < paths.size) {
            val rejected = paths - allowed.toSet()
            return Result.Rejected("PATH_VALIDATION_FAILED", rejected)
        }
        if (allowed.isEmpty()) {
            return Result.Success(0, emptyList())
        }
        if (dryRun) {
            return Result.Success(0, emptyList())
        }
        return deleter.delete(allowed, moveToTrash)
    }
}

/**
 * Abstraction for actual file deletion/trash. Implemented in Android layer with ContentResolver.
 */
interface SafeFileDeleter {
    suspend fun delete(paths: List<String>, moveToTrash: Boolean): CleanupExecutor.Result
}
