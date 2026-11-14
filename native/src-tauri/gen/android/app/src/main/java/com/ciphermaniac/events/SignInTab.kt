package com.ciphermaniac.events

import android.app.Activity
import android.content.ActivityNotFoundException
import android.net.Uri
import android.util.Log
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat

/**
 * Google sign-in, which refuses the app's webview, in a Custom Tab: the
 * browser opens over the app in the head bar's color rather than as an app
 * of its own, and the app's sign-in link closes it back into the app (the
 * activity is singleTask). A phone without a Custom Tabs browser gets its
 * default browser instead.
 */
object SignInTab {
  fun open(activity: Activity, url: String) {
    val colors = CustomTabColorSchemeParams.Builder()
      .setToolbarColor(ContextCompat.getColor(activity, R.color.head_bar))
      .build()
    val tab = CustomTabsIntent.Builder()
      .setDefaultColorSchemeParams(colors)
      .setShowTitle(true)
      .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
      .build()
    try {
      tab.launchUrl(activity, Uri.parse(url))
    } catch (err: ActivityNotFoundException) {
      Log.w("SignInTab", "no browser to sign in with", err)
    }
  }
}
