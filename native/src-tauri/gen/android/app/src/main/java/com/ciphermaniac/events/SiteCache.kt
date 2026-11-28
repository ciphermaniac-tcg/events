package com.ciphermaniac.events

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
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
 * Only a launch's first page comes from the copy; a reload, such as the
 * site's own recovery after a deploy, goes to the site. A launch the copy
 * serves leaves a mark; a few seconds after the page shows ([refresh]),
 * and on each return to the screen, the live page is fetched. A new deploy
 * is kept marked, so the next launch loads it from the site, which fills
 * the webview's cache with its files before the copy serves it; the mark
 * goes only when a launch that drew the site's page finds the live page is
 * the one kept and kept no new deploy itself. A launch whose look didn't
 * finish, or that only reached the offline page, leaves its mark too,
 * so a deploy always reaches the app within one launch.
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
  private var refreshedAt: Long? = null
  private var launchServed = false
  @Volatile private var siteShown = false

  // The worker's alone.
  private var deployKept = false

  /** The response for [request] from the copy, or null for the webview to fetch. */
  fun intercept(request: WebResourceRequest): WebResourceResponse? {
    val url = request.url
    val routed = request.method == "GET" && request.isForMainFrame && "${url.scheme}://${url.authority}" == SITE
    return if (routed && ROUTES.matches(url.path.orEmpty())) launchPage() else null
  }

  /** The site's page drew in this process (app_bridge.js), so the webview's cache holds what it loads. */
  fun onSiteShown() {
    siteShown = true
  }

  /**
   * Fetches the live page behind the copy, off the main thread, a few
   * seconds on so the page's own first reads go first, at most once a minute.
   */
  @Synchronized
  fun refresh() {
    val at = SystemClock.elapsedRealtime()
    if (refreshedAt?.let { at - it < REFRESH_EVERY_MS } == true) {
      return
    }
    refreshedAt = at
    worker.schedule({ store() }, SETTLE_MS, TimeUnit.MILLISECONDS)
  }

  /**
   * The kept page with its headers for a launch's first page, or null to
   * fail closed to the network. It serves only once its mark is down.
   */
  @Synchronized
  private fun launchPage(): WebResourceResponse? {
    val first = !launchServed
    launchServed = true
    if (!first || !online() || owed.exists()) {
      return null
    }
    val kept = runCatching { JSONObject(shell.readText()) }.getOrNull() ?: return null
    val response = runCatching {
      val headers = kept.getJSONObject("headers")
      response(Base64.decode(kept.getString("html"), Base64.DEFAULT), headers.keys().asSequence().associateWith { headers.getString(it) })
    }.getOrNull() ?: return null
    return response.takeIf { write(owed, ByteArray(0)) }
  }

  /**
   * When the live page is a new deploy, marks it first, then keeps it with
   * its headers in one write; when it is the one kept, lifts the mark, once
   * the site's page has drawn and unless this launch kept a new deploy.
   */
  private fun store() {
    val live = fetch("$SITE/") ?: return
    if (live.status != HttpURLConnection.HTTP_OK || !live.mime.lowercase().startsWith("text/html") || !live.html.contains("/assets/")) {
      return
    }
    val headers = live.headers.filterKeys { it.lowercase() in KEPT_HEADERS }.mapKeys { it.key.lowercase() }.toSortedMap()
    val version = sha(live.html + headers)
    if (version != runCatching { JSONObject(shell.readText()).getString("version") }.getOrNull()) {
      val kept = JSONObject()
        .put("version", version)
        .put("headers", JSONObject(headers as Map<*, *>))
        .put("html", Base64.encodeToString(live.html.toByteArray(), Base64.NO_WRAP))
      if (write(owed, ByteArray(0))) {
        deployKept = true
        write(shell, kept.toString().toByteArray())
      }
      return
    }
    if (siteShown && !deployKept) {
      owed.delete()
    }
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

  /**
   * The kept page as the webview's answer. It asks the webview to open the
   * site's connection at once, as fetching the page would have: otherwise
   * the page's first read waits for it.
   */
  private fun response(html: ByteArray, headers: Map<String, String>) =
    WebResourceResponse(
      "text/html", "utf-8", HttpURLConnection.HTTP_OK, "OK", headers + ("link" to "<$SITE>; rel=preconnect"),
      ByteArrayInputStream(html)
    )

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
