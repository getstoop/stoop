package org.getstoop.richtext

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.InputMethodManager
import androidx.appcompat.widget.AppCompatEditText
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// The composer's field, as on iOS (RichEditorView.swift): an EditText that
// holds the draft as text with its meaning (EditorModel's spans) and draws
// it formatted (EditorStyler's spans, and the boxes drawn here). Typing
// never waits on JS: the view tells JS what the text now is
// (onEditorChange, as lines), and JS asks it to do things (the functions
// in StoopRichTextModule).
class RichEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onEditorChange by EventDispatcher()
  private val onEditorSelection by EventDispatcher()
  private val onEditorHeight by EventDispatcher()
  private val onEditorFocus by EventDispatcher()
  private val onEditorBlur by EventDispatcher()

  override val shouldUseAndroidLayout = true

  private val density = resources.displayMetrics.density
  internal var look = EditorLook(null, density)
  internal val field = EditorText(context, this)
  private var applying = false
  private var lastHeight = -1
  private var changedFrom = 0
  private var changedTo = 0
  var autoFocus = false
  private var focusedOnce = false
  // The block of an empty last line, which no character holds: one the
  // text was loaded with (or a command set), until the line has words.
  internal var explicitTrailing: BlockInfo? = null
  private var loadedRevision = -1

  var label: String = ""
  var fieldId: String = ""

  init {
    addView(field, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    field.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) {}

      override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
        changedFrom = start
        changedTo = start + count
      }

      override fun afterTextChanged(s: Editable) {
        if (applying) return
        applying = true
        restyle(s, changedFrom, changedTo)
        applying = false
        if (s.isNotEmpty() && s[s.length - 1] != '\n') explicitTrailing = null
        emitChange()
        post { reportHeight() }
      }
    })
    field.setOnFocusChangeListener { _, focused ->
      if (focused) onEditorFocus(emptyMap<String, Any>()) else onEditorBlur(emptyMap<String, Any>())
    }
    ViewCompat.setAccessibilityDelegate(field, object : AccessibilityDelegateCompat() {
      override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
        super.onInitializeAccessibilityNodeInfo(host, info)
        if (fieldId.isNotEmpty()) info.viewIdResourceName = fieldId
        if (label.isNotEmpty()) info.hintText = label
      }
    })
  }

  fun setStyle(record: EditorStyleRecord) {
    look = EditorLook(record, density)
    field.applyLook()
    field.text?.let { text ->
      applying = true
      restyle(text, 0, text.length)
      applying = false
    }
    field.invalidate()
  }

  fun setPlaceholder(text: String) {
    field.hint = text
  }

  private fun restyle(text: Editable, from: Int, to: Int) {
    EditorStyler.restyle(text, from, to, look, field.paint, explicitTrailing)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (autoFocus && !focusedOnce) {
      focusedOnce = true
      post { focus() }
    }
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    post { reportHeight() }
  }

  private fun reportHeight() {
    val layout = field.layout ?: return
    val px = layout.height + field.totalPaddingTop + field.totalPaddingBottom
    val height = ceil(px / density).toInt()
    if (abs(height - lastHeight) >= 1) {
      lastHeight = height
      onEditorHeight(mapOf("height" to height))
    }
  }

  // The block of an empty last line: one set explicitly, else the block of
  // the line before it (a Return carried it over).
  internal fun trailingBlock(): BlockInfo? {
    val text = field.text ?: return explicitTrailing
    if (text.isNotEmpty() && text[text.length - 1] != '\n') return null
    explicitTrailing?.let { return it }
    if (text.isEmpty()) return null
    return EditorDocument.blockAt(text, EditorDocument.lineStart(text, text.length - 1))
  }

  internal fun selectionChanged() {
    if (applying) return
    field.invalidate()
    onEditorSelection(selectionPayload())
  }

  private fun selectionPayload(): Map<String, Any> {
    val text = field.text ?: return emptyMap()
    val start = max(0, field.selectionStart)
    val end = max(start, field.selectionEnd)
    return mapOf(
      // The document revision the text is from, so JS can drop a change
      // that was on its way when it loaded another.
      "revision" to loadedRevision,
      "selection" to mapOf("start" to start, "end" to end),
      "before" to EditorDocument.textBefore(text, start),
    )
  }

  internal fun linesJson(): List<Map<String, Any>> {
    val text = field.text ?: return emptyList()
    return EditorDocument.lines(text, trailingBlock())
  }

  internal fun emitChange() {
    field.invalidate()
    val payload = selectionPayload().toMutableMap()
    payload["lines"] = linesJson()
    onEditorChange(payload)
  }

  // MARK: Commands from JS

  // The document prop: loaded once per revision, so a re-render with the
  // same one leaves what has been typed since alone.
  fun setDocument(document: EditorDocumentRecord) {
    if (document.revision == loadedRevision) return
    loadedRevision = document.revision
    load(document.lines)
  }

  fun load(lines: List<EditorLineRecord>) {
    val text = field.text ?: return
    val last = lines.lastOrNull()
    explicitTrailing = if (last != null && last.runs.isEmpty()) {
      BlockInfo(Block.of(last.block), last.depth, last.group, last.lang).normalised()
    } else {
      null
    }
    applying = true
    text.replace(0, text.length, EditorDocument.build(lines))
    restyle(text, 0, text.length)
    applying = false
    field.setSelection(text.length)
    // The keyboard starts afresh on the new text, so a word it was
    // composing isn't committed into it.
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.restartInput(field)
    field.invalidate()
    onEditorSelection(selectionPayload())
    post { reportHeight() }
  }

  fun focus() {
    field.requestFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT)
  }

  fun blur() {
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.hideSoftInputFromWindow(field.windowToken, 0)
    field.clearFocus()
  }

  // The `count` characters before the caret (a mention query) replaced by
  // text, as if typed there.
  fun replaceBeforeCaret(count: Int, text: String) {
    val editable = field.text ?: return
    val caret = max(0, field.selectionStart)
    val from = max(EditorDocument.lineStart(editable, caret), caret - max(0, count))
    BaseInputConnection.removeComposingSpans(editable)
    editable.replace(from, caret, text)
  }

  // Any word still being composed is taken as it stands, and the lines
  // returned, for a send.
  fun commit(): List<Map<String, Any>> {
    field.text?.let { BaseInputConnection.removeComposingSpans(it) }
    return linesJson()
  }
}

// The text field itself, which draws the boxes under its words.
@SuppressLint("ViewConstructor")
internal class EditorText(context: Context, private val owner: RichEditorView) : AppCompatEditText(context) {
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val box = RectF()
  private var hatchKey: Pair<Int, Int>? = null
  private var hatchPaint: Paint? = null
  // Set once constructed: the EditText calls onSelectionChanged from its
  // own constructor, before the owner's field is assigned.
  private var ready = false

  init {
    background = null
    gravity = Gravity.TOP or Gravity.START
    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
      InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
    isVerticalScrollBarEnabled = true
    val d = context.resources.displayMetrics.density
    setPadding((10 * d).roundToInt(), (11 * d).roundToInt(), (10 * d).roundToInt(), (8 * d).roundToInt())
    // Lines end in "\n" only: a pasted "\r", or a line or paragraph
    // separator, is put in as one, so both platforms read the same lines.
    filters = arrayOf(InputFilter { source, start, end, _, _, _ ->
      val piece = source.subSequence(start, end)
      if (piece.none { it == '\r' || it == '\u2028' || it == '\u2029' }) {
        null
      } else {
        val plain = SpannableStringBuilder(piece)
        var i = 0
        while (i < plain.length) {
          when (plain[i]) {
            '\r' -> if (i + 1 < plain.length && plain[i + 1] == '\n') plain.delete(i, i + 1) else plain.replace(i, i + 1, "\n")
            '\u2028', '\u2029' -> plain.replace(i, i + 1, "\n")
          }
          i++
        }
        plain
      }
    })
    applyLook()
    ready = true
  }

  fun applyLook() {
    val look = owner.look
    setTextColor(look.text)
    setHintTextColor(look.placeholder)
    setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, look.fontSizePx)
    highlightColor = (look.accent and 0x00ffffff) or 0x44000000
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    if (ready) owner.selectionChanged()
  }

  override fun onDraw(canvas: Canvas) {
    val text = text
    val layout = layout
    if (text != null && layout != null) {
      canvas.save()
      canvas.translate(totalPaddingLeft.toFloat(), totalPaddingTop.toFloat())
      drawBlocks(canvas, text, layout)
      drawFills(canvas, text, layout)
      canvas.restore()
    }
    super.onDraw(canvas)
  }

  private data class LineInfo(val start: Int, val end: Int, val info: BlockInfo)

  private fun lines(text: Spanned): List<LineInfo> {
    val out = ArrayList<LineInfo>()
    var start = 0
    while (start <= text.length) {
      val end = EditorDocument.lineEnd(text, start)
      val info = if (end > start || end < text.length) {
        EditorDocument.blockAt(text, start) ?: BlockInfo.PARAGRAPH
      } else {
        owner.trailingBlock() ?: BlockInfo.PARAGRAPH
      }
      out.add(LineInfo(start, end, info))
      if (end >= text.length) break
      start = end + 1
    }
    return out
  }

  private fun drawBlocks(canvas: Canvas, text: Spanned, layout: Layout) {
    val look = owner.look
    val lines = lines(text)
    val width = (width - totalPaddingLeft - totalPaddingRight).toFloat()
    var i = 0
    while (i < lines.size) {
      val line = lines[i]
      when (line.info.block) {
        Block.CODE -> {
          var end = i + 1
          while (end < lines.size && lines[end].info.block == Block.CODE && lines[end].info.group == line.info.group) end++
          val top = layout.getLineTop(layout.getLineForOffset(line.start)).toFloat()
          val bottom = layout.getLineBottom(layout.getLineForOffset(lines[end - 1].end)).toFloat()
          box.set(0.5f, top + 0.5f, width - 0.5f, bottom - 0.5f)
          val r = look.radiusPx + 2 * look.density
          fillPaint.color = look.raised
          canvas.drawRoundRect(box, r, r, fillPaint)
          strokePaint.color = look.border
          strokePaint.strokeWidth = look.density
          canvas.drawRoundRect(box, r, r, strokePaint)
          i = end
          continue
        }
        Block.QUOTE -> {
          var end = i + 1
          while (end < lines.size && lines[end].info.block == Block.QUOTE) end++
          val top = layout.getLineTop(layout.getLineForOffset(line.start)).toFloat()
          val bottom = layout.getLineBottom(layout.getLineForOffset(lines[end - 1].end)).toFloat()
          fillPaint.color = look.border
          canvas.drawRect(0f, top, look.quoteBarPx, bottom, fillPaint)
          i = end
          continue
        }
        Block.BULLET, Block.ORDERED -> drawMarker(canvas, lines, i, layout)
        Block.PARAGRAPH -> {}
      }
      i++
    }
  }

  // A bullet by level (•, ◦, ▪), or the item's number counted among the
  // items before it at its level, right-aligned in the indent.
  private fun drawMarker(canvas: Canvas, lines: List<LineInfo>, index: Int, layout: Layout) {
    val look = owner.look
    val line = lines[index]
    val marker = if (line.info.block == Block.ORDERED) {
      var number = 1
      var back = index - 1
      while (back >= 0 && lines[back].info.block.isList && lines[back].info.depth >= line.info.depth) {
        if (lines[back].info.depth == line.info.depth) {
          if (lines[back].info.block != Block.ORDERED) break
          number++
        }
        back--
      }
      "$number."
    } else {
      listOf("•", "◦", "▪", "•")[min(line.info.depth, 3)]
    }
    markerPaint.textSize = look.fontSizePx
    markerPaint.color = look.muted
    val indent = look.listIndentPx * (line.info.depth + 1)
    val x = indent - 6 * look.density - markerPaint.measureText(marker)
    val baseline = layout.getLineBaseline(layout.getLineForOffset(line.start)).toFloat()
    canvas.drawText(marker, x, baseline, markerPaint)
  }

  // The rounded boxes behind words: inline code, pills, spoilers (hatched).
  private fun drawFills(canvas: Canvas, text: Spanned, layout: Layout) {
    val look = owner.look
    for (span in text.getSpans(0, text.length, MarksSpan::class.java)) {
      val start = text.getSpanStart(span)
      val end = text.getSpanEnd(span)
      if (span.marks and Marks.SPOILER != 0) drawBox(canvas, layout, start, end, hatch())
    }
    for (span in text.getSpans(0, text.length, MarksSpan::class.java)) {
      if (span.marks and Marks.CODE == 0) continue
      val start = text.getSpanStart(span)
      if ((EditorDocument.blockAt(text, EditorDocument.lineStart(text, start)) ?: BlockInfo.PARAGRAPH).block == Block.CODE) continue
      fillPaint.shader = null
      fillPaint.color = look.raised
      drawBox(canvas, layout, start, text.getSpanEnd(span), fillPaint)
    }
    for (span in text.getSpans(0, text.length, MentionSpan::class.java)) {
      fillPaint.shader = null
      fillPaint.color = look.mentionFill
      drawBox(canvas, layout, text.getSpanStart(span), text.getSpanEnd(span), fillPaint)
    }
  }

  private fun drawBox(canvas: Canvas, layout: Layout, start: Int, end: Int, paint: Paint) {
    if (end <= start) return
    val look = owner.look
    val metrics = this@EditorText.paint.fontMetrics
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
  private fun hatch(): Paint {
    val look = owner.look
    val key = look.raised to look.hatch
    hatchPaint?.let { if (hatchKey == key) return it }
    val side = (10 * look.density).roundToInt().coerceAtLeast(2)
    val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val c = Canvas(bitmap)
    c.drawColor(look.raised)
    val stripe = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = look.hatch
      strokeWidth = side / 2f / 1.4142f
      style = Paint.Style.STROKE
    }
    for (offset in -side..side * 2 step side) {
      c.drawLine(offset.toFloat(), side.toFloat(), (offset + side).toFloat(), 0f, stripe)
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT) }
    hatchKey = key
    hatchPaint = paint
    return paint
  }
}
