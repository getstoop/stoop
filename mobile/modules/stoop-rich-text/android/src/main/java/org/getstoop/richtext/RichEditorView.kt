package org.getstoop.richtext

import android.content.ClipboardManager
import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.InputMethodManager
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max

// The composer's field: an EditText whose text carries its meaning
// (EditorDocument and the features beside it) and is drawn formatted
// (EditorStyler, EditorDecorations). Typing never waits on JS: the view
// tells JS what the text now is (onEditorChange, as lines, which core
// turns into Markdown), and JS asks it to do things (the functions in
// StoopRichTextModule). This file is the wiring, as RichEditorView.swift
// is on iOS: what the field reports comes in, each feature decides, and
// the edit is made here. Android has no typing attributes, so the marks
// typed text should carry are worked out before each change and put on
// after it.
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
  internal val input = EditorText(context, this)
  // The field's own edits, which the watcher leaves alone.
  private var applying = false
  private var lastHeight = -1
  private var loadedRevision = -1
  // Marks toggled at the caret, for what is typed next, and the caret
  // they were toggled at: moved away from, they are forgotten.
  private var caretMarks: Pair<Int, Int>? = null
  // A typing shortcut just applied, where a paste lands once JS has read
  // it, and what the link dialog opened with.
  private var lastRule: TypedRule? = null
  private var pasteRange: IntRange? = null
  private var linkDraft: Links.Draft? = null
  // Every code block the field makes or takes in gets the next number, so
  // two never share a group by accident.
  private var codeGroups = 0
  // A change in flight: where it is, and the marks its new text is meant
  // to have (those of the text it replaces, when a keyboard rewrites a
  // word it composes; else what typing at its start carries; and, from
  // the place a toggle was made, the toggled ones).
  private var changeStart = 0
  private var changeBefore = 0
  private var changeAfter = 0
  private var intendedMarks = 0
  private var toggledFrom: Int? = null
  // The block of the line a deletion empties: the last line of a block
  // emptied (a keyboard takes a word out to put it back changed) keeps
  // its block through its holder, as on iOS, rather than the line
  // before's.
  private var emptiedBlock: BlockInfo? = null

  var autoFocus = false
  private var focusedOnce = false
  var label: String = ""
    set(value) {
      field = value
      input.contentDescription = value.ifEmpty { null }
    }
  var fieldId: String = ""

  init {
    addView(input, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    input.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(text: CharSequence, start: Int, count: Int, after: Int) {
        if (applying) return
        val spanned = text as? Editable ?: return
        val toggled = caretMarks
        toggledFrom = if (toggled != null && toggled.second in start..start + count) toggled.second - start else null
        intendedMarks = if (count > 0) Marks.at(spanned, start, start + 1) else Marks.typing(spanned, start)
        emptiedBlock = if (count > 0 && after == 0) Blocks.atLineOf(spanned, start) else null
      }

      override fun onTextChanged(text: CharSequence, start: Int, before: Int, count: Int) {
        changeStart = start
        changeBefore = before
        changeAfter = count
      }

      override fun afterTextChanged(text: Editable) {
        if (applying) return
        applying = true
        typed(text)
        applying = false
        changed()
      }
    })
    // The height after each layout: the text's own, which the EditText
    // knows only once it has laid it out (after a send clears it, too).
    input.viewTreeObserver.addOnGlobalLayoutListener { reportHeight() }
    input.setOnFocusChangeListener { _, focused ->
      if (focused) onEditorFocus(emptyMap<String, Any>()) else onEditorBlur(emptyMap<String, Any>())
    }
    ViewCompat.setAccessibilityDelegate(input, object : AccessibilityDelegateCompat() {
      override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
        super.onInitializeAccessibilityNodeInfo(host, info)
        if (fieldId.isNotEmpty()) info.viewIdResourceName = fieldId
      }
    })
  }

  // MARK: Props

  fun setStyle(record: EditorStyleRecord) {
    look = EditorLook(record, density)
    input.applyLook()
    input.text?.let { text ->
      applying = true
      restyleAll(text)
      applying = false
    }
    input.invalidate()
  }

  fun setPlaceholder(text: String) {
    input.hint = text
  }

  // The document prop: loaded once per revision, so a re-render with the
  // same one leaves what has been typed since alone.
  fun setDocument(document: EditorDocumentRecord) {
    if (document.revision == loadedRevision) return
    loadedRevision = document.revision
    load(document.lines.map { it.line })
  }

  // MARK: Layout

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (autoFocus && !focusedOnce) {
      focusedOnce = true
      post { focus() }
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    post { reportHeight() }
  }

  private fun reportHeight() {
    val layout = input.layout ?: return
    val px = layout.height + input.totalPaddingTop + input.totalPaddingBottom
    val height = ceil(px / density).toInt()
    if (abs(height - lastHeight) >= 1) {
      lastHeight = height
      onEditorHeight(mapOf("height" to height))
    }
  }

  // MARK: Edits the field makes itself

  private val text: Editable? get() = input.text
  private val selectionStart get() = max(0, minOf(input.selectionStart, input.selectionEnd))
  private val selectionEnd get() = max(selectionStart, maxOf(input.selectionStart, input.selectionEnd))

  // A change made outside typing: the text is edited as one (the watcher
  // leaves it alone), every line is settled and styled again, the caret
  // goes where `body` says, and the keyboard starts afresh when
  // characters changed (its own record of the text is stale).
  private fun edit(body: (Editable) -> Int?) {
    val text = text ?: return
    val before = text.toString()
    val start = selectionStart
    val end = selectionEnd
    applying = true
    val wanted = body(text)
    var caret = wanted ?: start
    var length = if (wanted == null) end - start else 0
    // A holder left standing beside words comes out.
    while (true) {
      val stray = Blocks.holderFix(text) ?: break
      text.delete(stray, stray + 1)
      if (stray < caret) caret-- else if (stray < caret + length) length--
    }
    restyleAll(text)
    applying = false
    val at = caret.coerceIn(0, text.length)
    input.setSelection(at, (at + length).coerceIn(at, text.length))
    // Characters changed under the keyboard: what it was composing is no
    // longer there, and it starts afresh on the text as it is.
    if (text.toString() != before) {
      BaseInputConnection.removeComposingSpans(text)
      restartInput()
    }
    changed()
  }

  private fun restyleAll(text: Editable) {
    val touched = Document.settle(text, 0, text.length)
    EditorStyler.restyle(text, touched.first, touched.last, look, input.paint)
  }

  private fun restartInput() {
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.restartInput(input)
  }

  private fun nextCodeGroup(): Int = 1_000_000 + ++codeGroups

  // Lines from JS (a load, a paste): each code block gets a group of the
  // field's own, the same for the lines of one block.
  private fun regrouper(): (Int) -> Int {
    val fresh = HashMap<Int, Int>()
    return { group -> fresh.getOrPut(group) { nextCodeGroup() } }
  }

  // MARK: Typing

  // After the keyboard changed the text: the new text takes the marks it
  // was meant to have, the lines are settled and styled, a holder goes
  // or comes, and the shortcut one typed character completes is applied.
  private fun typed(text: Editable) {
    val from = changeStart
    val to = from + changeAfter
    if (to > from) {
      val split = toggledFrom
      val toggled = caretMarks
      if (split != null && toggled != null) {
        // Typed where a mark was toggled, however the keyboard put it (a
        // word it composes from before the toggle included): what comes
        // after the toggle takes the toggled marks, what came before it
        // keeps its own.
        val middle = (from + split).coerceIn(from, to)
        if (middle > from) Marks.set(text, from, middle) { intendedMarks }
        Marks.set(text, middle, to) { toggled.first }
        caretMarks = toggled.first to to
      } else {
        Marks.set(text, from, to) { intendedMarks }
      }
      // A Return ends what a toggle was for, as on iOS.
      if (text.subSequence(from, to).contains('\n')) caretMarks = null
    }
    val touched = Document.settle(text, from, to)
    EditorStyler.restyle(text, touched.first, touched.last, look, input.paint)
    // The last line of a block emptied (a backspace, or a keyboard taking
    // a word out to put it back changed) keeps its block through a
    // holder; a holder left beside words comes out. The keyboard is not
    // restarted for either: it reads the text as it is, and a restart
    // between the two halves of a keyboard's own edit would lose the
    // second half.
    val emptied = emptiedBlock
    if (changeAfter == 0 && changeBefore > 0 && emptied != null && emptied.block != Block.PARAGRAPH &&
      changeStart == text.length && Document.lineStart(text, changeStart) == changeStart
    ) {
      text.append(Blocks.holder(emptied))
      restyleAll(text)
      input.setSelection(text.length)
      return
    }
    Blocks.holderFix(text)?.let { stray ->
      val caret = selectionStart
      text.delete(stray, stray + 1)
      restyleAll(text)
      input.setSelection((if (caret > stray) caret - 1 else caret).coerceIn(0, text.length))
      return
    }
    // One character typed at the caret, not a word a keyboard replaced
    // or a suggestion, dictation or a clipboard chip put in: the shortcut
    // it completes.
    if (changeBefore == 0 && changeAfter == 1 && input.selectionStart == to && BaseInputConnection.getComposingSpanStart(text) == -1) {
      applyRules(text, to)
    }
  }

  private fun applyRules(text: Editable, caret: Int) {
    val applied = InputRules.apply(text, caret, ::nextCodeGroup) ?: return
    restyleAll(text)
    input.setSelection(applied.caret.coerceIn(0, text.length))
    lastRule = applied.rule
    applied.markOff?.let { off ->
      // What is typed next isn't in the mark.
      caretMarks = (Marks.typing(text, applied.caret) and off.inv()) to applied.caret
    }
    restartInput()
  }

  // The keyboard's Return: at a block's edge the block changes instead;
  // in a block, the newline carries the block, and a holder follows it
  // on a new last line. True when handled.
  internal fun returnKey(): Boolean {
    val text = text ?: return false
    if (applying || selectionStart != selectionEnd) return false
    val caret = selectionStart
    Blocks.returnKey(text, caret)?.let {
      setBlocks(it)
      return true
    }
    val newline = Blocks.newline(text, caret) ?: return false
    caretMarks = null
    edit {
      it.insert(caret, newline)
      caret + newline.length
    }
    return true
  }

  // A keyboard's suggestion or correction over a pill's words, or inside
  // them, would rewrite the pill: it is let go (EditorText's filter).
  internal fun rewritesPill(start: Int, end: Int): Boolean {
    val text = text ?: return false
    val inside = Mentions.pill(text, start)
    return (inside != null && start > inside.first) || Mentions.isWholePill(text, start, end)
  }

  // The keyboard's Backspace: straight after a typing shortcut it puts
  // the markers back; at a block's start it makes the line plain; after a
  // pill it takes the pill whole. True when handled.
  internal fun backspaceKey(): Boolean {
    val text = text ?: return false
    if (applying || selectionStart != selectionEnd) return false
    val caret = selectionStart
    lastRule?.let { rule ->
      lastRule = null
      if (InputRules.undoes(rule, caret - 1, caret, caret, caret)) {
        edit { InputRules.undo(it, rule) }
        return true
      }
    }
    when (val action = Blocks.backspaceKey(text, caret)) {
      is Blocks.BackspaceAction.Plain -> {
        setBlocks(action.lines)
        return true
      }
      is Blocks.BackspaceAction.Join -> {
        edit {
          it.delete(action.start, action.end)
          action.start
        }
        return true
      }
      null -> {}
    }
    Mentions.range(text, caret - 1)?.let { pill ->
      if (pill.last + 1 != caret) return@let
      edit {
        it.delete(pill.first, pill.last + 1)
        pill.first
      }
      return true
    }
    return false
  }

  // MARK: Selection

  private var snapping = false
  // The selection as it last settled, for the way an edge is moving.
  private var settledStart = 0
  private var settledEnd = 0

  internal fun selectionChanged() {
    if (applying) return
    val text = text ?: return
    val start = selectionStart
    val end = selectionEnd
    lastRule?.let { if (start != it.end || end != it.end) lastRule = null }
    caretMarks?.let { if (start != it.second || end != it.second) caretMarks = null }
    if (snapSelection(text, start, end)) return
    keyboardFor(text)
    // After the gesture that moved it: a padding change during the touch
    // takes the layout out from under the editor's own handling of it.
    input.post { input.roomForHandles(selectionStart != selectionEnd) }
    input.invalidate()
    onEditorSelection(selectionPayload())
  }

  // A caret or a selection's edge never rests inside a pill, nor before
  // a line's holder. True when it moved it.
  private fun snapSelection(text: Editable, start: Int, end: Int): Boolean {
    if (snapping) return false
    fun edge(at: Int, was: Int): Int {
      val snapped = Mentions.edge(text, at, was)
      if (Blocks.isHolderCharacter(text, snapped) && Blocks.isHolder(text, Document.lineStart(text, snapped))) return snapped + 1
      return snapped
    }
    var from = edge(start, settledStart)
    var to = if (start == end) from else edge(end, settledEnd)
    if (to < from) from = to.also { to = from }
    settledStart = from
    settledEnd = to
    if (from == start && to == end) return false
    snapping = true
    input.setSelection(from, to)
    snapping = false
    return true
  }

  // What typing at the caret carries, as the toolbar shows it.
  private fun caretMarksNow(text: Editable, caret: Int): Int =
    caretMarks?.takeIf { it.second == caret }?.first ?: Marks.typing(text, caret)

  // In a code block the keyboard doesn't suggest or correct, which would
  // change the code.
  private var plainKeyboard = false

  private fun keyboardFor(text: Editable) {
    plainKeyboard(Blocks.atLineOf(text, selectionStart).block == Block.CODE)
  }

  private fun plainKeyboard(code: Boolean) {
    if (plainKeyboard == code) return
    plainKeyboard = code
    val base = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    input.setRawInputType(
      if (code) base or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      else base or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT,
    )
    restartInput()
  }

  internal val inList get() = text?.let { Blocks.atLineOf(it, selectionStart).block.isList } ?: false

  // MARK: Events

  private fun selectionPayload(): Map<String, Any> {
    val text = text ?: return emptyMap()
    val start = selectionStart
    val end = selectionEnd
    val marks = if (start == end) caretMarks?.takeIf { it.second == start }?.first else null
    return mapOf(
      // The document revision the text is from, so JS can drop a change
      // that was on its way when it loaded another.
      "revision" to loadedRevision,
      "selection" to mapOf("start" to start, "end" to end),
      "before" to Document.textBefore(text, start),
      "formats" to Document.activeFormats(text, start, end, marks),
    )
  }

  // After any change to the text. The keyboard follows it: a code block
  // put under a caret that stayed put would otherwise keep correcting.
  private fun changed() {
    text?.let { keyboardFor(it) }
    input.invalidate()
    val payload = selectionPayload().toMutableMap()
    payload["lines"] = EditorJSON.json(Document.lines(text ?: return))
    onEditorChange(payload)
    post { reportHeight() }
  }

  // MARK: Commands from JS

  fun format(name: String) {
    val text = text ?: return
    Marks.named(name)?.let {
      toggleMark(text, it)
      return
    }
    val start = selectionStart
    val end = selectionEnd
    when (name) {
      "quote" -> setBlocks(Blocks.toggle(text, start, end, Block.QUOTE, 0))
      "codeblock" -> setBlocks(Blocks.toggle(text, start, end, Block.CODE, nextCodeGroup()))
      "list" -> setBlocks(Blocks.toggleList(text, start, end, Block.BULLET))
      "orderedList" -> setBlocks(Blocks.toggleList(text, start, end, Block.ORDERED))
      "indent" -> setBlocks(Blocks.indent(text, start, end, 1))
      "outdent" -> setBlocks(Blocks.indent(text, start, end, -1))
    }
  }

  // A mark on or off: over a selection, on everywhere unless all of it
  // has it already; at a caret, for what is typed next, until the caret
  // moves. Not in a code block, which holds no marks.
  private fun toggleMark(text: Editable, mark: Int) {
    val start = selectionStart
    val end = selectionEnd
    if (start == end) {
      if (Blocks.atLineOf(text, start).block == Block.CODE) return
      caretMarks = (caretMarksNow(text, start) xor mark) to start
      onEditorSelection(selectionPayload())
      return
    }
    if (Marks.markable(text, start, end).isEmpty()) return
    edit {
      Marks.toggle(it, mark, start, end)
      null
    }
  }

  private fun setBlocks(lines: List<BlockLine>) {
    if (lines.isEmpty()) return
    val caret = selectionStart
    val selected = selectionEnd > caret
    edit { text ->
      Blocks.set(text, lines)
      // A selection stays; a caret moves with a holder put in or taken
      // out on its line.
      if (selected) return@edit null
      val lineStart = Document.lineStart(text, caret.coerceIn(0, text.length))
      if (Blocks.isHolder(text, lineStart)) lineStart + 1 else minOf(caret, Document.lineEnd(text, lineStart))
    }
  }

  // A pick from the mention list: the query before the caret replaced by
  // a pill, then `after` (its space).
  fun insertMention(count: Int, mention: EditorMentionRecord, after: String) {
    val text = text ?: return
    val caret = selectionStart
    val from = max(Document.lineStart(text, caret), caret - max(0, count))
    val span = MentionSpan(mention.mention)
    edit {
      val marks = Marks.typing(it, from)
      it.replace(from, caret, span.words + after)
      val end = from + span.words.length + after.length
      Marks.set(it, from, end) { marks }
      Mentions.make(it, from, from + span.words.length, mention.mention)
      end
    }
  }

  // A handle typed in full that JS found has one owner: its words, at
  // `location`, become the pill, if they are still there as typed.
  fun markMention(location: Int, typed: String, mention: EditorMentionRecord) {
    val text = text ?: return
    val end = location + typed.length
    if (location < 0 || end > text.length || text.subSequence(location, end).toString() != typed) return
    if (Blocks.atLineOf(text, location).block == Block.CODE) return
    if (text.getSpans(location, end, MentionSpan::class.java).any { text.getSpanStart(it) < end && text.getSpanEnd(it) > location }) return
    val words = MentionSpan(mention.mention).words
    val caret = selectionStart
    edit {
      // Typed in other capitals: the pill reads as the handle does.
      if (words != typed) it.replace(location, end, words)
      Mentions.make(it, location, location + words.length, mention.mention)
      caret + words.length - typed.length
    }
  }

  fun linkDraft(): Map<String, Any>? {
    val text = text ?: return null
    val draft = Links.draft(text, selectionStart, selectionEnd) ?: return null
    linkDraft = draft
    return mapOf("text" to draft.text, "href" to draft.href, "editing" to draft.editing)
  }

  // The dialog opened on words that are still there: if the text changed
  // under it (a reload), Save and Remove do nothing rather than land
  // elsewhere.
  private fun takeLinkDraft(): Links.Draft? {
    val draft = linkDraft
    linkDraft = null
    val text = text ?: return null
    if (draft == null) return null
    val to = if (draft.range.isEmpty()) draft.range.first else draft.range.last + 1
    if (to > text.length || text.subSequence(draft.range.first, to).toString() != draft.text) return null
    return draft
  }

  fun setLink(words: String, href: String) {
    val draft = takeLinkDraft() ?: return
    edit {
      val linked = Links.set(it, draft.range, words, href)
      if (linked.isEmpty()) linked.first else linked.last + 1
    }
  }

  fun removeLink() {
    val draft = takeLinkDraft() ?: return
    if (!draft.editing) return
    edit {
      Links.remove(it, draft.range)
      null
    }
  }

  fun load(lines: List<EditorLine>) {
    linkDraft = null
    pasteRange = null
    lastRule = null
    caretMarks = null
    val regroup = regrouper()
    edit {
      it.replace(0, it.length, Document.attributed(lines.map { line -> if (line.block == "code") line.copy(group = regroup(line.group)) else line }))
      it.length
    }
    restartInput()
    onEditorSelection(selectionPayload())
  }

  // The keyboard is only given to a field whose window has focus: asked
  // while a dialog is still going (the link dialog), it waits for it, a
  // little at a time, a second at most. The field may have kept view
  // focus under the dialog, which sends no focus change, so it says it
  // is focused itself.
  fun focus(tries: Int = 20) {
    if (!input.hasWindowFocus() && tries > 0) {
      postDelayed({ focus(tries - 1) }, 50)
      return
    }
    input.requestFocus()
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    onEditorFocus(emptyMap<String, Any>())
  }

  fun blur() {
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(input.windowToken, 0)
    input.clearFocus()
  }

  // The `count` characters before the caret (a mention query) replaced by
  // text, as if typed there.
  fun replaceBeforeCaret(count: Int, text: String) {
    val editable = this.text ?: return
    val caret = selectionStart
    val from = max(Document.lineStart(editable, caret), caret - max(0, count))
    edit {
      val marks = Marks.typing(it, from)
      it.replace(from, caret, text)
      Marks.set(it, from, from + text.length) { marks }
      from + text.length
    }
  }

  // Any word still being composed is taken as it stands, and the lines
  // returned, for a send.
  fun commit(): List<Map<String, Any>> {
    val text = text ?: return emptyList()
    BaseInputConnection.removeComposingSpans(text)
    if (Blocks.holderFix(text) != null) edit { null }
    return EditorJSON.json(Document.lines(text))
  }

  // MARK: Paste, copy

  private fun clipboardText(): String? {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
    return clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
  }

  internal fun paste(): Boolean {
    val text = text ?: return false
    val clipboard = clipboardText() ?: return false
    when (val action = Clipboard.paste(text, selectionStart, selectionEnd, clipboard) ?: return false) {
      is Clipboard.Paste.Link -> edit {
        val linked = Links.set(it, action.start until action.end, action.words, action.href)
        linked.last + 1
      }
      is Clipboard.Paste.Ask -> {
        pasteRange = action.start until action.end
        onEditorPaste(mapOf("text" to action.text))
      }
    }
    return true
  }

  // The pasted lines, once JS has read the clipboard as Markdown.
  fun insertLines(lines: List<EditorLine>) {
    val text = text ?: return
    val range = pasteRange ?: return
    pasteRange = null
    val from = range.first
    val to = if (range.isEmpty()) from else range.last + 1
    if (to > text.length) return
    val regroup = regrouper()
    edit { Clipboard.insert(it, lines, from, to, regroup) }
  }

  internal fun copySelection(cut: Boolean): Boolean {
    val text = text ?: return false
    val start = selectionStart
    val end = selectionEnd
    if (end <= start) return false
    onEditorCopy(mapOf("lines" to EditorJSON.json(Clipboard.copy(text, start, end))))
    if (cut) {
      val whole = Mentions.whole(text, start, end)
      edit {
        it.delete(whole.first, whole.second)
        whole.first
      }
    }
    return true
  }
}
