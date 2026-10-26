package org.getstoop.richtext

import android.annotation.SuppressLint
import android.content.ClipboardManager
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
import android.view.KeyEvent
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
  private val onEditorPaste by EventDispatcher()
  private val onEditorCopy by EventDispatcher()
  internal val onEditorKey by EventDispatcher()

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
        // Typed at the caret: the shortcut it completes, if any.
        if (!deleted && changedTo > changedFrom && field.selectionStart == changedTo) applyTypedRules(s, changedTo)
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
    if (EditorDocument.normaliseListDepths(text)) {
      EditorStyler.restyle(text, 0, text.length, look, field.paint, explicitTrailing)
    }
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
    lastRule?.let { if (!changing && (field.selectionStart != it.end || field.selectionEnd != it.end)) lastRule = null }
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
    field.text?.let { plainKeyboard(lineBlock(it, max(0, field.selectionStart)).block == Block.CODE) }
    field.invalidate()
    onEditorSelection(selectionPayload())
  }

  private fun selectionPayload(): Map<String, Any> {
    val text = field.text ?: return emptyMap()
    val start = max(0, minOf(field.selectionStart, field.selectionEnd))
    val end = max(start, maxOf(field.selectionStart, field.selectionEnd))
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
    val start = max(0, minOf(field.selectionStart, field.selectionEnd))
    val end = max(start, maxOf(field.selectionStart, field.selectionEnd))
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
    if (link(text, start, end) != null) formats.add("link")
    when (block.block) {
      Block.QUOTE -> formats.add("quote")
      Block.BULLET -> formats.add("list")
      Block.ORDERED -> formats.add("orderedList")
      Block.CODE -> if (inCode) formats.add("codeblock")
      Block.PARAGRAPH -> {}
    }
    return formats
  }

  // MARK: Blocks

  private data class TouchedLine(val start: Int, val end: Int, val info: BlockInfo)

  // The lines a caret or selection touches, each with its block (start
  // and end before its newline); an empty last line with its typing block.
  private fun touchedLines(): List<TouchedLine> {
    val text = field.text ?: return emptyList()
    val from = max(0, minOf(field.selectionStart, field.selectionEnd))
    val to = max(from, maxOf(field.selectionStart, field.selectionEnd))
    val out = ArrayList<TouchedLine>()
    var start = EditorDocument.lineStart(text, from)
    while (true) {
      val end = EditorDocument.lineEnd(text, start)
      out.add(TouchedLine(start, end, lineBlock(text, start)))
      if (end >= to || end >= text.length) break
      start = end + 1
    }
    return out
  }

  // A line given a block: its span replaced (an empty last line's through
  // its typing block). A code block holds plain text: marks, links and
  // pills go, the words stay.
  private fun setLineBlock(text: Editable, start: Int, end: Int, info: BlockInfo) {
    if (end == start && start == text.length) {
      explicitTrailing = info
      return
    }
    val spanEnd = if (end < text.length) end + 1 else end
    for (span in text.getSpans(start, spanEnd, BlockSpan::class.java)) {
      val s = text.getSpanStart(span)
      val e = text.getSpanEnd(span)
      if (s >= spanEnd || e <= start) continue
      text.removeSpan(span)
      if (s < start) text.setSpan(BlockSpan(span.info), s, start, Spanned.SPAN_PARAGRAPH)
      if (e > spanEnd) text.setSpan(BlockSpan(span.info), spanEnd, e, Spanned.SPAN_PARAGRAPH)
    }
    text.setSpan(BlockSpan(info.normalised()), start, spanEnd, Spanned.SPAN_PARAGRAPH)
    if (info.block == Block.CODE && end > start) {
      for (kind in listOf(MarksSpan::class.java, HrefSpan::class.java, MentionSpan::class.java)) {
        for (span in text.getSpans(start, end, kind)) {
          val s = text.getSpanStart(span)
          val e = text.getSpanEnd(span)
          if (s >= end || e <= start) continue
          text.removeSpan(span)
          if (kind == MentionSpan::class.java) continue
          if (s < start) text.setSpan(remake(span), s, start, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
          if (e > end) text.setSpan(remake(span), end, e, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
        }
      }
    }
  }

  // A fresh copy of a meaning span, for the part of it a cut leaves.
  private fun remake(span: Any): Any =
    when (span) {
      is MarksSpan -> MarksSpan(span.marks)
      is HrefSpan -> HrefSpan(span.href)
      else -> span
    }

  private fun setBlocks(lines: List<TouchedLine>) {
    val text = field.text ?: return
    if (lines.isEmpty()) return
    // An empty last line left out keeps the block it has now, which comes
    // from the line before it unless pinned.
    if (explicitTrailing == null && text.isNotEmpty() && text[text.length - 1] == '\n' &&
      lines.none { it.start == text.length }
    ) {
      explicitTrailing = trailingBlock()
    }
    applying = true
    for (line in lines) setLineBlock(text, line.start, line.end, line.info)
    restyle(text, lines.first().start, lines.last().end)
    applying = false
    emitChange()
    keyboardFor(text)
  }

  // The keyboard for where the caret now is, after a change that didn't
  // move it; restarted after any change the keyboard is making.
  private fun keyboardFor(text: Spanned) {
    val code = lineBlock(text, max(0, field.selectionStart)).block == Block.CODE
    if (changing) post { plainKeyboard(code) } else plainKeyboard(code)
  }

  private var codeGroups = 0

  // Quote or code block on every line the caret or selection touches, or
  // off (back to plain lines) when all of them have it already. Lines
  // made a code block become one new block.
  private fun toggleBlock(kind: Block) {
    // On or off by the first line, as web decides (in one, out of it).
    val lines = touchedLines()
    val on = lines.firstOrNull()?.info?.block != kind
    codeGroups++
    val made = if (on) BlockInfo(kind, 0, if (kind == Block.CODE) 1_000_000 + codeGroups else 0) else BlockInfo.PARAGRAPH
    setBlocks(lines.map { it.copy(info = made) })
  }

  // A bulleted or numbered list on every line touched, or off when the
  // first is in that list already (web decides by where the selection
  // starts). A line already in a list keeps its level.
  private fun toggleList(kind: Block) {
    val lines = touchedLines()
    val on = lines.firstOrNull()?.info?.block != kind
    setBlocks(lines.map { it.copy(info = if (on) BlockInfo(kind, if (it.info.block.isList) it.info.depth else 0) else BlockInfo.PARAGRAPH) })
  }

  // Indent (one level deeper, four at most, and never more than one past
  // the item before) or outdent (one level up; from the top level, out of
  // the list) each list line touched.
  private fun indent(step: Int) {
    val text = field.text ?: return
    val touched = touchedLines().filter { it.info.block.isList }
    if (touched.isEmpty()) return
    // An outdented item brings the items under it along, as web lifts an
    // item with its children.
    val lines = ArrayList(touched)
    if (step < 0) {
      val last = touched.last()
      var start = last.end + 1
      while (start < text.length) {
        val end = EditorDocument.lineEnd(text, start)
        val info = EditorDocument.blockAt(text, start)
        if (info == null || !info.block.isList || info.depth <= last.info.depth) break
        lines.add(TouchedLine(start, end, info))
        start = end + 1
      }
    }
    val first = lines[0].start
    var previous: Int? = if (first > 0) {
      EditorDocument.blockAt(text, EditorDocument.lineStart(text, first - 1))?.takeIf { it.block.isList }?.depth
    } else {
      null
    }
    val changed = lines.map { line ->
      val info = line.info
      val next = when {
        step > 0 -> {
          val deepest = minOf(3, (previous ?: -1) + 1)
          BlockInfo(info.block, minOf(info.depth + 1, maxOf(info.depth, deepest)))
        }
        info.depth > 0 -> BlockInfo(info.block, info.depth - 1)
        else -> BlockInfo.PARAGRAPH
      }
      previous = if (next.block.isList) next.depth else null
      line.copy(info = next)
    }
    setBlocks(changed)
  }

  // Return on an empty quote line, or on a code block's blank last line,
  // leaves the block: the line becomes a plain one; on an empty list item
  // it goes up a level, or out of the list from the top. Backspace at the
  // start of a quote line, a list item, or a code block's first line makes
  // it a plain line rather than joining it to the one before. Seen by the input
  // filter (soft keyboards send text, not keys); true when handled, and
  // the change is then made after the filter returns.
  internal fun blockKey(inserted: CharSequence, dstart: Int, dend: Int): Boolean {
    // Not the field's own edits (a load, a pill), only typing.
    if (applying) return false
    val text = field.text ?: return false
    // A backspace straight after a typing shortcut puts its markers back.
    lastRule?.let { rule ->
      lastRule = null
      if (inserted.isEmpty() && dend == dstart + 1 && dend == rule.end && field.selectionStart == dend) {
        post { undoRule(rule) }
        return true
      }
    }
    if (field.selectionStart != field.selectionEnd) return false
    if (inserted.toString() == "\n" && dstart == dend) {
      val start = EditorDocument.lineStart(text, dstart)
      val end = EditorDocument.lineEnd(text, dstart)
      if (end > start) return false
      val info = lineBlock(text, start)
      val made = when {
        info.block == Block.QUOTE || (info.block == Block.CODE && lastOfCodeBlock(text, end, info)) -> BlockInfo.PARAGRAPH
        info.block.isList -> if (info.depth > 0) BlockInfo(info.block, info.depth - 1) else BlockInfo.PARAGRAPH
        else -> return false
      }
      post { blockAtCaret(info) { made } }
      return true
    }
    if (inserted.isEmpty() && dend == dstart + 1 && text[dstart] == '\n' && field.selectionStart == dend) {
      val info = lineBlock(text, dend)
      val previous = EditorDocument.blockAt(text, EditorDocument.lineStart(text, dstart))
      // A later quote line joins the one above, as on web; the first
      // leaves the quote.
      val starts = (info.block == Block.QUOTE && previous?.block != Block.QUOTE) || info.block.isList ||
        (info.block == Block.CODE && !(previous?.block == Block.CODE && previous.group == info.group))
      if (!starts) return false
      post { blockAtCaret(info) { BlockInfo.PARAGRAPH } }
      return true
    }
    return false
  }

  // A key's change, made after the input filter: on the caret's line as
  // it is now (keys queued meanwhile may have moved it), and only if that
  // line still has the block the key was pressed in.
  private fun blockAtCaret(was: BlockInfo, made: () -> BlockInfo) {
    val text = field.text ?: return
    val caret = max(0, field.selectionStart)
    val start = EditorDocument.lineStart(text, caret)
    val end = EditorDocument.lineEnd(text, caret)
    if (lineBlock(text, start) != was) return
    setBlocks(listOf(TouchedLine(start, end, made())))
  }

  private fun lastOfCodeBlock(text: Spanned, lineEnd: Int, info: BlockInfo): Boolean {
    if (lineEnd >= text.length) return true
    val next = EditorDocument.blockAt(text, lineEnd + 1)
    return !(next?.block == Block.CODE && next.group == info.group)
  }

  // In a code block the keyboard doesn't suggest or correct, which would
  // change the code.
  private var plainKeyboard = false

  private fun plainKeyboard(code: Boolean) {
    if (plainKeyboard == code) return
    plainKeyboard = code
    val base = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    field.setRawInputType(
      if (code) base or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      else base or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT,
    )
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.restartInput(field)
  }

  // MARK: Format as you type

  // What a typing shortcut replaced, so a backspace straight after puts it
  // back: where its result now is, the text it replaced, and (for a block
  // marker) the block the line had.
  internal data class TypedRule(val start: Int, val end: Int, val original: CharSequence, val block: BlockInfo?)

  private var lastRule: TypedRule? = null

  private val markRules: List<Pair<Regex, Int>> = run {
    fun rule(open: String, bit: Int): Pair<Regex, Int> {
      // Each marker character escaped (all are punctuation).
      val d = open.map { "\\$it" }.joinToString("")
      val c = "\\${open[0]}"
      return Regex("(?:^|\\s)($d([^\\s$c](?:[^$c]*[^\\s$c])?)$d)$") to bit
    }
    listOf(
      rule("**", Marks.BOLD), rule("__", Marks.UNDERLINE), rule("~~", Marks.STRIKE), rule("||", Marks.SPOILER),
      rule("`", Marks.CODE),
      // A lone "*", not the second star of "**".
      Regex("(?:^|[^*])(\\*([^\\s*](?:[^*]*[^\\s*])?)\\*)$") to Marks.ITALIC,
    )
  }
  private val linkRule = Regex("\\[([^\\[\\]]+)\\]\\((https?://[^\\s()]+)\\)$")
  private val orderedMarker = Regex("^\\d{1,9}[.)] $")

  // Web's input rules (RichEditor/plugins.ts), as on iOS: a marker pair
  // typed around words styles them, "[words](https://address)" links them
  // once its ")" is typed, and at a line's start "> ", "- " or "* ", "1. "
  // or "1) ", and "```" make the line a quote, a list item or a code
  // block. Never in a code block.
  private fun applyTypedRules(text: Editable, caret: Int) {
    val start = EditorDocument.lineStart(text, caret)
    val block = lineBlock(text, start)
    if (block.block == Block.CODE) return
    val before = EditorDocument.textBefore(text, caret)
    if (block.block == Block.PARAGRAPH && applyBlockRule(text, before, start)) return
    linkRule.find(before)?.let { match ->
      val words = match.groups[1]!!.range
      val href = match.groupValues[2]
      val all = start + match.range.first until start + match.range.last + 1
      val linked = SpannableStringBuilder(text.subSequence(start + words.first, start + words.last + 1))
      for (span in linked.getSpans(0, linked.length, MentionSpan::class.java)) linked.removeSpan(span)
      linked.setSpan(HrefSpan(href), 0, linked.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      ruleEdit(text, all.first, all.last + 1, linked, null) { _, _ -> }
      return
    }
    for ((pattern, bit) in markRules) {
      val match = pattern.find(before) ?: continue
      val marked = match.groups[1]!!.range
      val words = match.groups[2]!!.range
      val content = SpannableStringBuilder(text.subSequence(start + words.first, start + words.last + 1))
      ruleEdit(text, start + marked.first, start + marked.last + 1, content, null) { from, to ->
        EditorMarksEdit.apply(text, from, to) { it or bit }
      }
      // What is typed next isn't in the mark.
      pendingMarks = caretMarks(text, field.selectionStart) and bit.inv()
      pendingFrom = field.selectionStart
      pendingAt = field.selectionStart
      return
    }
  }

  private fun applyBlockRule(text: Editable, before: String, lineStart: Int): Boolean {
    val kind = when {
      before == "> " -> Block.QUOTE
      before == "- " || before == "* " -> Block.BULLET
      orderedMarker.matches(before) -> Block.ORDERED
      before == "```" -> Block.CODE
      else -> return false
    }
    ruleEdit(text, lineStart, lineStart + before.length, "", BlockInfo.PARAGRAPH) { _, _ -> }
    val end = EditorDocument.lineEnd(text, lineStart)
    setBlocks(listOf(TouchedLine(lineStart, end, BlockInfo(kind, 0, if (kind == Block.CODE) 2_000_000 + lineStart else 0))))
    return true
  }

  private fun ruleEdit(
    text: Editable, from: Int, to: Int, with: CharSequence, block: BlockInfo?, after: (Int, Int) -> Unit,
  ) {
    val original = SpannableStringBuilder(text.subSequence(from, to))
    applying = true
    BaseInputConnection.removeComposingSpans(text)
    text.replace(from, to, with)
    val end = from + with.length
    after(from, end)
    restyle(text, from, end)
    field.setSelection(end)
    applying = false
    lastRule = TypedRule(from, end, original, block)
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.restartInput(field)
  }

  private fun undoRule(rule: TypedRule) {
    val text = field.text ?: return
    if (rule.end > text.length) return
    applying = true
    text.replace(rule.start, rule.end, rule.original)
    val end = rule.start + rule.original.length
    rule.block?.let { setLineBlock(text, EditorDocument.lineStart(text, rule.start), EditorDocument.lineEnd(text, rule.start), it) }
    restyle(text, rule.start, end)
    field.setSelection(end)
    applying = false
    emitChange()
  }

  // MARK: Paste, copy

  private var pasteRange: IntRange? = null

  private fun clipboardText(): String? {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
    return clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
  }

  // Paste: plain text read as Markdown (by JS, which hands back lines:
  // insertLines), so a message's source pastes back formatted; in a code
  // block, literal (the field's own paste). An address pasted over
  // selected words on one line links them.
  internal fun paste(): Boolean {
    val text = field.text ?: return false
    val pasted = clipboardText()?.takeIf { it.isNotEmpty() } ?: return false
    val start = max(0, minOf(field.selectionStart, field.selectionEnd))
    val end = max(start, maxOf(field.selectionStart, field.selectionEnd))
    if (lineBlock(text, start).block == Block.CODE) return false
    val address = pasted.trim()
    if (end > start && readable(address)) {
      val words = text.subSequence(start, end).toString()
      if (!words.contains('\n') && !Regex("https?://", RegexOption.IGNORE_CASE).containsMatchIn(words)) {
        linkRange = start until end
        linkWords = words
        setLink(words, address)
        return true
      }
    }
    pasteRange = start until end
    onEditorPaste(mapOf("text" to pasted.replace("\r\n", "\n").replace('\r', '\n')))
    return true
  }

  // An address the message format reads back whole (core readableAddress).
  private fun readable(href: String): Boolean {
    if (!Regex("^https?://[^\\s<]+$", RegexOption.IGNORE_CASE).matches(href)) return false
    var depth = 0
    for (c in href) {
      if (c == '(') depth++
      if (c == ')' && --depth < 0) return false
    }
    return depth == 0
  }

  // The pasted lines in place of what was selected: the first joins the
  // line pasted into (which keeps its block), the rest keep theirs, and
  // the words after the paste end the last.
  fun insertLines(lines: List<EditorLineRecord>) {
    val text = field.text ?: return
    val range = pasteRange ?: return
    pasteRange = null
    val from = range.first
    val to = if (range.isEmpty()) from else range.last + 1
    if (to > text.length) return
    val built = EditorDocument.build(lines)
    // Paragraph spans can't start mid-line: the blocks are set after.
    for (span in built.getSpans(0, built.length, BlockSpan::class.java)) built.removeSpan(span)
    if (lines.size == 1) {
      val marks = caretMarks(text, from)
      if (marks != 0) EditorMarksEdit.apply(built, 0, built.length) { it or marks }
    }
    applying = true
    BaseInputConnection.removeComposingSpans(text)
    pendingMarks = null
    text.replace(from, to, built)
    var lineStart = EditorDocument.lineEnd(text, from) + 1
    for (line in lines.drop(1)) {
      if (lineStart > text.length) break
      val info = BlockInfo(Block.of(line.block), line.depth, line.group, line.lang).normalised()
      setLineBlock(text, lineStart, EditorDocument.lineEnd(text, lineStart), info)
      lineStart = EditorDocument.lineEnd(text, lineStart) + 1
    }
    val end = from + built.length
    restyle(text, from, end)
    field.setSelection(end)
    applying = false
    emitChange()
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.restartInput(field)
  }

  // Copy and Cut: the selection's lines to JS, which puts their Markdown
  // on the clipboard (mentions as their words); Cut then takes them out.
  internal fun copySelection(cut: Boolean): Boolean {
    val text = field.text ?: return false
    val start = max(0, minOf(field.selectionStart, field.selectionEnd))
    val end = max(start, maxOf(field.selectionStart, field.selectionEnd))
    if (end <= start) return false
    val piece = SpannableStringBuilder(text.subSequence(start, end))
    onEditorCopy(mapOf("lines" to EditorDocument.lines(piece, null)))
    if (cut) text.delete(start, end)
    return true
  }

  internal val inList get() = field.text?.let { lineBlock(it, max(0, field.selectionStart)).block.isList } ?: false

  // MARK: Links

  // The whole link a caret is in (not at its edge: typing there isn't
  // linked), or a selection lies inside: every neighbouring character
  // with the same address, so a link partly bold is one link.
  private fun link(text: Spanned, start: Int, end: Int): Pair<IntRange, String>? {
    val at = if (start == end) start - 1 else start
    if (at < 0 || at >= text.length) return null
    val href = EditorDocument.hrefAt(text, at, at + 1) ?: return null
    if (start == end && (start >= text.length || EditorDocument.hrefAt(text, start, start + 1) != href)) return null
    var from = at
    while (from > 0 && EditorDocument.hrefAt(text, from - 1, from) == href) from--
    var to = at + 1
    while (to < text.length && EditorDocument.hrefAt(text, to, to + 1) == href) to++
    if (end > to) return null
    return (from until to) to href
  }

  // Where the link dialog's Save or Remove lands, from when it opened, and
  // the words there then: if the text has changed under the dialog (a
  // reload), Save and Remove do nothing rather than land elsewhere.
  private var linkRange: IntRange? = null
  private var linkWords = ""

  private fun linkStillThere(text: Spanned, range: IntRange): Boolean {
    val to = if (range.isEmpty()) range.first else range.last + 1
    return to <= text.length && text.subSequence(range.first, to).toString() == linkWords
  }

  // What the link dialog opens with (web's linkDraft): the link being
  // edited, else the selected words on one line, else nothing at the
  // caret (or, across lines, at the end of the last). Null in a code
  // block, which holds no links.
  fun linkDraft(): Map<String, Any>? {
    val text = field.text ?: return null
    val start = max(0, minOf(field.selectionStart, field.selectionEnd))
    val end = max(start, maxOf(field.selectionStart, field.selectionEnd))
    if (lineBlock(text, start).block == Block.CODE || lineBlock(text, end).block == Block.CODE) return null
    link(text, start, end)?.let { (range, href) ->
      linkRange = range
      linkWords = text.subSequence(range.first, range.last + 1).toString()
      return mapOf("text" to linkWords, "href" to href, "editing" to true)
    }
    val range = if (end <= EditorDocument.lineEnd(text, start)) start until end else end until end
    linkRange = range
    linkWords = if (range.isEmpty()) "" else text.subSequence(range.first, range.last + 1).toString()
    return mapOf("text" to linkWords, "href" to "", "editing" to false)
  }

  // The dialog's Save: the words linked to the address. Words unchanged
  // keep their own marks; new words take those where they start. A pill
  // in the words becomes its words (a mention is never linked). The caret
  // lands after the link, outside it.
  fun setLink(words: String, href: String) {
    val text = field.text ?: return
    val range = linkRange ?: return
    linkRange = null
    if (!linkStillThere(text, range)) return
    val from = range.first
    val to = if (range.isEmpty()) from else range.last + 1
    val address = href.trim()
    val linked = words.trim().ifEmpty { address }
    applying = true
    BaseInputConnection.removeComposingSpans(text)
    pendingMarks = null
    val end = from + linked.length
    if (text.subSequence(from, to).toString() != linked) {
      // New words take the marks where they start, as on iOS.
      val marks = if (from > 0 && text[from - 1] != '\n') EditorDocument.marksAt(text, from - 1, from) else 0
      text.replace(from, to, linked)
      EditorMarksEdit.apply(text, from, end) { marks }
    }
    for (span in text.getSpans(from, end, MentionSpan::class.java)) text.removeSpan(span)
    for (span in text.getSpans(from, end, HrefSpan::class.java)) {
      val s = text.getSpanStart(span)
      val e = text.getSpanEnd(span)
      if (s >= end || e <= from) continue
      text.removeSpan(span)
      if (s < from) text.setSpan(HrefSpan(span.href), s, from, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      if (e > end) text.setSpan(HrefSpan(span.href), end, e, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    text.setSpan(HrefSpan(address), from, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    restyle(text, from, end)
    field.setSelection(end)
    applying = false
    emitChange()
  }

  // The dialog's Remove: the words stay, unlinked.
  fun removeLink() {
    val text = field.text ?: return
    val range = linkRange ?: return
    linkRange = null
    if (range.isEmpty() || !linkStillThere(text, range)) return
    val from = range.first
    val to = range.last + 1
    applying = true
    for (span in text.getSpans(from, to, HrefSpan::class.java)) {
      val s = text.getSpanStart(span)
      val e = text.getSpanEnd(span)
      if (s >= to || e <= from) continue
      text.removeSpan(span)
      if (s < from) text.setSpan(HrefSpan(span.href), s, from, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      if (e > to) text.setSpan(HrefSpan(span.href), to, e, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    restyle(text, from, to)
    applying = false
    emitChange()
  }

  // A mark on or off: over a selection, on everywhere unless all of it
  // has it already (web's rule); at a caret, for what is typed next,
  // until the caret moves. Not in a code block, which holds no marks.
  fun format(name: String) {
    when (name) {
      "quote" -> return toggleBlock(Block.QUOTE)
      "codeblock" -> return toggleBlock(Block.CODE)
      "list" -> return toggleList(Block.BULLET)
      "orderedList" -> return toggleList(Block.ORDERED)
      "indent" -> return indent(1)
      "outdent" -> return indent(-1)
    }
    val bit = Marks.named.firstOrNull { it.first == name }?.second ?: return
    val text = field.text ?: return
    val start = max(0, minOf(field.selectionStart, field.selectionEnd))
    val end = max(start, maxOf(field.selectionStart, field.selectionEnd))
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
    linkRange = null
    pasteRange = null
    lastRule = null
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

  // The keyboard is only given to a field whose window has focus: asked
  // while a dialog is still going (the link dialog), it waits for it, a
  // little at a time. The field may have kept view focus under the dialog,
  // which sends no focus change, so it says it is focused itself.
  fun focus(tries: Int = 20) {
    if (!field.hasWindowFocus() && tries > 0) {
      postDelayed({ focus(tries - 1) }, 50)
      return
    }
    field.requestFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT)
    onEditorFocus(emptyMap<String, Any>())
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
    filters = arrayOf(
      InputFilter { source, start, end, _, dstart, dend ->
        // Return and Backspace at a block's edge (RichEditorView.blockKey):
        // the change refused here and made by the owner.
        if (ready && owner.blockKey(source.subSequence(start, end), dstart, dend)) {
          text?.subSequence(dstart, dend) ?: ""
        } else {
          null
        }
      },
      InputFilter { source, start, end, _, _, _ ->
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

  // Paste, copy and cut go to the field, which knows what the text means.
  override fun onTextContextMenuItem(id: Int): Boolean {
    val handled = when (id) {
      android.R.id.paste, android.R.id.pasteAsPlainText -> owner.paste()
      android.R.id.copy -> owner.copySelection(cut = false)
      android.R.id.cut -> owner.copySelection(cut = true)
      else -> false
    }
    return handled || super.onTextContextMenuItem(id)
  }

  // Ctrl+B, I, U, E (code), Ctrl+Shift+X (strike) and Ctrl+K (link), as
  // on web; Tab and Shift+Tab in a list take an item a level deeper or up.
  override fun onKeyShortcut(keyCode: Int, event: KeyEvent): Boolean {
    val format = when {
      event.isShiftPressed && keyCode == KeyEvent.KEYCODE_X -> "strike"
      event.isShiftPressed -> null
      keyCode == KeyEvent.KEYCODE_B -> "bold"
      keyCode == KeyEvent.KEYCODE_I -> "italic"
      keyCode == KeyEvent.KEYCODE_U -> "underline"
      keyCode == KeyEvent.KEYCODE_E -> "code"
      keyCode == KeyEvent.KEYCODE_K -> "link"
      else -> null
    } ?: return super.onKeyShortcut(keyCode, event)
    if (format == "link") owner.onEditorKey(mapOf("key" to "link")) else owner.format(format)
    return true
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_TAB && owner.inList) {
      owner.format(if (event.isShiftPressed) "outdent" else "indent")
      return true
    }
    return super.onKeyDown(keyCode, event)
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
