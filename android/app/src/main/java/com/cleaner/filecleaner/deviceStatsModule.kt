package com.storagecleaner.filecleaner

import android.app.AppOpsManager
import android.app.usage.StorageStatsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Environment
import android.os.StatFs
import android.os.storage.StorageManager
import android.provider.Settings
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import com.facebook.react.bridge.*

class DeviceStatsModule(reactContext: ReactApplicationContext)
  : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "DeviceStats"

  @ReactMethod
  fun getStorageStats(promise: Promise) {
    try {
      val stat = StatFs(Environment.getDataDirectory().path)
      val total = stat.totalBytes.toDouble()
      val free = stat.availableBytes.toDouble()
      val used = total - free

      val map = Arguments.createMap()
      map.putDouble("totalBytes", total)
      map.putDouble("freeBytes", free)
      map.putDouble("usedBytes", used)
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("ERR_STORAGE", e.message)
    }
  }

  @ReactMethod
  fun hasUsageAccess(promise: Promise) {
    try {
      val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        reactApplicationContext.packageName
      )
      promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    } catch (e: Exception) {
      promise.reject("ERR_USAGE_ACCESS", e.message)
    }
  }

  @ReactMethod
  fun openUsageAccessSettings() {
    val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(intent)
  }

  @ReactMethod
  fun openAppInfo(packageName: String) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
    intent.data = Uri.parse("package:$packageName")
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(intent)
  }

  @ReactMethod
  fun openAppUninstall(packageName: String) {
    val intent = Intent(Intent.ACTION_DELETE)
    intent.data = Uri.parse("package:$packageName")
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(intent)
  }

  @ReactMethod
  fun getUnusedApps(days: Int, promise: Promise) {
    try {
      val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        reactApplicationContext.packageName
      )
      if (mode != AppOpsManager.MODE_ALLOWED) {
        promise.reject("NO_USAGE_ACCESS", "Usage access not granted")
        return
      }

      val now = System.currentTimeMillis()
      val start = now - days * 24L * 60L * 60L * 1000L
      val usageStatsManager =
        reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val stats = usageStatsManager.queryUsageStats(
        UsageStatsManager.INTERVAL_DAILY,
        start,
        now
      )

      val lastUsedMap = HashMap<String, Long>()
      stats?.forEach { us ->
        val current = lastUsedMap[us.packageName] ?: 0L
        if (us.lastTimeUsed > current) {
          lastUsedMap[us.packageName] = us.lastTimeUsed
        }
      }

      val pm = reactApplicationContext.packageManager
      val packages = pm.getInstalledPackages(0)
      val array = Arguments.createArray()

      packages.forEach { pkg ->
        val appInfo = pkg.applicationInfo ?: return@forEach
        val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
        if (isSystem) return@forEach

        val lastUsed = lastUsedMap[pkg.packageName] ?: 0L
        if (lastUsed == 0L || lastUsed < start) {
          val map = Arguments.createMap()
          map.putString("packageName", pkg.packageName)
          map.putString("appName", pm.getApplicationLabel(appInfo).toString())
          map.putDouble("lastTimeUsed", lastUsed.toDouble())
          array.pushMap(map)
        }
      }

      promise.resolve(array)
    } catch (e: Exception) {
      promise.reject("ERR_UNUSED_APPS", e.message)
    }
  }

  @ReactMethod
  fun getAppsStorage(promise: Promise) {
    try {
      val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        reactApplicationContext.packageName
      )
      if (mode != AppOpsManager.MODE_ALLOWED) {
        promise.reject("NO_USAGE_ACCESS", "Usage access not granted")
        return
      }

      val pm = reactApplicationContext.packageManager
      val packages = pm.getInstalledPackages(0)
      val storageManager =
        reactApplicationContext.getSystemService(Context.STORAGE_SERVICE) as StorageManager
      val statsManager =
        reactApplicationContext.getSystemService(Context.STORAGE_STATS_SERVICE) as StorageStatsManager
      val uuid = storageManager.getUuidForPath(Environment.getDataDirectory())
      val user = android.os.Process.myUserHandle()

      val array = Arguments.createArray()
      packages.forEach { pkg ->
        val appInfo = pkg.applicationInfo ?: return@forEach
        val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
        if (isSystem) return@forEach

        try {
          val stats = statsManager.queryStatsForPackage(uuid, pkg.packageName, user)
          val map = Arguments.createMap()
          map.putString("packageName", pkg.packageName)
          map.putString("appName", pm.getApplicationLabel(appInfo).toString())
          map.putDouble("appBytes", stats.appBytes.toDouble())
          map.putDouble("dataBytes", stats.dataBytes.toDouble())
          map.putDouble("cacheBytes", stats.cacheBytes.toDouble())
          val icon = try {
            drawableToBase64(pm.getApplicationIcon(appInfo))
          } catch (_: Exception) {
            null
          }
          if (icon != null) {
            map.putString("iconBase64", icon)
          }
          array.pushMap(map)
        } catch (_: Exception) {
          // skip packages we cannot query
        }
      }

      promise.resolve(array)
    } catch (e: Exception) {
      promise.reject("ERR_APPS_STORAGE", e.message)
    }
  }

  private fun drawableToBase64(drawable: Drawable): String? {
    val bitmap = when (drawable) {
      is BitmapDrawable -> drawable.bitmap
      is AdaptiveIconDrawable -> {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        bmp
      }
      else -> {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        bmp
      }
    }
    val output = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
    val bytes = output.toByteArray()
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
  }
}
