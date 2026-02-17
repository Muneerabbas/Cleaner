package com.cleaner.cleaner

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.Arguments
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CleanerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "CleanerModule"
    }

    private val service = StorageCleanerService(reactContext.applicationContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun getName(): String = "CleanerModule"

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }

    /**
     * Returns true if we have enough storage permission to scan files.
     * Android 11+: MANAGE_EXTERNAL_STORAGE
     * Android 10: requestLegacyExternalStorage + READ_EXTERNAL_STORAGE
     * Android <10: READ_EXTERNAL_STORAGE
     */
    @ReactMethod
    fun hasStoragePermission(promise: Promise) {
        try {
            promise.resolve(checkStoragePermission())
        } catch (e: Exception) {
            promise.reject("PERMISSION_ERROR", e.message, e)
        }
    }

    /**
     * Opens the system settings to grant MANAGE_EXTERNAL_STORAGE (Android 11+)
     * or the app settings (older).
     */
    @ReactMethod
    fun openManageStorageSettings(promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No current activity")
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                    data = Uri.parse("package:${reactApplicationContext.packageName}")
                }
                activity.startActivity(intent)
            } else {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${reactApplicationContext.packageName}")
                }
                activity.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun scanAllFiles(promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                Log.d(TAG, "scanAllFiles: starting scan")
                val list = withContext(Dispatchers.IO) { service.scanAllFiles() }
                Log.d(TAG, "scanAllFiles: found ${list.size} files")
                promise.resolve(toWritableArray(list))
            } catch (e: Exception) {
                Log.e(TAG, "scanAllFiles error", e)
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun scanLargeFiles(minSizeBytes: Double, limit: Double, promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val limitInt = if (limit > 0) limit.toInt() else null
                val list = withContext(Dispatchers.IO) {
                    service.scanLargeFiles(minSizeBytes.toLong(), limitInt)
                }
                Log.d(TAG, "scanLargeFiles: found ${list.size} files")
                promise.resolve(toWritableArray(list))
            } catch (e: Exception) {
                Log.e(TAG, "scanLargeFiles error", e)
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun detectDuplicates(promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val groups = withContext(Dispatchers.IO) { service.detectDuplicates() }
                val arr = Arguments.createArray()
                groups.forEach { group ->
                    arr.pushArray(toWritableArray(group))
                }
                Log.d(TAG, "detectDuplicates: found ${groups.size} groups")
                promise.resolve(arr)
            } catch (e: Exception) {
                Log.e(TAG, "detectDuplicates error", e)
                promise.reject("DUPLICATE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun scanJunk(promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val list = withContext(Dispatchers.IO) { service.scanJunk() }
                Log.d(TAG, "scanJunk: found ${list.size} junk files")
                promise.resolve(toWritableArray(list))
            } catch (e: Exception) {
                Log.e(TAG, "scanJunk error", e)
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun scanEmptyFolders(promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val list = withContext(Dispatchers.IO) { service.scanEmptyFolders() }
                val arr = Arguments.createArray()
                list.forEach { arr.pushString(it) }
                Log.d(TAG, "scanEmptyFolders: found ${list.size}")
                promise.resolve(arr)
            } catch (e: Exception) {
                Log.e(TAG, "scanEmptyFolders error", e)
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun scanCompressibleFiles(minSizeBytes: Double, limit: Double, promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val limitInt = if (limit > 0) limit.toInt() else null
                val list = withContext(Dispatchers.IO) {
                    service.scanCompressibleFiles(minSizeBytes.toLong(), limitInt)
                }
                Log.d(TAG, "scanCompressibleFiles: found ${list.size}")
                promise.resolve(toWritableArray(list))
            } catch (e: Exception) {
                Log.e(TAG, "scanCompressibleFiles error", e)
                promise.reject("COMPRESS_SCAN_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getTrashFiles(promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val list = withContext(Dispatchers.IO) { service.getTrashFiles() }
                Log.d(TAG, "getTrashFiles: found ${list.size}")
                promise.resolve(toWritableArray(list))
            } catch (e: Exception) {
                Log.e(TAG, "getTrashFiles error", e)
                promise.reject("TRASH_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun cleanup(paths: ReadableArray, dryRun: Boolean, moveToTrash: Boolean, promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val pathList = (0 until paths.size()).map { paths.getString(it) ?: "" }.filter { it.isNotEmpty() }
                val result = withContext(Dispatchers.IO) {
                    service.cleanup(pathList, dryRun, moveToTrash)
                }
                val map = Arguments.createMap()
                when (result) {
                    is com.cleaner.cleaner.core.CleanupExecutor.Result.Success -> {
                        map.putString("status", "success")
                        map.putInt("deletedCount", result.deletedCount)
                        val failed = Arguments.createArray()
                        result.failedPaths.forEach { failed.pushString(it) }
                        map.putArray("failedPaths", failed)
                    }
                    is com.cleaner.cleaner.core.CleanupExecutor.Result.Rejected -> {
                        map.putString("status", "rejected")
                        map.putString("reason", result.reason)
                        val rejected = Arguments.createArray()
                        result.rejectedPaths.forEach { rejected.pushString(it) }
                        map.putArray("rejectedPaths", rejected)
                    }
                    is com.cleaner.cleaner.core.CleanupExecutor.Result.Error -> {
                        map.putString("status", "error")
                        map.putString("message", result.message)
                    }
                }
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "cleanup error", e)
                promise.reject("CLEANUP_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun restoreFromTrash(paths: ReadableArray, promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val pathList = (0 until paths.size()).map { paths.getString(it) ?: "" }.filter { it.isNotEmpty() }
                val restored = withContext(Dispatchers.IO) { service.restoreFromTrash(pathList) }
                val arr = Arguments.createArray()
                restored.forEach { arr.pushString(it) }
                promise.resolve(arr)
            } catch (e: Exception) {
                Log.e(TAG, "restoreFromTrash error", e)
                promise.reject("RESTORE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun compressFiles(paths: ReadableArray, archiveName: String?, promise: Promise) {
        scope.launch {
            if (!ensurePermission(promise)) return@launch
            try {
                val pathList = (0 until paths.size()).map { paths.getString(it) ?: "" }.filter { it.isNotEmpty() }
                val out = withContext(Dispatchers.IO) {
                    service.compressFiles(pathList, archiveName)
                }
                val map = Arguments.createMap().apply {
                    putString("archivePath", out.archivePath)
                    putInt("sourceFileCount", out.sourceFileCount)
                    putDouble("sourceBytes", out.sourceBytes.toDouble())
                    putDouble("archiveBytes", out.archiveBytes.toDouble())
                    val skipped = Arguments.createArray()
                    out.skippedPaths.forEach { skipped.pushString(it) }
                    putArray("skippedPaths", skipped)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "compressFiles error", e)
                promise.reject("COMPRESS_ERROR", e.message, e)
            }
        }
    }

    private fun checkStoragePermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager()
        }
        return ContextCompat.checkSelfPermission(
            reactApplicationContext,
            Manifest.permission.READ_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun ensurePermission(promise: Promise): Boolean {
        if (!checkStoragePermission()) {
            promise.reject("NO_PERMISSION", "Storage permission not granted. Call hasStoragePermission() and openManageStorageSettings() first.")
            return false
        }
        return true
    }

    private fun toWritableArray(entries: List<com.cleaner.cleaner.core.FileEntry>): com.facebook.react.bridge.WritableArray {
        val arr = Arguments.createArray()
        entries.forEach { e ->
            val map = Arguments.createMap()
            map.putString("path", e.path)
            map.putDouble("size", e.size.toDouble())
            map.putDouble("modified", e.modified.toDouble())
            arr.pushMap(map)
        }
        return arr
    }
}
