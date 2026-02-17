package com.cleaner.devicestats

import android.app.AppOpsManager
import android.app.usage.StorageStatsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Process
import android.os.StatFs
import android.os.storage.StorageManager
import android.provider.Settings
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.UUID

class DeviceStatsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "DeviceStatsModule"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun getName(): String = "DeviceStats"

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }

    // ───── Storage Stats ─────

    @ReactMethod
    fun getStorageStats(promise: Promise) {
        try {
            @Suppress("DEPRECATION")
            val path = Environment.getExternalStorageDirectory()
            val stat = StatFs(path.absolutePath)
            val total = stat.blockSizeLong * stat.blockCountLong
            val free = stat.blockSizeLong * stat.availableBlocksLong
            val used = total - free

            val map = Arguments.createMap()
            map.putDouble("totalBytes", total.toDouble())
            map.putDouble("freeBytes", free.toDouble())
            map.putDouble("usedBytes", used.toDouble())
            promise.resolve(map)
        } catch (e: Exception) {
            Log.e(TAG, "getStorageStats error", e)
            promise.reject("STORAGE_ERROR", e.message, e)
        }
    }

    // ───── Usage Access ─────

    @ReactMethod
    fun hasUsageAccess(promise: Promise) {
        try {
            val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            @Suppress("DEPRECATION")
            val mode = appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                reactApplicationContext.packageName
            )
            promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
        } catch (e: Exception) {
            Log.e(TAG, "hasUsageAccess error", e)
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openUsageAccessSettings() {
        try {
            val activity = reactApplicationContext.currentActivity
            // Try to open directly to this app's usage access entry
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                reactApplicationContext.startActivity(intent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "openUsageAccessSettings error", e)
            // Fallback: open general app settings
            try {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${reactApplicationContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(fallback)
            } catch (e2: Exception) {
                Log.e(TAG, "openUsageAccessSettings fallback error", e2)
            }
        }
    }

    // ───── App Info / Uninstall ─────

    @ReactMethod
    fun openAppInfo(packageName: String) {
        try {
            val activity = reactApplicationContext.currentActivity ?: return
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "openAppInfo error", e)
        }
    }

    @ReactMethod
    fun openAppUninstall(packageName: String) {
        try {
            val activity = reactApplicationContext.currentActivity ?: return
            val intent = Intent(Intent.ACTION_DELETE).apply {
                data = Uri.parse("package:$packageName")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "openAppUninstall error", e)
        }
    }

    // ───── Unused Apps ─────

    @ReactMethod
    fun getUnusedApps(days: Double, promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { findUnusedApps(days.toInt()) }
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "getUnusedApps error", e)
                promise.reject("UNUSED_ERROR", e.message, e)
            }
        }
    }

    private fun findUnusedApps(days: Int): com.facebook.react.bridge.WritableArray {
        val arr = Arguments.createArray()
        val ctx = reactApplicationContext
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return arr
        val now = System.currentTimeMillis()
        val cutoff = now - days.toLong() * 24 * 60 * 60 * 1000

        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_YEARLY, cutoff, now)
        val lastUsed = mutableMapOf<String, Long>()
        stats?.forEach { s ->
            val existing = lastUsed[s.packageName] ?: 0L
            if (s.lastTimeUsed > existing) {
                lastUsed[s.packageName] = s.lastTimeUsed
            }
        }

        val pm = ctx.packageManager
        val installed = pm.getInstalledApplications(PackageManager.GET_META_DATA)
        installed.forEach { appInfo ->
            if (appInfo.flags and ApplicationInfo.FLAG_SYSTEM != 0) return@forEach
            val pkg = appInfo.packageName
            if (pkg == ctx.packageName) return@forEach
            val last = lastUsed[pkg] ?: 0L
            if (last < cutoff) {
                val map = Arguments.createMap()
                map.putString("packageName", pkg)
                map.putString("appName", pm.getApplicationLabel(appInfo).toString())
                map.putDouble("lastTimeUsed", last.toDouble())
                arr.pushMap(map)
            }
        }
        return arr
    }

    // ───── Apps Storage ─────

    @ReactMethod
    fun getAppsStorage(promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { collectAppsStorage() }
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "getAppsStorage error", e)
                promise.reject("APPS_STORAGE_ERROR", e.message, e)
            }
        }
    }

    private fun collectAppsStorage(): com.facebook.react.bridge.WritableArray {
        val arr = Arguments.createArray()
        val ctx = reactApplicationContext
        val pm = ctx.packageManager
        val installed = pm.getInstalledApplications(PackageManager.GET_META_DATA)

        val ssm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.getSystemService(Context.STORAGE_STATS_SERVICE) as? StorageStatsManager
        } else null

        val sm = ctx.getSystemService(Context.STORAGE_SERVICE) as? StorageManager
        val uuid = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            sm?.getUuidForPath(Environment.getDataDirectory()) ?: StorageManager.UUID_DEFAULT
        } else null

        installed.forEach { appInfo ->
            if (appInfo.flags and ApplicationInfo.FLAG_SYSTEM != 0) return@forEach
            val pkg = appInfo.packageName
            try {
                val map = Arguments.createMap()
                map.putString("packageName", pkg)
                map.putString("appName", pm.getApplicationLabel(appInfo).toString())

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && ssm != null && uuid != null) {
                    val storageStats = ssm.queryStatsForPackage(uuid, pkg, Process.myUserHandle())
                    map.putDouble("appBytes", storageStats.appBytes.toDouble())
                    map.putDouble("dataBytes", storageStats.dataBytes.toDouble())
                    map.putDouble("cacheBytes", storageStats.cacheBytes.toDouble())
                } else {
                    map.putDouble("appBytes", 0.0)
                    map.putDouble("dataBytes", 0.0)
                    map.putDouble("cacheBytes", 0.0)
                }

                try {
                    val icon = pm.getApplicationIcon(pkg)
                    val bitmap = when (icon) {
                        is BitmapDrawable -> icon.bitmap
                        else -> {
                            val bmp = Bitmap.createBitmap(
                                icon.intrinsicWidth.coerceAtLeast(1),
                                icon.intrinsicHeight.coerceAtLeast(1),
                                Bitmap.Config.ARGB_8888
                            )
                            val canvas = Canvas(bmp)
                            icon.setBounds(0, 0, canvas.width, canvas.height)
                            icon.draw(canvas)
                            bmp
                        }
                    }
                    val scaled = Bitmap.createScaledBitmap(bitmap, 48, 48, true)
                    val baos = ByteArrayOutputStream()
                    scaled.compress(Bitmap.CompressFormat.PNG, 80, baos)
                    map.putString("iconBase64", Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP))
                } catch (_: Exception) {
                    map.putNull("iconBase64")
                }

                arr.pushMap(map)
            } catch (e: Exception) {
                Log.w(TAG, "Skip $pkg: ${e.message}")
            }
        }
        return arr
    }
}
