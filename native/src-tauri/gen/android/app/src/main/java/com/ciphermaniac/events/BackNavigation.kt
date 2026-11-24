package com.ciphermaniac.events

import android.os.Build
import android.webkit.WebView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.activity.ComponentActivity
import androidx.annotation.RequiresApi
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

/**
 * Back as an Android app's: it closes the page's open dialog, sheet or menu
 * first (app_bridge.js), then goes back through the webview's history, and
 * only then leaves the app.
 *
 * On Android 13 and later the app claims back only while there is one of
 * those to do, so on the first page with nothing open the system plays its
 * back-to-home preview. The page says when a layer opens or its history
 * moves, and Rust says when a page starts or finishes loading ([refresh]).
 * Create it before the activity's onCreate.
 */
class BackNavigation(private val activity: ComponentActivity) {
  private var webView: WebView? = null
  private var layerOpen = false
  private var pageCanGoBack = false
  private val system = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) SystemBack(activity, ::back) else null

  fun attach(webView: WebView) {
    this.webView = webView
    refresh()
  }

  /** What the page said: whether a layer is open, and whether its own history can go back. */
  fun onPageState(layer: Boolean, canGoBack: Boolean) {
    layerOpen = layer
    pageCanGoBack = canGoBack
    refresh()
  }

  /** Claims back from the system while there is something for it to do in the app. */
  fun refresh() {
    system?.claimed = layerOpen || pageCanGoBack || webView?.canGoBack() == true
  }

  /** Closes the page's top layer, or goes back a page, or leaves. */
  fun back() {
    val view = webView ?: return leave()
    view.evaluateJavascript(CLOSE_TOP_LAYER) { closed ->
      when {
        closed == "true" -> Unit
        goBack(view) -> Unit
        else -> leave()
      }
    }
  }

  /**
   * Goes back to the last page at another address; false when there is
   * none. That passes over a load that failed under the offline page
   * (OfflinePage.kt), which would only fail again.
   */
  private fun goBack(view: WebView): Boolean {
    val history = view.copyBackForwardList()
    val url = view.url
    val here = history.currentIndex
    val previous = (here - 1 downTo 0).firstOrNull { history.getItemAtIndex(it).url != url } ?: return false
    view.goBackOrForward(previous - here)
    return true
  }

  /** What back does on the first page with nothing open: the system's own back. */
  private fun leave() {
    system?.claimed = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && activity.isTaskRoot) {
      activity.moveTaskToBack(false)
    } else {
      activity.finish()
    }
  }

  private companion object {
    const val CLOSE_TOP_LAYER = "window.__cmBack ? window.__cmBack() : false"
  }
}

/**
 * The app's claim on back with the system, on Android 13 and later. Tauri
 * keeps a back callback of its own (AppPlugin) enabled at all times, and an
 * enabled callback on the activity's back dispatcher would hold back from
 * the system for good, with no back-to-home preview. So once the activity is
 * created, the dispatcher is cut off from the window, and this registers
 * [onBack] with the window only while [claimed].
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class SystemBack(private val activity: ComponentActivity, onBack: () -> Unit) {
  private val callback = OnBackInvokedCallback(onBack)
  private var registered = false

  var claimed = false
    set(value) {
      field = value
      sync()
    }

  init {
    // The dispatcher joins the window on ON_CREATE; this observer comes after its own.
    val dispatcher = activity.onBackPressedDispatcher
    activity.lifecycle.addObserver(
      LifecycleEventObserver { _, event ->
        if (event == Lifecycle.Event.ON_CREATE) {
          dispatcher.setOnBackInvokedDispatcher(CutOff)
        }
      }
    )
  }

  private fun sync() {
    if (claimed == registered) {
      return
    }
    val window = activity.onBackInvokedDispatcher
    if (claimed) {
      window.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback)
    } else {
      window.unregisterOnBackInvokedCallback(callback)
    }
    registered = claimed
  }
}

/** Where the activity's back dispatcher registers, so its callbacks never reach the window. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private object CutOff : OnBackInvokedDispatcher {
  override fun registerOnBackInvokedCallback(priority: Int, callback: OnBackInvokedCallback) = Unit

  override fun unregisterOnBackInvokedCallback(callback: OnBackInvokedCallback) = Unit
}
