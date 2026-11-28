package com.ciphermaniac.events

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
 * files it loads) is served from the copy at once. Each launch, and each
 * return to the screen, fetches the live page behind it; a new deploy is
 * stored whole, its files first, and the app moves to it when it next loads
 * a page ([onNewShell]), so the running scripts are at most one deploy
 * behind and never meet a newer API for long.
 *
 * Data is fetched from the network as ever, and only a short list of reads
 * ([DATA]) is kept, each under its session, so an account never sees
 * another's. A kept read is served only when the network can't be reached,
 * so the app offline shows the last it saw; online it never serves a kept
 * one, so clocks, rounds and results are always the site's own. Signing
 * out or deleting the account drops every kept read. Writes, sign-in and
 * every other request go to the network untouched.
 */
class SiteCache(context: Context, private val onNewShell: () -> Unit) {
  private val root = File(context.filesDir, "site")
  private val shell = File(root, "shell.html")
  private val shellHeaders = File(root, "shell.json")
  private val files = File(root, "files")
  private val data = File(root, "data")
  private val background = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private var refreshedAt = 0L

  /** The deploy the page in the window was served from, and the newest one kept. */
  @Volatile private var served: String? = null

  @Volatile private var kept: String? = null

  /** The response for [request] from the app's copy, or null for the webview to fetch. */
  fun intercept(request: WebResourceRequest): WebResourceResponse? {
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
      DATA.any { it.matches(url.toString()) } -> read(request)
      else -> null
    }
  }

  /** A route of the site rather than a file or the API. */
  private fun isPage(path: String) =
    !path.startsWith("/api/") && !path.startsWith("/cdn-cgi/") && !path.substringAfterLast('/').contains('.')

  /** Fetches the live page behind the copy, at most once a minute; [onNewShell] hears of a new deploy. */
  fun refresh() {
    val now = System.currentTimeMillis()
    if (now - refreshedAt < REFRESH_EVERY_MS) {
      return
    }
    refreshedAt = now
    background.execute {
      if (store() && kept != served) {
        main.post(onNewShell)
      }
    }
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
    refresh()
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
    val kept = File(files, path.trimStart('/').replace('/', '_'))
    if (kept.exists()) {
      kept.setLastModified(System.currentTimeMillis())
      return runCatching { response(mime(path), kept.readBytes(), null) }.getOrNull()
    }
    val live = fetch("$SITE$path", emptyMap()) ?: return null
    // A file a deploy removed comes back as the site's page: left to the webview, and never kept.
    if (live.status != HttpURLConnection.HTTP_OK || live.mime.startsWith("text/html")) {
      return null
    }
    files.mkdirs()
    write(kept, live.body)
    return response(mime(path), live.body, null)
  }

  /** Before a new deploy: drops built files no page has asked for in a month, and files without a hash, which it fetches anew. */
  private fun prune() {
    val old = System.currentTimeMillis() - PRUNE_AFTER_MS
    files.listFiles()?.forEach { if (!it.name.startsWith("assets_") || it.lastModified() < old) it.delete() }
  }

  /** A read from [DATA]: the network's answer, kept; or, out of reach, the last one kept. */
  private fun read(request: WebResourceRequest): WebResourceResponse? {
    val url = request.url.toString()
    val dir = File(data, session())
    val kept = File(dir, sha(url))
    val headers = forwarded(request.requestHeaders).let { if (url.startsWith("$SITE/")) it else it + ("Origin" to SITE) }
    val live = fetch(url, headers, cookies = true)
    if (live == null) {
      return runCatching {
        val saved = JSONObject(kept.readText())
        val headers = saved.getJSONObject("headers")
        response(saved.getString("mime"), android.util.Base64.decode(saved.getString("body"), android.util.Base64.DEFAULT),
          headers.keys().asSequence().associateWith { headers.getString(it) })
      }.getOrNull()
    }
    if (live.status == HttpURLConnection.HTTP_OK) {
      dropOtherSessions(dir)
      dir.mkdirs()
      val saved = JSONObject()
        .put("mime", live.mime)
        .put("headers", JSONObject(live.headers))
        .put("body", android.util.Base64.encodeToString(live.body, android.util.Base64.NO_WRAP))
      write(kept, saved.toString().toByteArray())
    }
    return response(live.mime, live.body, live.headers, live.status)
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
    data.deleteRecursively()
  }

  private class Fetched(val status: Int, val mime: String, val headers: Map<String, String>, val body: ByteArray)

  /**
   * One GET to the network, or null when it can't be reached. With
   * [cookies], it carries the webview's and hands back the ones it sets.
   */
  private fun fetch(url: String, headers: Map<String, String>, cookies: Boolean = false): Fetched? =
    try {
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.connectTimeout = CONNECT_MS
      connection.readTimeout = READ_MS
      headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      if (cookies) {
        CookieManager.getInstance().getCookie(url)?.let { connection.setRequestProperty("Cookie", it) }
      }
      val status = connection.responseCode
      if (cookies) {
        connection.headerFields["Set-Cookie"]?.forEach { CookieManager.getInstance().setCookie(url, it) }
      }
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

  /** The page's own headers for a read, less the ones the connection sets or a cached answer can't keep. */
  private fun forwarded(headers: Map<String, String>) = headers.filterKeys { it.lowercase() !in UNFORWARDED_HEADERS }

  private fun response(mime: String, body: ByteArray, headers: Map<String, String>?, status: Int = 200): WebResourceResponse {
    val type = mime.substringBefore(';').trim()
    val charset = Regex("charset=([^;]+)").find(mime)?.groupValues?.get(1)?.trim()
    return WebResourceResponse(type, charset, status, REASONS[status] ?: "OK", headers ?: emptyMap(), ByteArrayInputStream(body))
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

  /** A read worth keeping for offline: a pattern over its whole address. */
  private class Read(pattern: String) {
    private val regex = Regex(pattern)

    fun matches(url: String) = regex.matches(url)
  }

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
     * or poll is kept.
     */
    val DATA = listOf(
      Read("""\Q$SITE\E/api/me"""),
      Read("""\Q$SITE\E/api/tournaments"""),
      Read("""\Q$SITE\E/api/history"""),
      Read("""\Q$SITE\E/api/tournaments/[A-Z0-9]{4,12}"""),
      Read("""\Q$SITE\E/api/tournaments/[A-Z0-9]{4,12}/manage"""),
      Read("""https://events-data\.ciphermaniac\.com/tournaments/v1/[A-Z0-9]{4,12}\.json""")
    )

    val DROPPED_HEADERS = setOf("content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie", "keep-alive")
    val UNFORWARDED_HEADERS = setOf("accept-encoding", "if-none-match", "if-modified-since", "range", "host", "connection", "cookie")
    val REASONS = mapOf(200 to "OK", 204 to "No Content", 304 to "Not Modified", 400 to "Bad Request", 401 to "Unauthorized",
      403 to "Forbidden", 404 to "Not Found", 409 to "Conflict", 429 to "Too Many Requests", 500 to "Internal Server Error",
      502 to "Bad Gateway", 503 to "Service Unavailable")
    val MIMES = mapOf("js" to "text/javascript", "css" to "text/css", "woff2" to "font/woff2", "woff" to "font/woff",
      "svg" to "image/svg+xml", "png" to "image/png", "webp" to "image/webp", "jpg" to "image/jpeg", "json" to "application/json",
      "ico" to "image/x-icon")
  }
}
