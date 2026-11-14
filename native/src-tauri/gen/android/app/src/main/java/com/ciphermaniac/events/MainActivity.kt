package com.ciphermaniac.events

import android.content.res.Configuration
import android.os.Bundle
import android.webkit.WebView

class MainActivity : TauriActivity() {
  private val bars = SystemBars(this)

  override fun onCreate(savedInstanceState: Bundle?) {
    bars.apply()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    bars.attach()
  }

  // The manifest keeps the activity through a switch between light and dark
  // (configChanges has uiMode), so the bars follow the new mode here.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    bars.apply()
  }
}
