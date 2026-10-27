package org.getstoop.richtext

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.text.InputFilter
import android.text.InputType
import android.text.SpannableStringBuilder
import android.view.Gravity
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import androidx.appcompat.widget.AppCompatEditText
import kotlin.math.roundToInt

// The composer's text field: what the system hands it (the soft
// keyboard's Return and Backspace, paste, copy and cut, a hardware key)
// goes to the field (RichEditorView), which knows what the text means;
// and it draws the blocks and boxes under its words (EditorDecorations).
@SuppressLint("ViewConstructor")
internal class EditorText(context: Context, private val owner: RichEditorView) : AppCompatEditText(context) {
  private val decorations = EditorDecorations()
  // Set once constructed: the EditText calls onSelectionChanged from its
  // own constructor, before the owner's field is assigned.
  private var ready = false

  init {
    background = null
    gravity = Gravity.TOP or Gravity.START
    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
      InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
    isVerticalScrollBarEnabled = true
    val density = context.resources.displayMetrics.density
    setPadding((10 * density).roundToInt(), (11 * density).roundToInt(), (10 * density).roundToInt(), (8 * density).roundToInt())
    // A pill is one unit: a keyboard's suggestion or correction for its
    // words (they look like a word to it), or for the whole of them, is
    // let go, as on iOS. A deletion that cuts into one is let through:
    // the pill becomes its words (Mentions.dropBroken), or goes whole on a
    // backspace at its end (RichEditorView.backspaceKey).
    // Lines end in "\n" only: a pasted "\r", or a line or paragraph
    // separator, is put in as one, so both platforms read the same lines.
    filters = arrayOf(
      InputFilter { source, start, end, dest, dstart, dend ->
        if (end > start && dend > dstart && owner.rewritesPill(dstart, dend)) dest.subSequence(dstart, dend) else null
      },
      InputFilter { source, start, end, _, _, _ ->
        val piece = source.subSequence(start, end)
        if (piece.none { it == '\r' || it == '\u2028' || it == '\u2029' }) {
          null
        } else {
          val plain = SpannableStringBuilder(piece)
          var index = 0
          while (index < plain.length) {
            when (plain[index]) {
              '\r' -> if (index + 1 < plain.length && plain[index + 1] == '\n') plain.delete(index, index + 1) else plain.replace(index, index + 1, "\n")
              '\u2028', '\u2029' -> plain.replace(index, index + 1, "\n")
            }
            index++
          }
          plain
        }
      },
    )
    applyLook()
    ready = true
  }

  // A selection's handles hang below its last line, in windows of their
  // own that take the taps meant for what lies under them: the format
  // row, right under the field. While words are selected the field's
  // bottom padding makes room for them, so the row's buttons stay
  // reachable.
  private var roomMade = false

  fun roomForHandles(on: Boolean) {
    if (on == roomMade) return
    roomMade = on
    val room = (40 * context.resources.displayMetrics.density).roundToInt()
    val bottom = paddingBottom + if (on) room else -room
    setPadding(paddingLeft, paddingTop, paddingRight, bottom)
  }

  fun applyLook() {
    val look = owner.look
    setTextColor(look.text)
    setHintTextColor(look.placeholder)
    setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, look.fontSizePx)
    highlightColor = (look.accent and 0x00ffffff) or 0x44000000
  }

  // The soft keyboard's Return and Backspace go to the field first: at a
  // block's edge they change the block, not the text, and a backspace
  // straight after a typing shortcut puts its markers back. Handled, they
  // never reach the text; the field tells the keyboard afterwards.
  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    val target = super.onCreateInputConnection(outAttrs) ?: return null
    return object : InputConnectionWrapper(target, true) {
      override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
        if (text != null && text.length == 1 && text[0] == '\n' && owner.returnKey()) return true
        return super.commitText(text, newCursorPosition)
      }

      override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        if (beforeLength == 1 && afterLength == 0 && !composing() && owner.backspaceKey()) return true
        return super.deleteSurroundingText(beforeLength, afterLength)
      }

      override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean {
        if (beforeLength == 1 && afterLength == 0 && !composing() && owner.backspaceKey()) return true
        return super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
      }

    }
  }

  // A key event the keyboard sends reaches onKeyDown below.
  private fun composing() = text?.let { BaseInputConnection.getComposingSpanStart(it) != -1 } ?: false

  // Paste, copy and cut go to the field, which knows what the text means.
  override fun onTextContextMenuItem(id: Int): Boolean {
    val handled = when (id) {
      // Not handled (in a code block): pasted as plain text, never with a
      // clip's own styles.
      android.R.id.paste, android.R.id.pasteAsPlainText ->
        owner.paste() || super.onTextContextMenuItem(android.R.id.pasteAsPlainText)
      android.R.id.copy -> owner.copySelection(cut = false).also { if (it) setSelection(selectionEnd) }
      android.R.id.cut -> owner.copySelection(cut = true)
      else -> false
    }
    return handled || super.onTextContextMenuItem(id)
  }

  // Ctrl+B, I, U, E (code), Ctrl+Shift+X (strike) and Ctrl+K (link), as
  // on web.
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

  // A hardware keyboard's Return and Backspace, as the soft keyboard's
  // above; Tab and Shift+Tab in a list take an item a level deeper or up.
  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    when (keyCode) {
      KeyEvent.KEYCODE_ENTER -> if (!event.isShiftPressed && !event.isCtrlPressed && owner.returnKey()) return true
      KeyEvent.KEYCODE_DEL -> if (!composing() && owner.backspaceKey()) return true
      KeyEvent.KEYCODE_TAB -> if (owner.inList) {
        owner.format(if (event.isShiftPressed) "outdent" else "indent")
        return true
      }
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
      decorations.draw(canvas, text, layout, owner.look, (width - totalPaddingLeft - totalPaddingRight).toFloat(), paint.fontMetrics)
      canvas.restore()
    }
    super.onDraw(canvas)
  }
}
