package com.ciphermaniac.events

import android.text.format.DateFormat
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.DialogFragment
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
 * date or time that has a value can be cleared, as the old dialog could,
 * and an empty date starts on today. Each picker is titled with its
 * field's own label.
 */
class Pickers(private val activity: AppCompatActivity, private val answer: (String) -> Unit) {
  private val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

  fun show(field: JSONObject) {
    val value = field.optString("value")
    val clear = field.optBoolean("optional") && value.isNotEmpty()
    val title = field.optString("title")
    when (field.optString("kind")) {
      "select" -> choose(field)
      "date" -> date(field, value, clear, answer)
      "time" -> time(title, value, clear, answer)
      "datetime-local" ->
        date(field, value.substringBefore('T'), clear) { picked ->
          if (picked.isEmpty()) answer("") else time(title, value.substringAfter('T', ""), false) { answer("${picked}T$it") }
        }
    }
  }

  /**
   * Closes a date or time picker Android brought back with the activity after
   * it ended the app: its answer would have nowhere to go. Call it once the
   * activity's onCreate has run.
   */
  fun dropRestored() {
    activity.supportFragmentManager.fragments
      .filter { it.tag == DATE || it.tag == TIME }
      .forEach { (it as? DialogFragment)?.dismissAllowingStateLoss() }
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
    val builder = MaterialDatePicker.Builder.datePicker()
      .setCalendarConstraints(limits(field))
      .setSelection(parse(value) ?: MaterialDatePicker.todayInUtcMilliseconds())
    field.optString("title").takeIf { it.isNotEmpty() }?.let { builder.setTitleText(it) }
    if (clear) {
      builder.setNegativeButtonText(activity.getString(R.string.clear))
    }
    val picker = builder.build()
    picker.addOnPositiveButtonClickListener { onPick(day.format(Date(it))) }
    if (clear) {
      picker.addOnNegativeButtonClickListener { onPick("") }
    }
    picker.show(activity.supportFragmentManager, DATE)
  }

  /** The field's own earliest and latest days, when it has them. */
  private fun limits(field: JSONObject): CalendarConstraints {
    val validators = listOfNotNull(
      parse(field.optString("min"))?.let { DateValidatorPointForward.from(it) },
      parse(field.optString("max"))?.let { DateValidatorPointBackward.before(it + DAY_MS) }
    )
    return CalendarConstraints.Builder().setValidator(CompositeDateValidator.allOf(validators)).build()
  }

  private fun time(title: String, value: String, clear: Boolean, onPick: (String) -> Unit) {
    val parts = value.split(':').mapNotNull { it.take(2).toIntOrNull() }
    val builder = MaterialTimePicker.Builder()
      .setTimeFormat(if (DateFormat.is24HourFormat(activity)) TimeFormat.CLOCK_24H else TimeFormat.CLOCK_12H)
      .setHour(parts.getOrNull(0) ?: NOON)
      .setMinute(parts.getOrNull(1) ?: 0)
    if (title.isNotEmpty()) {
      builder.setTitleText(title)
    }
    if (clear) {
      builder.setNegativeButtonText(activity.getString(R.string.clear))
    }
    val picker = builder.build()
    picker.addOnPositiveButtonClickListener { onPick(String.format(Locale.US, "%02d:%02d", picker.hour, picker.minute)) }
    if (clear) {
      picker.addOnNegativeButtonClickListener { onPick("") }
    }
    picker.show(activity.supportFragmentManager, TIME)
  }

  /** A field's day (its first ten characters) as UTC milliseconds, as the date picker counts. */
  private fun parse(value: String): Long? =
    value.takeIf { it.length >= DAY_CHARS }?.let { runCatching { day.parse(it.take(DAY_CHARS))?.time }.getOrNull() }

  private fun strings(array: JSONArray?): Array<String> = Array(array?.length() ?: 0) { array?.optString(it).orEmpty() }

  private companion object {
    const val DATE = "date"
    const val TIME = "time"
    const val DAY_MS = 86_400_000L
    const val DAY_CHARS = 10
    const val NOON = 12
  }
}
