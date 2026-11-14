package com.ciphermaniac.events

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

/**
 * Files the site hands the app (app_bridge.js), since a webview has neither
 * Web Share nor downloads: a share goes to the system share sheet, and a
 * download (an export, or a share image the clipboard didn't take) goes
 * where the person picks in the system's save dialog. Create it before the
 * activity starts, as it registers for the dialog's result.
 */
class FileHandoff(private val activity: ComponentActivity) {
  private var waiting: Payload? = null
  private val saveDialog =
    activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult(), ::write)

  /** Opens the share sheet with the message's files, or its text when it has none. */
  fun share(message: JSONObject) {
    File(activity.cacheDir, SHARED_DIR).listFiles()?.forEach { it.delete() }
    val payloads = payloads(message.optJSONArray("files") ?: JSONArray())
    val uris = ArrayList(payloads.mapNotNull(::cache))
    val intent = Intent(if (uris.size > 1) Intent.ACTION_SEND_MULTIPLE else Intent.ACTION_SEND)
    intent.type = payloads.map { it.mime }.distinct().singleOrNull() ?: if (uris.isEmpty()) "text/plain" else "*/*"
    message.optString("text").takeIf { it.isNotEmpty() }?.let { intent.putExtra(Intent.EXTRA_TEXT, it) }
    if (uris.isNotEmpty()) {
      attach(intent, uris)
    }
    start { activity.startActivity(Intent.createChooser(intent, message.optString("title").ifEmpty { null })) }
  }

  /** Puts the files on a share, readable by whichever app takes it. */
  private fun attach(intent: Intent, uris: ArrayList<Uri>) {
    if (uris.size == 1) {
      intent.putExtra(Intent.EXTRA_STREAM, uris[0])
    } else {
      intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
    }
    intent.clipData = ClipData.newRawUri(null, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }

  /** Asks where to save the message's file, then writes it there. */
  fun save(message: JSONObject) {
    val payload = Payload.from(message) ?: return
    waiting = payload
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType(payload.mime)
      .putExtra(Intent.EXTRA_TITLE, payload.name)
    start { saveDialog.launch(intent) }
  }

  /**
   * Writes the file where the person picked, off the main thread, as a
   * cloud provider can be slow. If the app was stopped while the dialog was
   * open, the file went with it, and the empty document the dialog made is
   * removed rather than left behind.
   */
  private fun write(result: ActivityResult) {
    val uri = result.data?.data?.takeIf { result.resultCode == Activity.RESULT_OK }
    val payload = waiting
    waiting = null
    if (uri == null) {
      return
    }
    val resolver = activity.contentResolver
    Thread {
      try {
        if (payload == null) {
          DocumentsContract.deleteDocument(resolver, uri)
        } else {
          resolver.openOutputStream(uri)?.use { it.write(payload.bytes) }
        }
      } catch (err: IOException) {
        Log.w(TAG, "could not save ${payload?.name}", err)
      } catch (err: SecurityException) {
        Log.w(TAG, "could not save ${payload?.name}", err)
      } catch (err: IllegalArgumentException) {
        Log.w(TAG, "could not save ${payload?.name}", err)
      }
    }.start()
  }

  private fun payloads(files: JSONArray): List<Payload> =
    (0 until files.length()).mapNotNull { files.optJSONObject(it)?.let(Payload::from) }

  /** Writes a file to share where the app that takes it can read it. The next share clears it. */
  private fun cache(payload: Payload): Uri? {
    val dir = File(activity.cacheDir, SHARED_DIR)
    return try {
      dir.mkdirs()
      val file = File(dir, payload.name)
      file.writeBytes(payload.bytes)
      FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
    } catch (err: IOException) {
      Log.w(TAG, "could not share ${payload.name}", err)
      null
    }
  }

  private fun start(launch: () -> Unit) {
    try {
      launch()
    } catch (err: ActivityNotFoundException) {
      Log.w(TAG, "nothing on this phone can take the file", err)
    }
  }

  /** A file from the page: its name, made safe for a file system, its type and its bytes. */
  private class Payload(val name: String, val mime: String, val bytes: ByteArray) {
    companion object {
      fun from(json: JSONObject): Payload? {
        val data = json.optString("data").ifEmpty { return null }
        val bytes = try {
          Base64.decode(data, Base64.DEFAULT)
        } catch (err: IllegalArgumentException) {
          Log.w(TAG, "a file from the page wasn't base64", err)
          return null
        }
        return Payload(safeName(json.optString("name")), json.optString("mime").ifEmpty { OCTET_STREAM }, bytes)
      }

      private fun safeName(name: String): String =
        name.substringAfterLast('/').replace(UNSAFE, "_").trim('.', ' ').take(MAX_NAME).ifEmpty { "download" }
    }
  }

  private companion object {
    const val TAG = "FileHandoff"
    const val SHARED_DIR = "shared"
    const val OCTET_STREAM = "application/octet-stream"
    const val MAX_NAME = 120
    val UNSAFE = Regex("[\\\\/:*?\"<>|\\p{Cntrl}]")
  }
}
