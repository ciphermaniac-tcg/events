package com.ciphermaniac.events

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.util.Log
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.Keep
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * The app's own page when the site can't be reached (offline.rs), in place
 * of the webview's error page, as on Windows and Linux. It stands in for the
 * page that failed and goes back to it on Retry, or by itself when the
 * connection comes back.
 */
object OfflinePage {
  private const val TAG = "OfflinePage"

  /** Catches the main frame's failed loads, once wry's client is in place, and calls [onShown] as it stands in. */
  @SuppressLint("RequiresFeature") // Checked first.
  fun attach(webView: WebView, onShown: () -> Unit) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.GET_WEB_VIEW_CLIENT)) {
      Log.w(TAG, "this webview can't show the offline page")
      return
    }
    // wry sets its client after onWebViewCreate, in the same task.
    webView.post { webView.webViewClient = Client(WebViewCompat.getWebViewClient(webView), onShown) }
  }

  /** The page for [url] from Rust (offline.rs), or null when the webview's own stays. */
  @Keep
  @JvmStatic
  private external fun page(url: String): String?

  /**
   * wry's client (RustWebViewClient), with the offline page on a failed
   * load. It hands wry every call wry overrides, so this list follows wry's.
   */
  private class Client(private val wry: WebViewClient, private val onShown: () -> Unit) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
      wry.shouldInterceptRequest(view, request)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
      wry.shouldOverrideUrlLoading(view, request)

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = wry.onPageStarted(view, url, favicon)

    override fun onPageFinished(view: WebView, url: String) = wry.onPageFinished(view, url)

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      wry.onReceivedError(view, request, error)
      if (!request.isForMainFrame) {
        return
      }
      val url = request.url.toString()
      page(url)?.let {
        view.loadDataWithBaseURL(url, it, "text/html", "utf-8", url)
        onShown()
      }
    }
  }
}
