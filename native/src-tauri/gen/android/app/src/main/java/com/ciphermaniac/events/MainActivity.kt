package com.ciphermaniac.events

import android.content.res.Configuration
import android.os.Bundle
import android.webkit.WebView
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  private val bars = SystemBars(this)
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    bars.apply()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    bars.attach()
    followFontScale(webView)
  }

  // The manifest keeps the activity through a switch between light and dark
  // and a change of font size (configChanges has uiMode and fontScale), so
  // the bars and the page's text follow here.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    bars.apply()
    webView?.let(::followFontScale)
  }

  /** The page's text at the size set for the whole phone, which a webview ignores unless told. */
  private fun followFontScale(webView: WebView) {
    webView.settings.textZoom = (resources.configuration.fontScale * 100).roundToInt()
  }
}
