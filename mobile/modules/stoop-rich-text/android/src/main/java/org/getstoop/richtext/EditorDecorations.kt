package org.getstoop.richtext

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.text.Layout
import android.text.Spanned
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// What a line's block draws under the words: a code block's box, a
// quote's bar, a list item's bullet or number (Blocks.runs, Blocks.marker
// say which; this finds where each line was laid out), and the boxes
// behind words: inline code, pills, spoilers (hatched). Nothing here is
// text, so the caret and selection never meet it. As on iOS
// (EditorDecorations.swift), with the fills RichLayoutManager draws there.
internal class EditorDecorations {
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val box = RectF()
  private var hatchKey: Pair<Int, Int>? = null
  private var hatchPaint: Paint? = null

  fun draw(canvas: Canvas, text: Spanned, layout: Layout, look: EditorLook, width: Float, metrics: Paint.FontMetrics) {
    drawBlocks(canvas, text, layout, look, width)
    drawFills(canvas, text, layout, look, metrics)
  }

  private data class Line(val start: Int, val end: Int, val info: BlockInfo)

  private fun lines(text: Spanned): List<Line> {
    val out = ArrayList<Line>()
    Document.forEachLine(text) { start, end, spanEnd ->
      if (spanEnd > start) out.add(Line(start, end, Blocks.at(text, start)))
    }
    return out
  }

  private fun drawBlocks(canvas: Canvas, text: Spanned, layout: Layout, look: EditorLook, width: Float) {
    val lines = lines(text)
    val blocks = lines.map { it.info }
    for (run in Blocks.runs(blocks)) {
      val top = layout.getLineTop(layout.getLineForOffset(lines[run.first].start)).toFloat()
      val bottom = layout.getLineBottom(layout.getLineForOffset(lines[run.last].end)).toFloat()
      when (run.kind) {
        Block.CODE -> {
          box.set(0.5f, top + 0.5f, width - 0.5f, bottom - 0.5f)
          val radius = look.radiusPx + 2 * look.density
          fillPaint.shader = null
          fillPaint.color = look.raised
          canvas.drawRoundRect(box, radius, radius, fillPaint)
          strokePaint.color = look.border
          strokePaint.strokeWidth = look.density
          canvas.drawRoundRect(box, radius, radius, strokePaint)
        }
        Block.QUOTE -> {
          fillPaint.shader = null
          fillPaint.color = look.border
          canvas.drawRect(0f, top, look.quoteBarPx, bottom, fillPaint)
        }
        else -> {}
      }
    }
    markerPaint.textSize = look.fontSizePx
    markerPaint.color = look.muted
    for ((index, line) in lines.withIndex()) {
      val marker = Blocks.marker(blocks, index) ?: continue
      // Right-aligned in the indent, on the line's baseline.
      val indent = look.listIndentPx * (line.info.depth + 1)
      val x = indent - 6 * look.density - markerPaint.measureText(marker)
      val baseline = layout.getLineBaseline(layout.getLineForOffset(line.start)).toFloat()
      canvas.drawText(marker, x, baseline, markerPaint)
    }
  }

  // The rounded boxes behind words: spoilers (hatched) under, inline code
  // and pills on top.
  private fun drawFills(canvas: Canvas, text: Spanned, layout: Layout, look: EditorLook, metrics: Paint.FontMetrics) {
    for (span in text.getSpans(0, text.length, MarksSpan::class.java)) {
      if (span.marks and Marks.SPOILER != 0) drawBox(canvas, layout, text.getSpanStart(span), text.getSpanEnd(span), hatch(look), look, metrics)
    }
    for (span in text.getSpans(0, text.length, MarksSpan::class.java)) {
      if (span.marks and Marks.CODE == 0) continue
      val start = text.getSpanStart(span)
      if (Blocks.atLineOf(text, start).block == Block.CODE) continue
      fillPaint.shader = null
      fillPaint.color = look.raised
      drawBox(canvas, layout, start, text.getSpanEnd(span), fillPaint, look, metrics)
    }
    for (span in text.getSpans(0, text.length, MentionSpan::class.java)) {
      fillPaint.shader = null
      fillPaint.color = look.mentionFill
      drawBox(canvas, layout, text.getSpanStart(span), text.getSpanEnd(span), fillPaint, look, metrics)
    }
  }

  private fun drawBox(canvas: Canvas, layout: Layout, start: Int, end: Int, paint: Paint, look: EditorLook, metrics: Paint.FontMetrics) {
    if (end <= start) return
    val first = layout.getLineForOffset(start)
    val last = layout.getLineForOffset(max(start, end - 1))
    for (line in first..last) {
      val from = max(start, layout.getLineStart(line))
      val to = min(end, layout.getLineEnd(line))
      if (to <= from) continue
      val left = layout.getPrimaryHorizontal(from)
      val right = if (to >= layout.getLineEnd(line)) layout.getLineRight(line) else layout.getPrimaryHorizontal(to)
      val baseline = layout.getLineBaseline(line).toFloat()
      box.set(left - look.fillPadPx, baseline + metrics.ascent, right + look.fillPadPx, baseline + metrics.descent)
      canvas.drawRoundRect(box, look.radiusPx, look.radiusPx, paint)
    }
  }

  // The spoiler's fill: diagonal stripes of the hatch colour over the
  // raised one, as the artboards draw it.
  private fun hatch(look: EditorLook): Paint {
    val key = look.raised to look.hatch
    hatchPaint?.let { if (hatchKey == key) return it }
    val side = (10 * look.density).roundToInt().coerceAtLeast(2)
    val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(look.raised)
    val stripe = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = look.hatch
      strokeWidth = side / 2f / 1.4142f
      style = Paint.Style.STROKE
    }
    for (offset in -side..side * 2 step side) {
      canvas.drawLine(offset.toFloat(), side.toFloat(), (offset + side).toFloat(), 0f, stripe)
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT) }
    hatchKey = key
    hatchPaint = paint
    return paint
  }
}
