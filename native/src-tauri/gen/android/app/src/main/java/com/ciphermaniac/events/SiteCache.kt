package com.ciphermaniac.events

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import android.webkit.CookieManager
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
import org.json.JSONObject

/**
 * The app's own copy of the site, served in place of the network for the
 * site's origin, so the app opens at once and offline. Nothing here reaches
 * a browser: it sits in the app's webview client (OfflinePage.kt).
 *
 * The shell (the page, which is the same for every route, and the built
 * files it loads) is served from the copy at once. Once the page shows,
 * and on each return to the screen ([refresh]), the live page is fetched
 * behind it; a new deploy is stored whole, its files first, and serves the
 * next page load, so the running scripts are at most one deploy behind
 * (MainActivity reloads a page left behind once it has been away).
 *
 * Data goes to the network as ever. Of a short list of reads ([DATA]) the
 * page hands the app a copy as it gets each one (app_bridge.js, [keep]),
 * kept under its session, so an account never sees another's. A kept read
 * is served only when the phone has no working network, so offline the app
 * shows the last it saw, and online the site always answers: clocks,
 * rounds and results are never the copy's. Signing out or deleting the
 * account drops every kept read. Writes, sign-in and every other request go
 * to the network untouched.
 */
class SiteCache(context: Context) {
  private val root = File(context.filesDir, "site")
  private val shell = File(root, "shell.html")
  private val shellHeaders = File(root, "shell.json")
  private val files = File(root, "files")
  private val data = File(root, "data")
  private val background = Executors.newSingleThreadExecutor()
  private val connectivity = context.getSystemService(ConnectivityManager::class.java)
  private var refreshedAt = 0L

  /** When kept reads were last dropped: a read asked for before then is not kept. */
  @Volatile private var clearedAt = 0L

  /** The webview's own name for itself, which the site's edge takes for a browser. */
  private val agent by lazy { WebSettings.getDefaultUserAgent(context) }

  /** The deploy the page in the window was served from, and the newest one kept. */
  @Volatile private var served: String? = null

  @Volatile private var kept: String? = null

  /** The response for [request] from the app's copy, or null for the webview to fetch. */
  fun intercept(request: WebResourceRequest): WebResourceResponse? {
    // Test builds only (native/android-m3-test): the feel audit measures launches without the copy.
    if (File(root.parentFile, "site-off").exists()) {
      return null
    }
    val url = request.url
    val method = request.method
    if (method != "GET") {
      if (url.toString().startsWith("$SITE/api/") && (url.path in SIGN_OUTS) && method in setOf("POST", "DELETE")) {
        clearData()
      }
      return null
    }
    val path = url.path.orEmpty()
    return when {
      url.toString().startsWith("$SITE/") && request.isForMainFrame && isPage(path) -> page()
      url.toString().startsWith("$SITE/") && FILE_PREFIXES.any { path.startsWith(it) } -> file(path)
      DATA.any { it.matches(url.toString()) } && !online() -> kept(url.toString())
      else -> null
    }
  }

  /** A route of the site rather than a file or the API. */
  private fun isPage(path: String) =
    !path.startsWith("/api/") && !path.startsWith("/cdn-cgi/") && !path.substringAfterLast('/').contains('.')

  /** Fetches the live page behind the copy, at most once a minute, off the main thread. */
  fun refresh() {
    val now = System.currentTimeMillis()
    if (now - refreshedAt < REFRESH_EVERY_MS) {
      return
    }
    refreshedAt = now
    background.execute { store() }
  }

  /** Whether a newer deploy is kept than the one the window shows. */
  fun isBehind(): Boolean = served != null && kept != null && kept != served

  private fun page(): WebResourceResponse? {
    if (!shell.exists() && !store()) {
      return null
    }
    val html = runCatching { shell.readBytes() }.getOrNull() ?: return null
    served = version(html)
    kept = served
    val headers = runCatching { JSONObject(shellHeaders.readText()) }.getOrNull()
    return response("text/html", html, headers?.let { h -> h.keys().asSequence().associateWith { h.getString(it) } })
  }

  /**
   * Fetches the live page and keeps it when it is a new deploy, with every
   * file it names, so a deploy is kept whole or not at all. True when a page
   * is kept, new or not.
   */
  private fun store(): Boolean {
    val live = fetch("$SITE/", mapOf("Cache-Control" to "no-cache")) ?: return false
    if (live.status != HttpURLConnection.HTTP_OK || !live.mime.startsWith("text/html")) {
      return false
    }
    val version = version(live.body)
    if (version == kept && shell.exists()) {
      return true
    }
    prune()
    if (!named(live.body).all { file(it) != null }) {
      return false
    }
    root.mkdirs()
    write(shellHeaders, JSONObject(live.headers).toString().toByteArray())
    write(shell, live.body)
    kept = version
    return true
  }

  /** The built files a page names. */
  private fun named(html: ByteArray) = FILE_NAMES.findAll(String(html)).map { it.groupValues[1] }.toSortedSet()

  /** A built file, from the copy or else the network, kept when it is one. */
  private fun file(path: String): WebResourceResponse? {
    val copy = File(files, path.trimStart('/').replace('/', '_'))
    if (copy.exists()) {
      copy.setLastModified(System.currentTimeMillis())
      return runCatching { response(mime(path), copy.readBytes(), null) }.getOrNull()
    }
    val live = fetch("$SITE$path", emptyMap()) ?: return null
    // A file a deploy removed comes back as the site's page: left to the webview, and never kept.
    if (live.status != HttpURLConnection.HTTP_OK || live.mime.startsWith("text/html")) {
      return null
    }
    files.mkdirs()
    write(copy, live.body)
    return response(mime(path), live.body, null)
  }

  /** Before a new deploy: drops built files no page has asked for in a month, and files without a hash, which it fetches anew. */
  private fun prune() {
    val old = System.currentTimeMillis() - PRUNE_AFTER_MS
    files.listFiles()?.forEach { if (!it.name.startsWith("assets_") || it.lastModified() < old) it.delete() }
  }

  /** Whether the phone has a network that reaches the internet. */
  private fun online(): Boolean =
    connectivity?.getNetworkCapabilities(connectivity.activeNetwork)
      ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true

  /** The last copy kept of a read, or null for the webview to try the network. */
  private fun kept(url: String): WebResourceResponse? {
    val saved = runCatching { JSONObject(File(File(data, session()), sha(url)).readText()) }.getOrNull() ?: return null
    // The published copies are another origin's, read across origins.
    val headers = if (url.startsWith("$SITE/")) emptyMap() else mapOf("Access-Control-Allow-Origin" to SITE)
    return response(saved.getString("mime"), saved.getString("body").toByteArray(), headers)
  }

  /**
   * Keeps a copy of a read from [DATA] the page got (app_bridge.js), under
   * the session, unless it was asked for before kept reads were dropped.
   */
  fun keep(message: JSONObject) {
    val url = message.optString("url")
    if (DATA.none { it.matches(url) } || message.optLong("at") < clearedAt) {
      return
    }
    val saved = JSONObject().put("mime", message.optString("mime")).put("body", message.optString("body"))
    background.execute {
      val dir = File(data, session())
      dropOtherSessions(dir)
      dir.mkdirs()
      write(File(dir, sha(url)), saved.toString().toByteArray())
    }
  }

  /** The signed-in session's own folder name: a hash of its cookie, or anon. */
  private fun session(): String {
    val cookie = CookieManager.getInstance().getCookie(SITE).orEmpty()
    val value = cookie.split(';').map { it.trim() }.firstOrNull { it.startsWith("$SESSION_COOKIE=") }
    return value?.let { sha(it).take(SESSION_CHARS) } ?: "anon"
  }

  /** A read under a new session: the last session's reads go, so only one account's are ever kept. */
  private fun dropOtherSessions(mine: File) {
    data.listFiles()?.filter { it != mine && it.name != "anon" }?.forEach { it.deleteRecursively() }
  }

  /** Drops every kept read, as a sign-out or a deleted account does. */
  fun clearData() {
    clearedAt = System.currentTimeMillis()
    background.execute { data.deleteRecursively() }
  }

  private class Fetched(val status: Int, val mime: String, val headers: Map<String, String>, val body: ByteArray)

  /** One GET to the network, or null when it can't be reached. */
  private fun fetch(url: String, headers: Map<String, String>): Fetched? =
    try {
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.connectTimeout = CONNECT_MS
      connection.readTimeout = READ_MS
      connection.setRequestProperty("User-Agent", agent)
      headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      val status = connection.responseCode
      val body = (if (status < HttpURLConnection.HTTP_BAD_REQUEST) connection.inputStream else connection.errorStream)
        ?.use { it.readBytes() } ?: ByteArray(0)
      val kept = connection.headerFields
        .filterKeys { it != null && it.lowercase() !in DROPPED_HEADERS }
        .mapValues { it.value.joinToString(", ") }
      Fetched(status, connection.contentType ?: "application/octet-stream", kept, body)
    } catch (err: IOException) {
      Log.i(TAG, "out of reach: $url (${err.javaClass.simpleName})")
      null
    }

  private fun response(mime: String, body: ByteArray, headers: Map<String, String>?): WebResourceResponse {
    val type = mime.substringBefore(';').trim()
    val charset = Regex("charset=([^;]+)").find(mime)?.groupValues?.get(1)?.trim()
    return WebResourceResponse(type, charset, HttpURLConnection.HTTP_OK, "OK", headers ?: emptyMap(), ByteArrayInputStream(body))
  }

  private fun write(file: File, bytes: ByteArray) {
    val part = File(file.parentFile, "${file.name}.${System.nanoTime()}.part")
    part.writeBytes(bytes)
    if (!part.renameTo(file)) {
      part.delete()
    }
  }

  /** A deploy's mark: the built files its page names, which change with each deploy and only then. */
  private fun version(html: ByteArray) = sha(named(html).joinToString("\n"))

  private fun sha(text: String) =
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

  private fun mime(path: String) = MIMES[path.substringAfterLast('.', "")] ?: "application/octet-stream"

  private companion object {
    const val TAG = "SiteCache"
    val SITE = PageBridge.SITE_ORIGIN
    const val SESSION_COOKIE = "cm_session"
    const val SESSION_CHARS = 16
    const val CONNECT_MS = 8_000
    const val READ_MS = 15_000
    const val REFRESH_EVERY_MS = 60_000L
    const val PRUNE_AFTER_MS = 30L * 24 * 60 * 60 * 1000

    /** The site's built files; `/assets/` names carry a hash and never change. */
    val FILE_PREFIXES = listOf("/assets/", "/fonts/", "/img/", "/logo.svg")
    val FILE_NAMES = Regex("""(?:src|href)="(/(?:assets|fonts|img)/[^"?#]+|/logo\.svg)"""")

    /** Requests that end a session, after which no kept read may stay. */
    val SIGN_OUTS = setOf("/api/auth/logout", "/api/me")

    /**
     * The reads kept for offline, and no others: the session, the dashboard's
     * events, one's history, an event's public view and its published copy,
     * and the console's view of it. None with a query, so no lookup, search
     * or poll is kept. app_bridge.js hands over only these: keep the two in step.
     */
    val DATA = listOf<Regex>(
      Regex("""\Q$SITE\E/api/me"""),
      Regex("""\Q$SITE\E/api/tournaments"""),
      Regex("""\Q$SITE\E/api/history"""),
      Regex("""\Q$SITE\E/api/tournaments/[A-Z0-9]{4,12}"""),
      Regex("""\Q$SITE\E/api/tournaments/[A-Z0-9]{4,12}/manage"""),
      Regex("""https://events-data\.ciphermaniac\.com/tournaments/v1/[A-Z0-9]{4,12}\.json""")
    )

    val DROPPED_HEADERS = setOf("content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie", "keep-alive")
    val MIMES = mapOf("js" to "text/javascript", "css" to "text/css", "woff2" to "font/woff2", "woff" to "font/woff",
      "svg" to "image/svg+xml", "png" to "image/png", "webp" to "image/webp", "jpg" to "image/jpeg", "json" to "application/json",
      "ico" to "image/x-icon")
  }
}
