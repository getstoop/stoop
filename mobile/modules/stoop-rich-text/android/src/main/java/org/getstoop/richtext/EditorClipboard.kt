package org.getstoop.richtext

import android.text.Editable
import android.text.SpannableStringBuilder
import android.text.Spanned

// Paste and copy. Paste reads the clipboard's text as Markdown (JS reads
// it, and hands back lines to put in), so a message's source pastes back
// formatted; an address pasted over selected words links them; in a code
// block the field's own paste puts it in as it is. Copy and Cut hand JS
// the selection's lines, which puts their Markdown on the clipboard. As
// on iOS (ios/Editor/EditorClipboard.swift).
internal object Clipboard {
  sealed class Paste {
    data class Link(val words: String, val href: String, val start: Int, val end: Int) : Paste()
    data class Ask(val text: String, val start: Int, val end: Int) : Paste()
  }

  // What a paste of `clipboard` over [start, end) does; null for the
  // field's own paste.
  fun paste(text: Spanned, start: Int, end: Int, clipboard: String): Paste? {
    if (clipboard.isEmpty()) return null
    if (Blocks.atLineOf(text, start).block == Block.CODE) return null
    val plain = clipboard.replace("\r\n", "\n").replace('\r', '\n')
    val address = plain.trim()
    if (end > start && Links.readable(address)) {
      val words = text.subSequence(start, end).toString()
      if (!words.contains('\n') && !Regex("https?://", RegexOption.IGNORE_CASE).containsMatchIn(words)) {
        return Paste.Link(words, address, start, end)
      }
    }
    return Paste.Ask(plain, start, end)
  }

  // The lines in place of [start, end): the first joins the line pasted
  // into (which keeps its block, unless it is empty or wholly replaced:
  // then the pasted line keeps its own, as web puts a pasted block in an
  // empty line), the rest keep theirs, and the words after the paste end
  // the last. One line pasted into marked words takes their marks. The
  // caret after what went in. `regroup` numbers each pasted code block.
  fun insert(text: Editable, lines: List<EditorLine>, start: Int, end: Int, regroup: (Int) -> Int): Int {
    var from = start
    var to = end
    val lineStart = Document.lineStart(text, start)
    val lineEnd = Document.lineEnd(text, lineStart)
    // Over a holder, in place of it.
    if (Blocks.isHolder(text, lineStart)) {
      from = minOf(from, lineStart)
      to = maxOf(to, lineStart + 1)
    }
    val emptyLine = Blocks.isEmpty(text, lineStart) || (from <= lineStart && to >= lineEnd)
    val built = Document.attributed(lines.map { line -> if (line.block == "code") line.copy(group = regroup(line.group)) else line })
    val block = Blocks.at(text, lineStart)
    if (!emptyLine) {
      val firstEnd = Document.lineSpanEnd(built, 0)
      for (span in built.getSpans(0, firstEnd, BlockSpan::class.java)) {
        if (built.getSpanStart(span) == 0) built.removeSpan(span)
      }
      if (firstEnd > 0) built.setSpan(BlockSpan(block), 0, firstEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    if (lines.size == 1) {
      val marks = Marks.typing(text, from)
      if (marks != 0) Marks.set(built, 0, built.length) { it or marks }
    }
    Document.clearMeaning(text, from, to, blocksToo = true)
    text.replace(from, to, built)
    return from + built.length
  }

  fun copy(text: Spanned, start: Int, end: Int): List<EditorLine> =
    Document.lines(SpannableStringBuilder(text.subSequence(start, end)))
}
