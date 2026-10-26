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
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
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
  // The line a change began in (its start, which the change leaves where
  // it was), its block as it was before, and whether the change took a
  // newline out.
  private var changedLine = 0
  private var changedBlock: BlockInfo? = null
  private var changedNewline = false
  // The last change only took characters away.
  private var deleted = false
  // Marks toggled at a caret, for what is typed there next: Android has
  // no typing attributes, so the view keeps them, and the place they're
  // for, until the caret moves.
  private var pendingMarks: Int? = null
  private var pendingFrom = -1
  private var pendingAt = -1
  // The marks a change's new text is meant to have, taken before it:
  // those of the text it replaces (a keyboard composing a word replaces
  // the whole word at each key), else what typing at its start carries.
  // Set on the text explicitly, rather than left to how the spans stretch
  // over a replace.
  private var replacedMarks: Int? = null
  private var typingMarks = 0
  // Between a change's before and after: the caret moves with the text
  // before the after runs, which is no reason to drop pending marks.
  private var changing = false
  private var snapping = false
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
      override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) {
        changing = true
        val text = s as? Spanned ?: return
        val line = EditorDocument.lineStart(text, start)
        changedLine = line
        changedBlock = EditorDocument.blockAt(text, line) ?: if (line >= text.length) trailingBlock() else null
        changedNewline = (start until start + count).any { text[it] == '\n' }
        replacedMarks = if (count > 0) EditorDocument.marksAt(text, start, start + 1) else null
        typingMarks = caretMarks(text, start)
      }

      override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
        changedFrom = start
        changedTo = start + count
        deleted = before > 0 && count == 0
      }

      override fun afterTextChanged(s: Editable) {
        changing = false
        if (applying) return
        applying = true
        // A pill is one unit: a backspace into one takes it whole.
        if (deleted) takeCutPills(s)
        val pending = pendingMarks
        if (changedTo > changedFrom) {
          if (pending != null && changedFrom <= pendingAt && changedTo > pendingFrom) {
            // Typed where a mark was toggled, however the keyboard put it
            // (a word it composes from before the toggle included):
            // everything since the toggle takes the toggled marks, what
            // came before it keeps its own.
            if (changedFrom < pendingFrom) {
              val before = replacedMarks ?: typingMarks
              EditorMarksEdit.apply(s, changedFrom, pendingFrom) { before }
            }
            EditorMarksEdit.apply(s, pendingFrom, changedTo) { pending }
            pendingAt = changedTo
          } else {
            val intended = replacedMarks ?: typingMarks
            EditorMarksEdit.apply(s, changedFrom, changedTo) { intended }
          }
          // A Return ends what a toggle was for, as on iOS.
          if (s.subSequence(changedFrom, changedTo).contains('\n')) pendingMarks = null
        }
        // The last line emptied by a deletion (a backspace, or a keyboard
        // taking a word out to put it back changed) keeps its block, which
        // no character holds now, until it has words again.
        if (deleted && !changedNewline && changedFrom == s.length && changedLine == changedFrom) {
          explicitTrailing = changedBlock
        }
        restyle(s, changedFrom, changedTo, changedBlock, changedLine)
        applying = false
        if (s.isNotEmpty() && s[s.length - 1] != '\n') explicitTrailing = null
        emitChange()
        post { reportHeight() }
      }
    })
    // The height after each layout: the text's own, which the EditText
    // knows only once it has laid it out (after a send clears it, too).
    field.viewTreeObserver.addOnGlobalLayoutListener { reportHeight() }
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

  private fun restyle(text: Editable, from: Int, to: Int, changed: BlockInfo? = null, changedLine: Int = -1) {
    EditorStyler.restyle(text, from, to, look, field.paint, explicitTrailing, changed, changedLine)
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
    if (changing) {
      // Moved by the text itself, not by the reader: where it settled.
      settledStart = max(0, field.selectionStart)
      settledEnd = max(settledStart, field.selectionEnd)
    } else if (snapSelection()) {
      return
    }
    if (!changing && pendingMarks != null && (field.selectionStart != pendingAt || field.selectionEnd != pendingAt)) {
      pendingMarks = null
    }
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
      "formats" to activeFormats(text, start, end),
    )
  }

  // MARK: Pills

  // The pill whose words hold `at` strictly inside them.
  private fun pill(text: Spanned, at: Int): MentionSpan? =
    text.getSpans(at, at, MentionSpan::class.java)
      .firstOrNull { text.getSpanStart(it) < at && text.getSpanEnd(it) > at }

  // A pill cut short by a deletion goes whole.
  private fun takeCutPills(text: Editable) {
    val from = EditorDocument.lineStart(text, changedFrom)
    val to = EditorDocument.lineEnd(text, changedFrom)
    for (span in text.getSpans(from, to, MentionSpan::class.java)) {
      val a = text.getSpanStart(span)
      val b = text.getSpanEnd(span)
      if (b <= a || b - a >= span.words.length || text.subSequence(a, b).toString() == span.words) continue
      text.removeSpan(span)
      text.delete(a, b)
      changedFrom = minOf(changedFrom, a)
      changedTo = changedFrom
    }
  }

  // The selection as it last settled, for the way an edge is moving.
  private var settledStart = 0
  private var settledEnd = 0

  // A caret or a selection's edge never rests inside a pill: it goes on
  // past it the way it was moving (a caret stepped left from a pill's end
  // goes to its start), or to the nearer edge when it jumped there (a
  // tap). True when it moved it.
  private fun snapSelection(): Boolean {
    if (snapping) return false
    val text = field.text ?: return false
    val start = max(0, field.selectionStart)
    val end = max(start, field.selectionEnd)
    fun edge(at: Int, was: Int): Int {
      val pill = pill(text, at) ?: return at
      val s = text.getSpanStart(pill)
      val e = text.getSpanEnd(pill)
      return when {
        was <= s -> e
        was >= e -> s
        at - s < e - at -> s
        else -> e
      }
    }
    var a = edge(start, settledStart)
    var b = if (start == end) a else edge(end, settledEnd)
    if (b < a) a = b.also { b = a }
    settledStart = a
    settledEnd = b
    if (a == start && b == end) return false
    snapping = true
    field.setSelection(a, b)
    snapping = false
    return true
  }

  // The keyboard may compose only outside pills: a region it would put
  // over a pill's words (Gboard composes the word before the caret) is
  // cut back to the text beside it, so it can't rewrite the pill.
  internal fun composableRegion(start: Int, end: Int): Pair<Int, Int> {
    val text = field.text ?: return start to end
    var a = minOf(start, end)
    var b = maxOf(start, end)
    for (pill in text.getSpans(a, b, MentionSpan::class.java)) {
      val s = text.getSpanStart(pill)
      val e = text.getSpanEnd(pill)
      if (s >= b || e <= a) continue
      if (s <= a) a = maxOf(a, e) else b = minOf(b, s)
    }
    return a to b
  }

  // A pick from the mention list: the query before the caret replaced by
  // a pill, then `after` (its space).
  fun insertMention(count: Int, mention: EditorMentionRecord, after: String) {
    val text = field.text ?: return
    val caret = max(0, field.selectionStart)
    val from = max(EditorDocument.lineStart(text, caret), caret - max(0, count))
    val span = MentionSpan(mention.kind, mention.id, mention.handle)
    BaseInputConnection.removeComposingSpans(text)
    applying = true
    text.replace(from, caret, span.words + after)
    for (href in text.getSpans(from, from + span.words.length, HrefSpan::class.java)) text.removeSpan(href)
    text.setSpan(span, from, from + span.words.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    restyle(text, from, from + span.words.length + after.length)
    applying = false
    emitChange()
  }

  // A handle typed in full that JS found has one owner: its words, at
  // `location`, become the pill, if they are still there as typed.
  fun markMention(location: Int, typed: String, mention: EditorMentionRecord) {
    val text = field.text ?: return
    val end = location + typed.length
    if (location < 0 || end > text.length || text.subSequence(location, end).toString() != typed) return
    if (text.getSpans(location, end, MentionSpan::class.java).any { text.getSpanStart(it) < end && text.getSpanEnd(it) > location }) return
    val span = MentionSpan(mention.kind, mention.id, mention.handle)
    applying = true
    if (span.words != typed) {
      // Typed in other capitals: the pill reads as the handle does.
      BaseInputConnection.removeComposingSpans(text)
      text.replace(location, end, span.words)
    }
    text.setSpan(span, location, location + span.words.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    restyle(text, location, location + span.words.length)
    applying = false
    emitChange()
  }

  // MARK: Formats

  private fun lineBlock(text: Spanned, at: Int): BlockInfo {
    val start = EditorDocument.lineStart(text, at)
    val end = EditorDocument.lineEnd(text, start)
    return if (end > start || end < text.length) {
      EditorDocument.blockAt(text, start) ?: BlockInfo.PARAGRAPH
    } else {
      trailingBlock() ?: BlockInfo.PARAGRAPH
    }
  }

  // What typing at a caret carries: the marks of the character before
  // it on its line, as the spans extend to text typed at their end.
  private fun caretMarks(text: Spanned, at: Int): Int {
    pendingMarks?.let { if (at == pendingAt) return it }
    if (at == 0 || text[at - 1] == '\n') return 0
    return EditorDocument.marksAt(text, at - 1, at)
  }

  // The formats in effect, as web's toolbar names them: at a caret, what
  // typing would carry; over a selection, what all of its words have.
  // And the caret's line's block.
  private fun activeFormats(text: Spanned, start: Int, end: Int): List<String> {
    val block = lineBlock(text, start)
    val formats = ArrayList<String>()
    // A selection is "in a code block" only when none of it can take a
    // mark; one that runs out of a code block into words can.
    val inCode = if (start == end) block.block == Block.CODE else EditorMarksEdit.markableIn(text, start, end).isEmpty()
    if (!inCode) {
      val marks = if (start == end) caretMarks(text, start) else EditorMarksEdit.common(text, start, end)
      formats.addAll(Marks.names(marks))
    }
    when (block.block) {
      Block.QUOTE -> formats.add("quote")
      Block.BULLET -> formats.add("list")
      Block.ORDERED -> formats.add("orderedList")
      Block.CODE -> if (inCode) formats.add("codeblock")
      Block.PARAGRAPH -> {}
    }
    return formats
  }

  // A mark on or off: over a selection, on everywhere unless all of it
  // has it already (web's rule); at a caret, for what is typed next,
  // until the caret moves. Not in a code block, which holds no marks.
  fun format(name: String) {
    val bit = Marks.named.firstOrNull { it.first == name }?.second ?: return
    val text = field.text ?: return
    val start = max(0, field.selectionStart)
    val end = max(start, field.selectionEnd)
    if (start == end) {
      if (lineBlock(text, start).block == Block.CODE) return
      pendingMarks = caretMarks(text, start) xor bit
      pendingFrom = start
      pendingAt = start
      onEditorSelection(selectionPayload())
      return
    }
    val on = EditorMarksEdit.common(text, start, end) and bit == 0
    applying = true
    EditorMarksEdit.apply(text, start, end) { marks -> if (on) marks or bit else marks and bit.inv() }
    restyle(text, start, end)
    applying = false
    emitChange()
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

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    val connection = super.onCreateInputConnection(outAttrs) ?: return null
    return object : InputConnectionWrapper(connection, true) {
      override fun setComposingRegion(start: Int, end: Int): Boolean {
        val (a, b) = owner.composableRegion(start, end)
        return if (a < b) super.setComposingRegion(a, b) else finishComposingText()
      }
    }
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
