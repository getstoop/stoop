package org.getstoop.richtext

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.text.TextPaint
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
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

// The mark that ends a mention's pill, as web's (messages.css
// .mention::after, drawn from Icons.tsx): 0.85 of the text's size, 3dp
// after the handle, sitting a little under the baseline, stroked in the
// pill's colour. It leaves the line's metrics alone (FixedLineHeight
// sets them).
internal class GlyphSpan(
  kind: String,
  sizePx: Float,
  private val color: Int,
  private val gapPx: Float,
) : ReplacementSpan() {
  private val side = sizePx * 0.85f
  private val drop = sizePx * 0.08f
  private val path = if (kind == "group") group else person
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
    strokeWidth = 2.5f
  }

  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int =
    Math.round(gapPx + side)

  override fun draw(
    canvas: Canvas,
    text: CharSequence?,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint,
  ) {
    stroke.color = color
    canvas.save()
    canvas.translate(x + gapPx, y + drop - side)
    canvas.scale(side / 24f, side / 24f)
    canvas.drawPath(path, stroke)
    canvas.restore()
  }

  // In web's 24-unit box, from the same shapes.
  private companion object {
    val person = Path().apply {
      addCircle(12f, 8f, 4f, Path.Direction.CW)
      moveTo(4f, 21f)
      lineTo(4f, 20f)
      arcTo(4f, 14f, 16f, 26f, 180f, 90f, false)
      lineTo(14f, 14f)
      arcTo(8f, 14f, 20f, 26f, 270f, 90f, false)
      lineTo(20f, 21f)
    }
    val group = Path().apply {
      addCircle(9f, 7f, 4f, Path.Direction.CW)
      moveTo(16f, 21f)
      lineTo(16f, 19f)
      arcTo(8f, 15f, 16f, 23f, 0f, -90f, false)
      lineTo(6f, 15f)
      arcTo(2f, 15f, 10f, 23f, 270f, -90f, false)
      lineTo(2f, 21f)
      moveTo(22f, 21f)
      lineTo(22f, 19f)
      arcTo(14f, 15f, 22f, 23f, 0f, -75.5f, false)
      moveTo(16f, 3.13f)
      arcTo(11f, 3f, 19f, 11f, -75.5f, 151f, false)
    }
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
