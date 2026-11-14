package com.ciphermaniac.events

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat

/**
 * The system bars around the page. The site has no safe-area padding of its
 * own at the top, so the page is kept clear of the status bar, cutouts and
 * keyboard. The strip behind the status bar continues the site's head bar,
 * which is dark in both modes, so its icons stay light; the rest of the
 * window takes the page's color. [apply] runs again when the phone switches
 * between light and dark, since the activity stays.
 *
 * The page runs under the gesture bar, as the site's tab bar and sheet pad
 * themselves with env(safe-area-inset-bottom), where the webview passes the
 * bar's inset on to the page ([PAGE_INSETS_FROM]). An older webview reports
 * none, so there the page stops above the bar instead.
 */
class SystemBars(private val activity: ComponentActivity) {
  private val backdrop = Backdrop()

  /** Colors the bars and the window for the current mode. */
  fun apply() {
    activity.enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
    backdrop.color = ContextCompat.getColor(activity, R.color.app_background)
    backdrop.strip = ContextCompat.getColor(activity, R.color.head_bar)
    activity.window.setBackgroundDrawable(ColorDrawable(backdrop.color))
  }

  /** Pads the page clear of the bars, once the webview is in the window. */
  fun attach() {
    val content = activity.findViewById<View>(android.R.id.content)
    content.background = backdrop
    val pageTakesBottom = webViewMajor() >= PAGE_INSETS_FROM
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      place(view, insets, pageTakesBottom)
    }
    ViewCompat.requestApplyInsets(content)
  }

  /**
   * Pads the page clear of the bars and the keyboard. What the page draws
   * under, the gesture bar, goes on to the webview as the only inset.
   */
  private fun place(view: View, insets: WindowInsetsCompat, pageTakesBottom: Boolean): WindowInsetsCompat {
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    val underBar = pageTakesBottom && keyboard == 0
    val bottom = if (underBar) 0 else maxOf(bars.bottom, keyboard)
    view.setPadding(bars.left, bars.top, bars.right, bottom)
    backdrop.stripHeight = bars.top
    if (!underBar) {
      return WindowInsetsCompat.CONSUMED
    }
    return WindowInsetsCompat.Builder()
      .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, bars.bottom))
      .build()
  }

  private fun webViewMajor(): Int =
    WebViewCompat.getCurrentWebViewPackage(activity)?.versionName
      ?.substringBefore('.')?.toIntOrNull() ?: 0

  private companion object {
    /** The first webview that passes system bar insets to every page (Chromium's WebView docs). */
    const val PAGE_INSETS_FROM = 144
  }
}

/** The page's color, with the head bar's along the top for the status bar. */
private class Backdrop : ColorDrawable() {
  private val paint = Paint()

  var strip: Int
    get() = paint.color
    set(value) {
      paint.color = value
      invalidateSelf()
    }

  var stripHeight = 0
    set(value) {
      field = value
      invalidateSelf()
    }

  override fun draw(canvas: Canvas) {
    super.draw(canvas)
    val area = bounds
    canvas.drawRect(
      area.left.toFloat(),
      area.top.toFloat(),
      area.right.toFloat(),
      (area.top + stripHeight).toFloat(),
      paint
    )
  }
}
