package com.ciphermaniac.events

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Base64
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * The app's own copy of the site's page, served in place of the network for
 * the site's routes, so a launch draws without waiting a round trip for the
 * page. Nothing here reaches a browser: it sits in the app's webview client
 * (OfflinePage.kt).
 *
 * The page is the same for every route the site has; it is kept with the
 * headers that guard it, and served while the phone is online. Offline, and
 * before there is a copy, the webview asks the network as ever, so the
 * offline page still stands in. The built files the page loads are left to
 * the webview's own cache, which keeps them a year and runs them fastest.
 *
 * Each launch the copy serves, the live page is fetched a few seconds after
 * the page shows ([refresh]), and on each return to the screen; a new deploy
 * replaces the copy for the next launch. A launch whose look didn't finish
 * leaves a mark, and the next launch then loads from the site, so a deploy
 * always reaches the app within one launch.
 *
 * Only the page is kept, which is the same for everyone: no data, no write,
 * no sign-in and nothing per request goes through here.
 */
class SiteCache private constructor(context: Context) {
  private val root = File(context.noBackupFilesDir, "site")
  private val shell = File(root, "shell.json")
  private val owed = File(root, "look-owed")
  private val worker = Executors.newSingleThreadScheduledExecutor()
  private val connectivity = context.getSystemService(ConnectivityManager::class.java)
  private val agent by lazy { WebSettings.getDefaultUserAgent(context) }
  private var refreshedAt = 0L

  /** The response for [request] from the copy, or null for the webview to fetch. */
  fun intercept(request: WebResourceRequest): WebResourceResponse? {
    // Test builds only (native/android-m3-test): the feel audit measures launches without the copy.
    if (File(root.parentFile, "site-off").exists()) {
      return null
    }
    val url = request.url
    val routed = request.method == "GET" && request.isForMainFrame && "${url.scheme}://${url.authority}" == SITE
    return if (routed && ROUTES.matches(url.path.orEmpty())) page() else null
  }

  /**
   * Fetches the live page behind the copy, off the main thread, a few
   * seconds on so the page's own first reads go first, at most once a minute.
   */
  @Synchronized
  fun refresh() {
    val at = System.currentTimeMillis()
    if (at - refreshedAt < REFRESH_EVERY_MS) {
      return
    }
    refreshedAt = at
    worker.schedule({ store() }, SETTLE_MS, TimeUnit.MILLISECONDS)
  }

  /** The kept page with its headers, or null to fail closed to the network. */
  private fun page(): WebResourceResponse? {
    if (!online() || owed.exists()) {
      return null
    }
    val kept = runCatching { JSONObject(shell.readText()) }.getOrNull() ?: return null
    val response = runCatching {
      val headers = kept.getJSONObject("headers")
      response(Base64.decode(kept.getString("html"), Base64.DEFAULT), headers.keys().asSequence().associateWith { headers.getString(it) })
    }.getOrNull() ?: return null
    write(owed, ByteArray(0))
    return response
  }

  /** Keeps the live page when it is a new deploy, with its headers, in one write. */
  private fun store() {
    val live = fetch("$SITE/") ?: return
    if (live.status != HttpURLConnection.HTTP_OK || !live.mime.startsWith("text/html") || !live.html.contains("/assets/")) {
      return
    }
    val headers = live.headers.filterKeys { it.lowercase() in KEPT_HEADERS }
    val version = sha(live.html + headers.entries.firstOrNull { it.key.equals(CSP_HEADER, ignoreCase = true) }?.value.orEmpty())
    if (version != runCatching { JSONObject(shell.readText()).getString("version") }.getOrNull()) {
      val kept = JSONObject()
        .put("version", version)
        .put("headers", JSONObject(headers))
        .put("html", Base64.encodeToString(live.html.toByteArray(), Base64.NO_WRAP))
      if (!write(shell, kept.toString().toByteArray())) {
        return
      }
    }
    owed.delete()
  }

  /** Whether the phone has a network that reaches the internet. */
  private fun online(): Boolean =
    connectivity?.getNetworkCapabilities(connectivity.activeNetwork)
      ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true

  private class Fetched(val status: Int, val mime: String, val headers: Map<String, String>, val html: String)

  /** The site's page, following no redirect, or null when it can't be reached. */
  private fun fetch(url: String): Fetched? =
    try {
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = CONNECT_MS
      connection.readTimeout = READ_MS
      connection.setRequestProperty("User-Agent", agent)
      connection.setRequestProperty("Cache-Control", "no-cache")
      val status = connection.responseCode
      val body = (if (status < HttpURLConnection.HTTP_BAD_REQUEST) connection.inputStream else connection.errorStream)
        ?.use { String(it.readBytes()) }.orEmpty()
      val headers = connection.headerFields.filterKeys { it != null }.mapValues { it.value.joinToString(", ") }
      Fetched(status, connection.contentType.orEmpty(), headers, body)
    } catch (err: IOException) {
      Log.i(TAG, "out of reach: $url (${err.javaClass.simpleName})")
      null
    }

  private fun response(html: ByteArray, headers: Map<String, String>) =
    WebResourceResponse("text/html", "utf-8", HttpURLConnection.HTTP_OK, "OK", headers, ByteArrayInputStream(html))

  /** Writes whole or not at all; true when written. */
  private fun write(file: File, bytes: ByteArray): Boolean {
    val part = File(file.parentFile, "${file.name}.${System.nanoTime()}.part")
    return try {
      file.parentFile?.mkdirs()
      part.writeBytes(bytes)
      part.renameTo(file).also { if (!it) part.delete() }
    } catch (err: IOException) {
      part.delete()
      Log.w(TAG, "could not keep ${file.name}", err)
      false
    }
  }

  private fun sha(text: String) =
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

  companion object {
    private const val TAG = "SiteCache"
    private val SITE = PageBridge.SITE_ORIGIN
    private const val CONNECT_MS = 8_000
    private const val READ_MS = 15_000
    private const val REFRESH_EVERY_MS = 60_000L
    private const val SETTLE_MS = 5_000L
    private const val CSP_HEADER = "Content-Security-Policy"

    /** The site's routes (src/main.tsx), each answered with the same page. */
    private val ROUTES = Regex(
      "/(|host|host/[^/]+|t/[^/]+|settings|sign-in|create-account|account|history|u/[^/]+|apply|welcome|" +
        "privacy|terms|admin|stores/[^/]+|stores/[^/]+/settings)"
    )

    /** The headers that guard the page (static/_headers), kept with it; the rest change with each answer. */
    private val KEPT_HEADERS = setOf(
      "content-security-policy", "x-content-type-options", "referrer-policy", "permissions-policy", "x-frame-options",
      "strict-transport-security"
    )

    @Volatile private var only: SiteCache? = null

    /** The app's one copy, shared by every activity the process makes. */
    fun of(context: Context): SiteCache =
      only ?: synchronized(this) { only ?: SiteCache(context.applicationContext).also { only = it } }
  }
}
