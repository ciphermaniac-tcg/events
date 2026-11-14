package com.ciphermaniac.events

import android.content.res.Configuration
import android.os.Bundle
import android.os.SystemClock
import android.webkit.WebView
import androidx.annotation.Keep
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import kotlin.math.roundToInt
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private val bars = SystemBars(this)
  private lateinit var back: BackNavigation
  private var webView: WebView? = null
  private var pageLoaded = false

  override fun onCreate(savedInstanceState: Bundle?) {
    holdSplash()
    bars.apply()
    back = BackNavigation(this)
    super.onCreate(savedInstanceState)
  }

  /**
   * Keeps the splash screen up until the first page has loaded, as the
   * desktop window stays hidden until then, and gives up after the same
   * [SPLASH_LIMIT_MS] so a slow network never holds it for good.
   */
  private fun holdSplash() {
    val since = SystemClock.uptimeMillis()
    installSplashScreen().setKeepOnScreenCondition {
      !pageLoaded && SystemClock.uptimeMillis() - since < SPLASH_LIMIT_MS
    }
  }

  /** Called from Rust (android.rs) when the main window starts loading a page. */
  @Keep
  fun onMainPageStarted() {
    back.refresh()
  }

  /** Called from Rust (android.rs) when the main window's page has loaded. */
  @Keep
  fun onMainPageFinished() {
    pageLoaded = true
    back.refresh()
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    bars.attach()
    followFontScale(webView)
    back.attach(webView)
    PageBridge.attach(this, webView, ::onPageMessage)
  }

  private fun onPageMessage(message: JSONObject) {
    when (message.optString("type")) {
      "state" -> back.onPageState(message.optBoolean("layer"), message.optBoolean("back"))
    }
  }

  // Back before Android 13. From 13 on the system calls BackNavigation instead.
  @Deprecated("Back reaches the app through OnBackInvokedCallback from Android 13 on")
  override fun onBackPressed() {
    back.back()
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

  private companion object {
    /** The desktop window's limit too (shell.rs, SHOW_WITHIN). */
    const val SPLASH_LIMIT_MS = 3_000L
  }
}
