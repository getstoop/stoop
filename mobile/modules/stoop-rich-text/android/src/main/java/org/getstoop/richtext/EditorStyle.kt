package org.getstoop.richtext

import android.graphics.Color
import android.graphics.Typeface
import android.text.Editable
import android.text.Spanned
import android.text.TextPaint
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.MetricAffectingSpan
import android.text.style.StrikethroughSpan
import android.text.style.UnderlineSpan
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.ColorCompat
import kotlin.math.roundToInt

// The composer's look, from the theme (RichField.tsx), as on iOS
// (EditorStyle.swift). Sizes in dp.
class EditorStyleRecord : Record {
  @Field val textColor: Color? = null
  @Field val mutedColor: Color? = null
  @Field val accentColor: Color? = null
  @Field val mentionFill: Color? = null
  @Field val raised: Color? = null
  @Field val border: Color? = null
  @Field val hatch: Color? = null
  @Field val placeholderColor: Color? = null
  @Field val fontSize: Double = 17.0
  @Field val lineHeight: Double = 23.0
  @Field val codeScale: Double = 0.9
  @Field val quoteBarWidth: Double = 3.0
  @Field val quotePadX: Double = 12.0
  @Field val listIndent: Double = 24.0
  @Field val prePadX: Double = 12.0
  @Field val radius: Double = 4.0
  @Field val fillPad: Double = 2.0
}

// The style resolved to pixels and ints.
internal class EditorLook(record: EditorStyleRecord?, val density: Float) {
  private fun color(value: android.graphics.Color?, fallback: Int) = value?.let { ColorCompat.toArgb(it) } ?: fallback

  val text = color(record?.textColor, Color.BLACK)
  val muted = color(record?.mutedColor, Color.GRAY)
  val accent = color(record?.accentColor, Color.BLUE)
  val mentionFill = color(record?.mentionFill, Color.LTGRAY)
  val raised = color(record?.raised, Color.LTGRAY)
  val border = color(record?.border, Color.GRAY)
  val hatch = color(record?.hatch, Color.GRAY)
  val placeholder = color(record?.placeholderColor, Color.GRAY)
  val fontSizePx = (record?.fontSize ?: 17.0).toFloat() * density
  val lineHeightPx = ((record?.lineHeight ?: 23.0) * density).roundToInt()
  val codeScale = (record?.codeScale ?: 0.9).toFloat()
  val quoteBarPx = (record?.quoteBarWidth ?: 3.0).toFloat() * density
  val quotePadPx = (record?.quotePadX ?: 12.0).toFloat() * density
  val listIndentPx = (record?.listIndent ?: 24.0).toFloat() * density
  val prePadPx = (record?.prePadX ?: 12.0).toFloat() * density
  val radiusPx = (record?.radius ?: 4.0).toFloat() * density
  val fillPadPx = (record?.fillPad ?: 2.0).toFloat() * density

  fun indent(info: BlockInfo): Int = when (info.block) {
    Block.QUOTE -> quoteBarPx + quotePadPx
    Block.BULLET, Block.ORDERED -> listIndentPx * (info.depth + 1)
    Block.CODE -> prePadPx
    Block.PARAGRAPH -> 0f
  }.roundToInt()
}

// The look's spans, all marked so a restyle takes off only its own.
internal interface Look

private class LookMargin(px: Int) : LeadingMarginSpan.Standard(px), Look

private class LookColor(color: Int) : ForegroundColorSpan(color), Look

private class LookUnderline : UnderlineSpan(), Look

private class LookStrike : StrikethroughSpan(), Look

// A run's face; code also its size, set outright (a scale applied to the
// paint's size would compound wherever the paint is reused).
private class LookFace(private val bold: Boolean, private val italic: Boolean, private val mono: Boolean, private val sizePx: Float?) :
  MetricAffectingSpan(), Look {
  private fun apply(paint: TextPaint) {
    val style = (if (bold) Typeface.BOLD else 0) or (if (italic) Typeface.ITALIC else 0)
    paint.typeface = if (mono) Typeface.create("monospace", style) else Typeface.create(Typeface.DEFAULT, style)
    sizePx?.let { paint.textSize = it }
  }
  override fun updateMeasureState(paint: TextPaint) = apply(paint)
  override fun updateDrawState(paint: TextPaint) = apply(paint)
}

private class LookLineHeight(height: Int, ascent: Float, descent: Float) : Look,
  android.text.style.LineHeightSpan by FixedLineHeight(height, ascent, descent)

// Gives text its look from its meaning (EditorModel's spans), over each
// line a change touched: faces, colours, indents. The boxes (code, pills,
// spoilers, code blocks, quote bars, list markers) are drawn by the view
// from the meaning itself (EditorText.onDraw).
internal object EditorStyler {
  fun restyle(
    text: Editable, from: Int, to: Int, look: EditorLook, paint: TextPaint, trailing: BlockInfo?, changed: BlockInfo? = null,
  ) {
    EditorDocument.dropBrokenMentions(text, from, to)
    EditorDocument.cutMarksAtLines(text, from, to)
    // A paragraph span a Return or a join stretched over other lines is
    // taken off whole, and every line it covered styled again.
    var first = EditorDocument.lineStart(text, from)
    var last = EditorDocument.lineEnd(text, to)
    for (span in text.getSpans(first, last, Look::class.java)) {
      first = minOf(first, text.getSpanStart(span))
      last = maxOf(last, text.getSpanEnd(span))
      text.removeSpan(span)
    }
    first = EditorDocument.lineStart(text, first)
    last = EditorDocument.lineEnd(text, last)
    EditorDocument.normaliseBlocks(text, first, last, trailing, changed)
    var start = first
    val metrics = TextPaint(paint).apply { textSize = look.fontSizePx; typeface = Typeface.DEFAULT }.fontMetrics
    while (true) {
      val end = EditorDocument.lineEnd(text, start)
      val spanEnd = if (end < text.length) end + 1 else end
      if (spanEnd > start) {
        val info = EditorDocument.blockAt(text, start) ?: BlockInfo.PARAGRAPH
        text.setSpan(LookLineHeight(look.lineHeightPx, metrics.ascent, metrics.descent), start, spanEnd, Spanned.SPAN_PARAGRAPH)
        val indent = look.indent(info)
        if (indent > 0) text.setSpan(LookMargin(indent), start, spanEnd, Spanned.SPAN_PARAGRAPH)
        val cuts = EditorDocument.boundaries(text, start, end)
        for (i in 0 until cuts.size - 1) {
          val a = cuts[i]
          val b = cuts[i + 1]
          if (a >= b) continue
          styleRun(text, a, b, info, look)
        }
      }
      if (end >= last || end >= text.length) break
      start = end + 1
    }
  }

  private fun styleRun(text: Editable, start: Int, end: Int, info: BlockInfo, look: EditorLook) {
    val codeBlock = info.block == Block.CODE
    val marks = if (codeBlock) 0 else EditorDocument.marksAt(text, start, end)
    val mention = EditorDocument.mentionAt(text, start, end)
    val href = EditorDocument.hrefAt(text, start, end)
    val mono = codeBlock || marks and Marks.CODE != 0
    val bold = marks and Marks.BOLD != 0 || mention != null
    val italic = marks and Marks.ITALIC != 0
    val flags = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
    if (bold || italic || mono) {
      text.setSpan(LookFace(bold, italic, mono, if (mono) look.fontSizePx * look.codeScale else null), start, end, flags)
    }
    val color = when {
      href != null || mention != null -> look.accent
      info.block == Block.QUOTE -> look.muted
      else -> null
    }
    color?.let { text.setSpan(LookColor(it), start, end, flags) }
    if (!codeBlock && (marks and Marks.UNDERLINE != 0 || href != null)) text.setSpan(LookUnderline(), start, end, flags)
    if (!codeBlock && marks and Marks.STRIKE != 0) text.setSpan(LookStrike(), start, end, flags)
  }
}
