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
 * The app's own copy of the site's shell, served in place of the network
 * for the site's origin, so a launch draws without waiting on the site.
 * Nothing here reaches a browser: it sits in the app's webview client
 * (OfflinePage.kt).
 *
 * The shell is the page, which is the same for every route the site has,
 * with the headers it came with, and the built files it loads. A route of
 * the site is answered from the copy while the phone is online; offline,
 * and before there is a copy, the webview asks the network as ever, so the
 * offline page still stands in. Each launch, once the page shows, and each
 * return to the screen ([refresh]), the live page is fetched behind it, and
 * a new deploy is kept whole, every built file its manifest names first,
 * for the next launch, so the scripts running are at most one deploy
 * behind, as in a browser tab left open, and never ask for a file the copy
 * lacks. A file the copy lacks goes to the webview's own fetch untouched; a
 * hashed one means the copy is incomplete, so it goes and the next page
 * load is the network's.
 *
 * Only the shell is kept, which is the same for everyone: no data, no
 * write, no sign-in and nothing per request goes through here.
 */
class SiteCache(context: Context) {
  private val root = File(context.filesDir, "site")
  private val shell = File(root, "shell.json")
  private val files = File(root, "files")
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
    val path = url.path.orEmpty()
    if (request.method != "GET" || "${url.scheme}://${url.authority}" != SITE || ".." in path) {
      return null
    }
    return when {
      request.isForMainFrame && ROUTES.matches(path) -> page()
      isFile(path) && url.query == null -> file(path)
      else -> null
    }
  }

  private fun isFile(path: String) = FILE_PREFIXES.any { path.startsWith(it) } || path == "/logo.svg"

  /**
   * Fetches the live page behind the copy, off the main thread, a few
   * seconds on so the page's own first reads go first, and at most once a
   * minute; with [now], at once.
   */
  fun refresh(now: Boolean = false) {
    val at = System.currentTimeMillis()
    if (!now && at - refreshedAt < REFRESH_EVERY_MS) {
      return
    }
    refreshedAt = at
    worker.schedule({ store() }, if (now) 0 else SETTLE_MS, TimeUnit.MILLISECONDS)
  }

  /** The kept page with its own headers, or null to fail closed to the network. */
  private fun page(): WebResourceResponse? {
    if (!online()) {
      return null
    }
    val kept = runCatching { JSONObject(shell.readText()) }.getOrNull() ?: return null
    return runCatching {
      val headers = kept.getJSONObject("headers")
      response("text/html; charset=utf-8", Base64.decode(kept.getString("html"), Base64.DEFAULT),
        headers.keys().asSequence().associateWith { headers.getString(it) })
    }.getOrNull()
  }

  /**
   * Keeps the live page when it is a new deploy: every built file it names
   * or its manifest lists first, then the page and its headers in one
   * write, so a copy is whole or not there.
   */
  private fun store() {
    val live = fetch("$SITE/") ?: return
    val html = String(live.body)
    val named = FILE_NAMES.findAll(html).map { it.groupValues[1] }.toSortedSet()
    if (live.status != HttpURLConnection.HTTP_OK || !live.mime.startsWith("text/html") || named.none { it.endsWith(".js") }) {
      return
    }
    val version = sha(html + live.headers.toSortedMap())
    if (version == runCatching { JSONObject(shell.readText()).getString("version") }.getOrNull()) {
      return
    }
    prune()
    if (!(named + manifest()).all(::keepFile)) {
      return
    }
    val kept = JSONObject()
      .put("version", version)
      .put("headers", JSONObject(live.headers))
      .put("html", Base64.encodeToString(live.body, Base64.NO_WRAP))
    write(shell, kept.toString().toByteArray())
  }

  /** Every built file of the live deploy, from its manifest (vite.config.ts), or none when it can't be read. */
  private fun manifest(): Set<String> {
    val live = fetch("$SITE/.vite/manifest.json")?.takeIf { it.status == HttpURLConnection.HTTP_OK } ?: return emptySet()
    val entries = runCatching { JSONObject(String(live.body)) }.getOrNull() ?: return emptySet()
    return entries.keys().asSequence().flatMap { key ->
      val entry = entries.getJSONObject(key)
      sequenceOf(entry.optString("file")) +
        listOf("css", "assets").flatMap { list -> entry.optJSONArray(list)?.let { a -> (0 until a.length()).map(a::getString) }.orEmpty() }
    }.filter { it.isNotEmpty() }.map { "/$it" }.toSet()
  }

  private fun copyOf(path: String) = File(files, path.trimStart('/').replace('/', '_'))

  /** Downloads a built file into the copy unless it is there; false when it can't be had. */
  private fun keepFile(path: String): Boolean {
    val copy = copyOf(path)
    if (copy.exists()) {
      return true
    }
    val live = fetch("$SITE$path") ?: return false
    if (live.status != HttpURLConnection.HTTP_OK || live.mime.startsWith("text/html")) {
      return false
    }
    write(copy, live.body)
    return copy.exists()
  }

  /**
   * A built file from the copy, or null for the webview's own fetch. A
   * hashed file missing from it means the copy is incomplete: it goes, and
   * the next page load is the network's, while a fresh one is kept.
   */
  private fun file(path: String): WebResourceResponse? {
    val copy = copyOf(path)
    if (copy.exists()) {
      return runCatching { response(mime(path), copy.readBytes(), null) }.getOrNull()
    }
    if (path.startsWith("/assets/")) {
      shell.delete()
      refresh(now = true)
    }
    return null
  }

  /** Before a new deploy: drops built files kept over a month ago, and files without a hash, fetched anew. */
  private fun prune() {
    val old = System.currentTimeMillis() - PRUNE_AFTER_MS
    files.listFiles()?.forEach { if (!it.name.startsWith("assets_") || it.lastModified() < old) it.delete() }
  }

  /** Whether the phone has a network that reaches the internet. */
  private fun online(): Boolean =
    connectivity?.getNetworkCapabilities(connectivity.activeNetwork)
      ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true

  private class Fetched(val status: Int, val mime: String, val headers: Map<String, String>, val body: ByteArray)

  /** One GET to the site, following no redirect, or null when it can't be reached. */
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
        ?.use { it.readBytes() } ?: ByteArray(0)
      val headers = connection.headerFields
        .filterKeys { it != null && it.lowercase() !in DROPPED_HEADERS }
        .mapValues { it.value.joinToString(", ") }
      Fetched(status, connection.contentType ?: "application/octet-stream", headers, body)
    } catch (err: IOException) {
      Log.i(TAG, "out of reach: $url (${err.javaClass.simpleName})")
      null
    }

  private fun response(mime: String, body: ByteArray, headers: Map<String, String>?): WebResourceResponse {
    val type = mime.substringBefore(';').trim()
    val charset = Regex("charset=([^;]+)").find(mime)?.groupValues?.get(1)?.trim()
    return WebResourceResponse(type, charset, HttpURLConnection.HTTP_OK, "OK", headers ?: emptyMap(), ByteArrayInputStream(body))
  }

  /** Writes whole or not at all; a failed write leaves the last copy. */
  private fun write(file: File, bytes: ByteArray) {
    val part = File(file.parentFile, "${file.name}.${System.nanoTime()}.part")
    try {
      file.parentFile?.mkdirs()
      part.writeBytes(bytes)
      if (!part.renameTo(file)) {
        part.delete()
      }
    } catch (err: IOException) {
      part.delete()
      Log.w(TAG, "could not keep ${file.name}", err)
    }
  }

  private fun sha(text: String) =
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

  private fun mime(path: String) = MIMES[path.substringAfterLast('.', "")] ?: "application/octet-stream"

  private companion object {
    const val TAG = "SiteCache"
    val SITE = PageBridge.SITE_ORIGIN
    const val CONNECT_MS = 8_000
    const val READ_MS = 15_000
    const val REFRESH_EVERY_MS = 60_000L
    const val SETTLE_MS = 5_000L
    const val PRUNE_AFTER_MS = 30L * 24 * 60 * 60 * 1000

    /** The site's routes (src/main.tsx), each answered with the same page. */
    val ROUTES = Regex(
      "/(|host|host/[^/]+|t/[^/]+|settings|sign-in|create-account|account|history|u/[^/]+|apply|welcome|" +
        "privacy|terms|admin|stores/[^/]+|stores/[^/]+/settings)"
    )

    /** The site's built files; names under `/assets/` carry a hash and never change. */
    val FILE_PREFIXES = listOf("/assets/", "/fonts/", "/img/")
    val FILE_NAMES = Regex("""(?:src|href)="(/(?:assets|fonts|img)/[^"?#]+|/logo\.svg)"""")

    val DROPPED_HEADERS = setOf("content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie", "keep-alive")
    val MIMES = mapOf("js" to "text/javascript", "css" to "text/css", "woff2" to "font/woff2", "woff" to "font/woff",
      "svg" to "image/svg+xml", "png" to "image/png", "webp" to "image/webp", "jpg" to "image/jpeg", "json" to "application/json",
      "ico" to "image/x-icon")
  }
}
