package com.ciphermaniac.events

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.annotation.Keep
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import kotlin.math.roundToInt
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private val bars = SystemBars(this)
  private lateinit var back: BackNavigation
  private lateinit var files: FileHandoff
  private var webView: WebView? = null
  private var pageLoaded = false

  override fun onCreate(savedInstanceState: Bundle?) {
    feel("create")
    holdSplash()
    bars.apply()
    back = BackNavigation(this)
    files = FileHandoff(this)
    if (savedInstanceState == null) {
      SiteLinks.openAtLaunch(this)
    }
    super.onCreate(savedInstanceState)
  }

  /** A link to the site while the app runs (the activity is singleTask). */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    SiteLinks.link(intent)?.let { webView?.loadUrl(it) }
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
    feel("pageStarted")
    back.refresh()
  }

  /** Called from Rust (android.rs) when the main window's page has loaded. */
  @Keep
  fun onMainPageFinished() {
    feel("pageFinished")
    pageLoaded = true
    back.refresh()
  }

  /** Called from Rust (shell.rs) with a sign-in that has to leave the webview. */
  @Keep
  fun openSignIn(url: String) {
    SignInTab.open(this, url)
  }

  override fun onWebViewCreate(webView: WebView) {
    feel("webView")
    this.webView = webView
    bars.attach()
    followFontScale(webView)
    back.attach(webView)
    OfflinePage.attach(webView)
    PageBridge.attach(this, webView, ::onPageMessage)
  }

  private fun onPageMessage(message: JSONObject) {
    when (message.optString("type")) {
      "state" -> back.onPageState(message.optBoolean("layer"), message.optBoolean("back"))
      "share" -> files.share(message)
      "save" -> files.save(message)
    }
  }

  /**
   * Writes the webview's cookies to disk as the app leaves the screen. The
   * webview does so only now and then, so an app swiped away soon after
   * signing in would otherwise open signed out.
   */
  override fun onStop() {
    super.onStop()
    CookieManager.getInstance().flush()
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

  /** Audit timing (native/android-feel-audit only): wall-clock milliseconds for feel.mjs. */
  private fun feel(what: String) {
    Log.i("Feel", "$what ${System.currentTimeMillis()}")
  }

  private companion object {
    /** The desktop window's limit too (shell.rs, SHOW_WITHIN). */
    const val SPLASH_LIMIT_MS = 3_000L
  }
}
