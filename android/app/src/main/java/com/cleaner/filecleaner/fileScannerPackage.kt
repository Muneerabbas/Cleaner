package com.storagecleaner.filecleaner

import com.facebook.react.*
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

class FileScannerPackage : ReactPackage {
  override fun createNativeModules(rc: ReactApplicationContext)
    = listOf(
      FileScannerModule(rc),
      DeviceStatsModule(rc),
    )

  override fun createViewManagers(rc: ReactApplicationContext)
    = emptyList<ViewManager<*, *>>()
}
