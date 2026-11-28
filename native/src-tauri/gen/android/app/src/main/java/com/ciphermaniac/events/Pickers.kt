package com.ciphermaniac.events

import android.text.format.DateFormat
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.datepicker.CalendarConstraints
import com.google.android.material.datepicker.CompositeDateValidator
import com.google.android.material.datepicker.DateValidatorPointBackward
import com.google.android.material.datepicker.DateValidatorPointForward
import com.google.android.material.datepicker.MaterialDatePicker
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.timepicker.MaterialTimePicker
import com.google.android.material.timepicker.TimeFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONObject

/**
 * The page's dropdowns and date and time fields as Material 3 pickers, in
 * place of the webview's own old dialogs: app_bridge.js hands a field over
 * when it is tapped, and [answer] takes the pick back to it. An optional
 * date or time that has a value can be cleared, as the old dialog could.
 */
class Pickers(private val activity: AppCompatActivity, private val answer: (String) -> Unit) {
  private val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

  fun show(field: JSONObject) {
    val value = field.optString("value")
    val clear = field.optBoolean("optional") && value.isNotEmpty()
    when (field.optString("kind")) {
      "select" -> choose(field)
      "date" -> date(field, value, clear, answer)
      "time" -> time(value, clear, answer)
      "datetime-local" ->
        date(field, value.substringBefore('T'), clear) { picked ->
          if (picked.isEmpty()) answer("") else time(value.substringAfter('T', ""), false) { answer("${picked}T$it") }
        }
    }
  }

  private fun choose(field: JSONObject) {
    val labels = strings(field.optJSONArray("options"))
    val values = strings(field.optJSONArray("values"))
    MaterialAlertDialogBuilder(activity)
      .setTitle(field.optString("title").ifEmpty { null })
      .setSingleChoiceItems(labels, field.optInt("selected", -1)) { dialog, which ->
        dialog.dismiss()
        values.getOrNull(which)?.let(answer)
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
  }

  private fun date(field: JSONObject, value: String, clear: Boolean, onPick: (String) -> Unit) {
    val builder = MaterialDatePicker.Builder.datePicker().setCalendarConstraints(limits(field))
    parse(value)?.let { builder.setSelection(it) }
    if (clear) {
      builder.setNegativeButtonText(activity.getString(R.string.clear))
    }
    val picker = builder.build()
    picker.addOnPositiveButtonClickListener { onPick(day.format(Date(it))) }
    if (clear) {
      picker.addOnNegativeButtonClickListener { onPick("") }
    }
    picker.show(activity.supportFragmentManager, "date")
  }

  /** The field's own earliest and latest days, when it has them. */
  private fun limits(field: JSONObject): CalendarConstraints {
    val validators = listOfNotNull(
      parse(field.optString("min"))?.let { DateValidatorPointForward.from(it) },
      parse(field.optString("max"))?.let { DateValidatorPointBackward.before(it + DAY_MS) }
    )
    return CalendarConstraints.Builder().setValidator(CompositeDateValidator.allOf(validators)).build()
  }

  private fun time(value: String, clear: Boolean, onPick: (String) -> Unit) {
    val parts = value.split(':').mapNotNull { it.take(2).toIntOrNull() }
    val builder = MaterialTimePicker.Builder()
      .setTimeFormat(if (DateFormat.is24HourFormat(activity)) TimeFormat.CLOCK_24H else TimeFormat.CLOCK_12H)
      .setHour(parts.getOrNull(0) ?: NOON)
      .setMinute(parts.getOrNull(1) ?: 0)
    if (clear) {
      builder.setNegativeButtonText(activity.getString(R.string.clear))
    }
    val picker = builder.build()
    picker.addOnPositiveButtonClickListener { onPick(String.format(Locale.US, "%02d:%02d", picker.hour, picker.minute)) }
    if (clear) {
      picker.addOnNegativeButtonClickListener { onPick("") }
    }
    picker.show(activity.supportFragmentManager, "time")
  }

  /** A field's day (its first ten characters) as UTC milliseconds, as the date picker counts. */
  private fun parse(value: String): Long? =
    value.takeIf { it.length >= DAY_CHARS }?.let { runCatching { day.parse(it.take(DAY_CHARS))?.time }.getOrNull() }

  private fun strings(array: JSONArray?): Array<String> = Array(array?.length() ?: 0) { array?.optString(it).orEmpty() }

  private companion object {
    const val DAY_MS = 86_400_000L
    const val DAY_CHARS = 10
    const val NOON = 12
  }
}
