package org.getstoop.richtext

import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.TextPaint
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import kotlin.math.roundToInt

// The spans and marks RichLayout puts on a message's words.

// A run's look: its size, face, colour and lines.
internal class RunStyle(
  private val sizePx: Float,
  private val typeface: Typeface,
  private val color: Int,
  private val underline: Boolean,
  private val strike: Boolean,
) : MetricAffectingSpan() {
  val metrics: Paint.FontMetrics by lazy {
    TextPaint(Paint.ANTI_ALIAS_FLAG).also { updateMeasureState(it) }.fontMetrics
  }

  override fun updateMeasureState(paint: TextPaint) {
    paint.textSize = sizePx
    paint.typeface = typeface
  }

  override fun updateDrawState(paint: TextPaint) {
    updateMeasureState(paint)
    paint.color = color
    paint.isUnderlineText = underline
    paint.isStrikeThruText = strike
  }
}

// A box's padding: a no-break space sized so its advance is the pad. A
// no-break space glues to what follows and what precedes it (Unicode line
// breaking, class GL), so the pad never wraps away from its box, while a
// break after an ordinary space before the box stays allowed. At a line's
// start the pad is the indent a browser gives an inline box's padding.
internal class PadSpace(private val sizePx: Float) : MetricAffectingSpan() {
  override fun updateMeasureState(paint: TextPaint) {
    paint.textSize = sizePx
    paint.typeface = Typeface.DEFAULT
  }

  override fun updateDrawState(paint: TextPaint) {
    updateMeasureState(paint)
    paint.color = Color.TRANSPARENT
    paint.isUnderlineText = false
    paint.isStrikeThruText = false
  }
}

// Every line exactly the doc's line height, the body font centred in it,
// as React Native and our iOS view do, whatever the line holds (emoji,
// code, a pad's large space).
internal class FixedLineHeight(
  private val height: Int,
  private val ascent: Float,
  private val descent: Float,
) : LineHeightSpan {
  override fun chooseHeight(
    text: CharSequence,
    start: Int,
    end: Int,
    spanstartv: Int,
    lineHeight: Int,
    fm: Paint.FontMetricsInt,
  ) {
    val above = (height - (descent - ascent)) / 2f
    val top = (ascent - above).roundToInt()
    fm.ascent = top
    fm.top = top
    fm.descent = top + height
    fm.bottom = top + height
  }
}

// Marks on the words, read back for taps and the screen reader.
internal class LinkMark(val id: Int, val url: String)

internal class CoveredMark(val id: Int)

// A rounded box behind [start, end), its pads included.
internal class Box(val start: Int, val end: Int, val color: Int, val spoiler: Boolean)

// A link or channel pill's words, for its screen reader element.
internal class LinkInfo(val id: Int, val url: String, val hidden: Boolean, val start: Int) {
  var end = start
  val label = StringBuilder()
}
