package com.storagecleaner.filecleaner

import com.facebook.react.bridge.*
import java.io.File

class FileScannerModule(reactContext: ReactApplicationContext)
  : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "FileScanner"

  @ReactMethod
  fun scan(path: String, promise: Promise) {
    try {
      val dir = File(path)
      val array = Arguments.createArray()

      if (dir.exists()) {
        dir.listFiles()?.forEach {
          val map = Arguments.createMap()
          map.putString("name", it.name)
          map.putString("path", it.absolutePath)
          map.putDouble("size", it.length().toDouble())
          map.putBoolean("isFile", it.isFile)
          array.pushMap(map)
        }
      }
      promise.resolve(array)
    } catch (e: Exception) {
      promise.reject("ERR", e.message)
    }
  }
}
