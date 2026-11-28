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
import androidx.core.splashscreen.SplashScreenViewProvider
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlin.math.roundToInt
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private val bars = SystemBars(this)
  private lateinit var back: BackNavigation
  private lateinit var files: FileHandoff
  private val pickers = Pickers(this) { value ->
    webView?.evaluateJavascript("window.__cmPicked?.(${JSONObject.quote(value)})", null)
  }
  private var webView: WebView? = null
  private var contentShown = false
  private lateinit var cache: SiteCache
  private var stoppedAt = 0L
  private var splash: SplashScreenViewProvider? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    feel("create")
    holdSplash()
    bars.apply()
    back = BackNavigation(this)
    files = FileHandoff(this)
    cache = SiteCache(this)
    if (savedInstanceState == null) {
      SiteLinks.openAtLaunch(this)
    }
    super.onCreate(savedInstanceState)
    pickers.dropRestored()
  }

  /**
   * A link to the site while the app runs (the activity is singleTask): the
   * page's own router goes there, as a link in the page would
   * (app_bridge.js), and the page loads anew only when it can't.
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val link = SiteLinks.link(intent) ?: return
    val view = webView ?: return
    view.evaluateJavascript("window.__cmOpen ? window.__cmOpen(${JSONObject.quote(link)}) : false") { opened ->
      if (opened != "true") {
        view.loadUrl(link)
      }
    }
  }

  /**
   * Keeps the splash screen over the page until the page has drawn real
   * content (app_bridge.js says so) or the offline page stands in, so no
   * blank page or skeleton shows between them, and gives up after
   * [SPLASH_LIMIT_MS] so a slow network never holds it for good. The splash
   * leaves the system at once and stays as a view on top, so the webview
   * draws beneath it: a webview draws nothing while its window is held back.
   */
  private fun holdSplash() {
    val since = SystemClock.uptimeMillis()
    installSplashScreen().setOnExitAnimationListener { provider ->
      splash = provider
      if (contentShown) {
        reveal()
      } else {
        provider.view.postDelayed(::reveal, maxOf(0L, SPLASH_LIMIT_MS - (SystemClock.uptimeMillis() - since)))
      }
    }
  }

  /** The page has content: the splash fades once the webview has drawn it. */
  private fun onContentShown() {
    feel("shown")
    contentShown = true
    cache.refresh()
    val view = webView
    if (view == null || !WebViewFeature.isFeatureSupported(WebViewFeature.VISUAL_STATE_CALLBACK)) {
      reveal()
      return
    }
    WebViewCompat.postVisualStateCallback(view, 0) { reveal() }
  }

  private fun reveal() {
    val provider = splash ?: return
    splash = null
    feel("revealed")
    provider.view.animate().alpha(0f).setDuration(FADE_MS).withEndAction { provider.remove() }.start()
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
    flushCookies()
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
    // An app's screen doesn't pinch-zoom; its text follows the phone's size instead.
    webView.settings.setSupportZoom(false)
    back.attach(webView)
    OfflinePage.attach(webView, cache) { onContentShown() }
    PageBridge.attach(this, webView, ::onPageMessage)
  }

  private fun onPageMessage(message: JSONObject) {
    when (message.optString("type")) {
      "state" -> {
        back.onPageState(message.optBoolean("layer"), message.optBoolean("back"))
        SiteLinks.keep(this, message.optString("url"))
      }
      "shown" -> onContentShown()
      "cookies" -> flushCookies()
      "keep" -> cache.keep(message)
      "pick" -> pickers.show(message)
      "share" -> files.share(message)
      "save" -> files.save(message)
    }
  }

  /**
   * Writes the webview's cookies to disk as the app leaves the screen. The
   * webview does so only every 30 seconds or so, so an app swiped away soon
   * after signing in would otherwise open signed out.
   */
  override fun onStop() {
    super.onStop()
    stoppedAt = SystemClock.uptimeMillis()
    CookieManager.getInstance().flush()
  }

  /**
   * Back on the screen: the page moves to a newer deploy the app has kept,
   * when it has been away long enough that nothing half typed is lost, and
   * the app looks for a newer one again. At launch the page looks once it
   * shows ([onContentShown]), so the look never slows the launch.
   */
  override fun onStart() {
    super.onStart()
    if (stoppedAt == 0L) {
      return
    }
    if (SystemClock.uptimeMillis() - stoppedAt >= AWAY_MS && cache.isBehind()) {
      webView?.reload()
    }
    cache.refresh()
  }

  /**
   * Writes the webview's cookies to disk off the main thread: after each
   * page load, where a sign-in or sign-out lands, and after the page's own
   * sign-in calls (app_bridge.js), so a stop right after keeps them.
   */
  private fun flushCookies() {
    Thread { CookieManager.getInstance().flush() }.start()
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
    /** Past the launch to a usable page on a slow connection, but no longer. */
    const val SPLASH_LIMIT_MS = 5_000L

    /** The design's middle motion (DESIGN.md). */
    const val FADE_MS = 180L

    /** Away from the screen this long, the page may load a newer deploy on return. */
    const val AWAY_MS = 10 * 60 * 1000L
  }
}
