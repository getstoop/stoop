package org.getstoop.richtext

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import expo.modules.kotlin.types.ColorCompat
import java.util.BitSet
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

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

// The paragraph laid out at a width in pixels: the same code measures (the
// module's measure function, on the JS thread) and draws (RichTextView).
internal class RichLayout(val doc: RichDoc, val width: Int, private val density: Float) {
  val text = SpannableStringBuilder()
  val layout: StaticLayout
  val boxes = ArrayList<Box>()
  val links = ArrayList<LinkInfo>()
  private val pads = BitSet()
  private val radius = doc.radius.toFloat() * density
  // How far outside a character a tap still counts: past the widest pad.
  private val slop: Float
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

  private data class BoxKey(val id: Int, val color: Int, val pad: Float)

  init {
    val textColor = doc.textColor?.let { ColorCompat.toArgb(it) } ?: Color.BLACK
    val spoilerPad = doc.spoilerPad.toFloat() * density
    var widestPad = doc.spoilerPad
    val linksById = HashMap<Int, LinkInfo>()

    var spoiler: BoxKey? = null
    var spoilerStart = 0
    var fill: BoxKey? = null
    var fillStart = 0
    fun pad(px: Float) {
      val at = text.length
      text.append(' ')
      text.setSpan(PadSpace(px / nbspAdvance), at, at + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      pads.set(at)
    }
    fun closeFill() {
      fill?.let {
        pad(it.pad)
        boxes.add(Box(fillStart, text.length, it.color, false))
      }
      fill = null
    }
    fun closeSpoiler() {
      closeFill()
      spoiler?.let {
        pad(it.pad)
        boxes.add(Box(spoilerStart, text.length, it.color, true))
      }
      spoiler = null
    }

    for (run in doc.runs) {
      if (run.text.isEmpty()) continue
      // Runs of one box share its key; a new key ends the box before it.
      val spoilerKey = run.spoiler?.let { id ->
        run.spoilerFill?.let { BoxKey(id, ColorCompat.toArgb(it), spoilerPad) }
      }
      val fillPad = run.fillPad ?: 4.0
      val fillKey = run.fillId?.let { id ->
        run.fill?.let { BoxKey(id, ColorCompat.toArgb(it), fillPad.toFloat() * density) }
      }
      if (spoilerKey != spoiler) {
        closeSpoiler()
        if (spoilerKey != null) {
          spoilerStart = text.length
          pad(spoilerKey.pad)
          spoiler = spoilerKey
        }
      }
      if (fillKey != fill) {
        closeFill()
        if (fillKey != null) {
          fillStart = text.length
          pad(fillKey.pad)
          fill = fillKey
          widestPad = max(widestPad, fillPad)
        }
      }

      val start = text.length
      text.append(run.text)
      val end = text.length
      val covered = run.covered == true
      val color = if (covered) Color.TRANSPARENT else run.color?.let { ColorCompat.toArgb(it) } ?: textColor
      val style = RunStyle(
        run.size.toFloat() * density,
        face((run.weight ?: 400.0).toInt(), run.italic == true, run.mono == true),
        color,
        run.underline == true,
        run.strike == true,
      )
      text.setSpan(style, start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      if (covered && run.spoiler != null) {
        text.setSpan(CoveredMark(run.spoiler), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
      val url = run.link
      val linkId = run.linkId
      if (url != null && linkId != null) {
        text.setSpan(LinkMark(linkId, url), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        val link = linksById.getOrPut(linkId) {
          LinkInfo(linkId, url, run.linkHidden == true, start).also { links.add(it) }
        }
        link.end = end
        link.label.append(run.text)
      }
    }
    closeSpoiler()
    slop = (widestPad.toFloat() + 2) * density

    val bodySize = doc.bodySize.toFloat() * density
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = bodySize
      typeface = Typeface.DEFAULT
      color = textColor
    }
    val body = paint.fontMetrics
    val lineHeight = max(1, (doc.lineHeight * density).roundToInt())
    text.setSpan(FixedLineHeight(lineHeight, body.ascent, body.descent), 0, text.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)

    layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, max(1, width))
      .setAlignment(Layout.Alignment.ALIGN_NORMAL)
      .setLineSpacing(0f, 1f)
      .setIncludePad(false)
      .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
      .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
      .setTextDirection(TextDirectionHeuristics.LTR)
      .build()
  }

  // In dp, rounded up as iOS rounds its points up: the view is never
  // shorter than its lines. Each line is a whole number of pixels.
  val heightDp: Double
    get() = ceil(layout.height / density - 0.001).toDouble()

  fun draw(canvas: Canvas) {
    for (spoilers in arrayOf(true, false)) {
      for (box in boxes) {
        if (box.spoiler != spoilers) continue
        fillPaint.color = box.color
        for (rect in boxRects(box.start, box.end)) {
          canvas.drawRoundRect(rect, radius, radius, fillPaint)
        }
      }
    }
    layout.draw(canvas)
  }

  // A range's part on each line it is on: (line, left, right). A part cut
  // by a wrap ends at the line's last visible character.
  private fun segments(start: Int, end: Int, each: (line: Int, left: Float, right: Float, from: Int) -> Unit) {
    if (end <= start) return
    val first = layout.getLineForOffset(start)
    val last = layout.getLineForOffset(end - 1)
    for (line in first..last) {
      val lineEnd = layout.getLineEnd(line)
      val from = max(start, layout.getLineStart(line))
      val to = min(end, lineEnd)
      if (to <= from) continue
      val left = layout.getPrimaryHorizontal(from)
      val right = if (to == lineEnd && line < layout.lineCount - 1) layout.getLineRight(line) else layout.getPrimaryHorizontal(to)
      if (right > left) each(line, left, right, from)
    }
  }

  // A box's rect on each line, the height of its run's font (ascent to
  // descent, as CSS draws an inline background).
  fun boxRects(start: Int, end: Int): List<RectF> {
    val rects = ArrayList<RectF>()
    segments(start, end) { line, left, right, from ->
      var at = from
      while (at < end && pads[at]) at++
      val metrics = (if (at < end) text.getSpans(at, at + 1, RunStyle::class.java).firstOrNull() else null)?.metrics
        ?: layout.paint.fontMetrics
      val baseline = layout.getLineBaseline(line).toFloat()
      rects.add(RectF(left, baseline + metrics.ascent, right, baseline + metrics.descent))
    }
    return rects
  }

  // A link's rect on each line: its words, the line's full height.
  fun lineRects(start: Int, end: Int): List<RectF> {
    val rects = ArrayList<RectF>()
    segments(start, end) { line, left, right, _ ->
      rects.add(RectF(left, layout.getLineTop(line).toFloat(), right, layout.getLineBottom(line).toFloat()))
    }
    return rects
  }

  // The character under a point in the view, if one (or a box's pad) is
  // there; never a pad or a line break itself.
  fun characterAt(x: Float, y: Float): Int? {
    if (text.isEmpty() || y < -2 * density || y > layout.height + 2 * density) return null
    val line = layout.getLineForVertical(y.toInt())
    val lineStart = layout.getLineStart(line)
    val lineEnd = layout.getLineEnd(line)
    val offset = layout.getOffsetForHorizontal(line, x)
    var best: Int? = null
    var bestDistance = Float.MAX_VALUE
    for (index in offset - 1..offset + 1) {
      if (index < lineStart || index >= lineEnd || pads[index] || text[index] == '\n') continue
      val left = layout.getPrimaryHorizontal(index)
      val right = if (index + 1 < lineEnd || line == layout.lineCount - 1) {
        layout.getPrimaryHorizontal(index + 1)
      } else {
        layout.getLineRight(line)
      }
      val low = min(left, right)
      val high = max(left, right)
      val distance = if (x < low) low - x else if (x > high) x - high else 0f
      if (distance <= slop && distance < bestDistance) {
        best = index
        bestDistance = distance
      }
    }
    return best
  }

  // The first covered spoiler's id, for a screen reader's double tap.
  fun firstCovered(): Int? =
    text.getSpans(0, text.length, CoveredMark::class.java).minByOrNull { text.getSpanStart(it) }?.id

  companion object {
    private val faces = ConcurrentHashMap<Int, Typeface>()

    // A no-break space's advance per pixel of text size.
    private val nbspAdvance: Float by lazy {
      val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 100f
        typeface = Typeface.DEFAULT
      }
      max(0.01f, paint.measureText(" ") / 100f)
    }

    fun face(weight: Int, italic: Boolean, mono: Boolean): Typeface {
      val key = (weight shl 2) or (if (italic) 2 else 0) or (if (mono) 1 else 0)
      return faces.getOrPut(key) {
        val bold = weight >= 600
        val style = when {
          bold && italic -> Typeface.BOLD_ITALIC
          bold -> Typeface.BOLD
          italic -> Typeface.ITALIC
          else -> Typeface.NORMAL
        }
        when {
          mono -> Typeface.create(Typeface.MONOSPACE, style)
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.P -> {
            val resolved = if (weight >= 700) 700 else if (weight >= 600) 600 else 400
            Typeface.create(Typeface.DEFAULT, resolved, italic)
          }
          else -> Typeface.create(Typeface.DEFAULT, style)
        }
      }
    }
  }
}
