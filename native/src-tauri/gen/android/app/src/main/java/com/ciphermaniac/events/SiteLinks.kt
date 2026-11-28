package com.ciphermaniac.events

import android.app.Activity
import android.content.Intent
import android.util.Log
import java.io.File
import java.io.IOException

/**
 * Links to the site's pages open in the app (the manifest's https filter,
 * which the site's /.well-known/assetlinks.json verifies). A link that
 * launches the app is the page it opens on: it goes where Rust keeps the
 * page to reopen (last_page.rs), which Rust reads as it makes the window, so
 * the page loads once. A link while the app runs opens in it (MainActivity). The
 * page open in the app is kept there too as it changes, tab included, to
 * open again after Android ends the app.
 */
object SiteLinks {
  /** last_page.rs's file, in the app's data directory. */
  private const val LAST_PAGE_FILE = "last-page"

  /** The page of the site an intent opens, or null. */
  fun link(intent: Intent?): String? {
    val uri = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data ?: return null
    return uri.toString().takeIf { "${uri.scheme}://${uri.authority}" == PageBridge.SITE_ORIGIN }
  }

  private var kept = ""

  /** Keeps [url], a page of the site the app shows, as the page to open next. */
  fun keep(activity: Activity, url: String) {
    if (url == kept || !url.startsWith("${PageBridge.SITE_ORIGIN}/")) {
      return
    }
    kept = url
    write(activity, url)
  }

  /** Opens the app on the launch intent's page. Call it before the activity's onCreate. */
  fun openAtLaunch(activity: Activity) {
    val intent = activity.intent
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
      return
    }
    write(activity, link(intent) ?: return)
  }

  private fun write(activity: Activity, url: String) {
    try {
      File(activity.dataDir, LAST_PAGE_FILE).writeText(url)
    } catch (err: IOException) {
      Log.w("SiteLinks", "could not keep $url as the page to open", err)
    }
  }
}
