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
import android.text.style.UpdateLayout
import expo.modules.kotlin.types.ColorCompat
import kotlin.math.roundToInt

// The style resolved to pixels and ints.
internal class EditorLook(record: EditorStyleRecord?, val density: Float) {
  private fun color(value: Color?, fallback: Int) = value?.let { ColorCompat.toArgb(it) } ?: fallback

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
  val listIndentPx = (record?.listIndent ?: 24.0).toFloat() * density
  val radiusPx = (record?.radius ?: 4.0).toFloat() * density
  val fillPadPx = (record?.fillPad ?: 2.0).toFloat() * density
  val metrics = Blocks.Metrics(
    record?.quoteBarWidth ?: 3.0, record?.quotePadX ?: 12.0, record?.listIndent ?: 24.0, record?.prePadX ?: 12.0,
  )

  fun indentPx(info: BlockInfo): Int = (Blocks.indent(info, metrics) * density).roundToInt()
}

// The look's spans, all marked so a restyle takes off only its own.
internal interface Look

// UpdateLayout: the layout reflows when one comes or goes, so a quote or
// list line wraps at its indent, not the full width.
private class LookMargin(px: Int) : LeadingMarginSpan.Standard(px), Look, UpdateLayout

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

private class LookLineHeight(height: Int, ascent: Float, descent: Float) : Look, UpdateLayout,
  android.text.style.LineHeightSpan by FixedLineHeight(height, ascent, descent)

// Draws the look each feature describes (CharLook, Blocks.indent) onto
// the text: faces, colours, lines and each line's indent, as spans. The
// boxes (code, pills, spoilers, code blocks, quote bars, list markers)
// are drawn by the view from the meaning itself (EditorDecorations). Run
// over the lines an edit touched, so typed, pasted and loaded text look
// alike; the meaning spans are read, never changed.
internal object EditorStyler {
  // The look of a meaning, for text not yet typed, as iOS's typing
  // attributes carry it (the Android view puts spans on after the fact,
  // so only the composition is shared).
  fun look(block: BlockInfo, marks: Int, href: String?, mention: Boolean): CharLook {
    var look = Blocks.look(block, CharLook())
    if (block.block == Block.CODE) return look
    look = Marks.look(marks, look)
    if (href != null) look = Links.look(look)
    if (mention) look = Mentions.look(look)
    return look
  }

  // Each line meeting [from, to) styled whole.
  fun restyle(text: Editable, from: Int, to: Int, look: EditorLook, paint: TextPaint) {
    if (text.isEmpty()) return
    var first = Document.lineStart(text, from)
    var last = Document.lineEnd(text, to.coerceIn(0, text.length))
    for (span in text.getSpans(0, text.length, Look::class.java)) {
      if (text.getSpanEnd(span) <= text.getSpanStart(span)) text.removeSpan(span)
    }
    for (span in text.getSpans(first, last, Look::class.java)) {
      first = minOf(first, text.getSpanStart(span))
      last = maxOf(last, text.getSpanEnd(span))
      text.removeSpan(span)
    }
    first = Document.lineStart(text, first)
    last = Document.lineEnd(text, last)
    val metrics = TextPaint(paint).apply { textSize = look.fontSizePx; typeface = Typeface.DEFAULT }.fontMetrics
    Document.forEachLine(text, first, last) { start, end, spanEnd ->
      if (spanEnd <= start) return@forEachLine
      val info = Blocks.at(text, start)
      text.setSpan(LookLineHeight(look.lineHeightPx, metrics.ascent, metrics.descent), start, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      val indent = look.indentPx(info)
      if (indent > 0) text.setSpan(LookMargin(indent), start, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      val cuts = Document.boundaries(text, start, end)
      for (i in 0 until cuts.size - 1) {
        val pieceStart = cuts[i]
        val pieceEnd = cuts[i + 1]
        if (pieceStart >= pieceEnd) continue
        val marks = Marks.at(text, pieceStart, pieceEnd)
        val href = Links.at(text, pieceStart, pieceEnd)
        val mention = Mentions.at(text, pieceStart, pieceEnd) != null
        styleRun(text, pieceStart, pieceEnd, look(info, marks, href, mention), look)
      }
      if (info.block != Block.CODE) {
        for (address in Links.bareAddresses(text, start, end)) {
          text.setSpan(LookColor(look.accent), address.first, address.last + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          text.setSpan(LookUnderline(), address.first, address.last + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
      }
    }
  }

  private fun styleRun(text: Editable, start: Int, end: Int, charLook: CharLook, look: EditorLook) {
    val flags = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
    val bold = charLook.bold || charLook.semibold
    if (bold || charLook.italic || charLook.mono) {
      text.setSpan(LookFace(bold, charLook.italic, charLook.mono, if (charLook.mono) look.fontSizePx * look.codeScale else null), start, end, flags)
    }
    val color = when (charLook.color) {
      CharLook.Color.TEXT -> null
      CharLook.Color.MUTED -> look.muted
      CharLook.Color.ACCENT -> look.accent
    }
    color?.let { text.setSpan(LookColor(it), start, end, flags) }
    if (charLook.underline) text.setSpan(LookUnderline(), start, end, flags)
    if (charLook.strike) text.setSpan(LookStrike(), start, end, flags)
  }
}
