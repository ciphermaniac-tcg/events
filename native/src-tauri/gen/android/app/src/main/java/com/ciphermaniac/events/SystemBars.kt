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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The system bars around the page. The site has no safe-area padding of its
 * own at the top, so the page is kept clear of the status bar, cutouts,
 * navigation bar and keyboard. The strip behind the status bar continues the
 * site's head bar, which is dark in both modes, so its icons stay light; the
 * rest of the window takes the page's color. [apply] runs again when the
 * phone switches between light and dark, since the activity stays.
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
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      backdrop.stripHeight = bars.top
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
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
