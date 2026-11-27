package com.ciphermaniac.events

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONException
import org.json.JSONObject

/**
 * The channel between the site and the activity: a script (res/raw/
 * app_bridge.js) that runs first on each of the site's pages, and the
 * `cmNative` object it posts messages to. Only the site's own origin gets
 * either, so no other page the webview opens can reach the activity.
 */
object PageBridge {
  const val SITE_ORIGIN = "https://botan.tail843dce.ts.net:4600"
  private const val TAG = "PageBridge"

  /** Runs the script on the site's pages and hands their main frame's messages to [onMessage]. */
  @SuppressLint("RequiresFeature") // Both features are checked first.
  fun attach(context: Context, webView: WebView, onMessage: (JSONObject) -> Unit) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
      !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    ) {
      Log.w(TAG, "this webview can't run the site's bridge")
      return
    }
    val script = context.resources.openRawResource(R.raw.app_bridge).bufferedReader().use { it.readText() }
    WebViewCompat.addWebMessageListener(webView, "cmNative", setOf(SITE_ORIGIN)) { _, message, _, isMainFrame, _ ->
      val data = message.data
      if (isMainFrame && data != null) {
        parse(data)?.let(onMessage)
      }
    }
    WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(SITE_ORIGIN))
  }

  private fun parse(data: String): JSONObject? =
    try {
      JSONObject(data)
    } catch (err: JSONException) {
      Log.w(TAG, "a message from the page wasn't JSON", err)
      null
    }
}
