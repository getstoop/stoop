package org.getstoop.richtext

import android.text.Editable
import android.text.SpannableStringBuilder
import android.text.Spanned

// Format as you type (web's input rules): after each character typed, the
// shortcut the line's text up to the caret completes, and a backspace
// straight after that puts the markers back as typed. Blocks first ("> ",
// "- ", "1. ", "```" at a paragraph's start), then a link typed in full,
// then a marker pair around words. Never in a code block. As on iOS
// (ios/Editor/EditorInputRules.swift).

// Where the shortcut's result now is, the text it replaced (with its
// spans), and (for a block marker) the block the line had.
internal data class TypedRule(val start: Int, val end: Int, val original: CharSequence, val block: BlockInfo?)

internal object InputRules {
  // A mark the words were given, which what is typed next doesn't get.
  data class Applied(val rule: TypedRule, val caret: Int, val markOff: Int?)

  // The shortcut a character typed at `caret` completes, applied; null
  // when none. `codeGroup` numbers a code block made here.
  fun apply(text: Editable, caret: Int, codeGroup: () -> Int): Applied? {
    if (caret > text.length) return null
    val lineStart = Document.lineStart(text, caret)
    val block = Blocks.at(text, lineStart)
    if (block.block == Block.CODE) return null
    val before = Document.textBefore(text, caret)
    val start = caret - before.length

    if (block.block == Block.PARAGRAPH) {
      Blocks.rule(before)?.let { kind ->
        val original = SpannableStringBuilder(text.subSequence(lineStart, lineStart + before.length))
        text.delete(lineStart, lineStart + before.length)
        Blocks.set(text, listOf(BlockLine(lineStart, Document.lineEnd(text, lineStart), BlockInfo(kind, 0, if (kind == Block.CODE) codeGroup() else 0))))
        // The line's holder, if one went in, is the result: a backspace
        // on it puts the marker back.
        val end = if (Blocks.isHolder(text, lineStart)) lineStart + 1 else lineStart
        return Applied(TypedRule(lineStart, end, original, BlockInfo.PARAGRAPH), end, null)
      }
    }

    Links.rule(before)?.let { link ->
      val allStart = start + link.all.first
      val allEnd = start + link.all.last + 1
      val wordsStart = start + link.words.first
      val wordsEnd = start + link.words.last + 1
      val original = SpannableStringBuilder(text.subSequence(allStart, allEnd))
      val linked = SpannableStringBuilder(text.subSequence(wordsStart, wordsEnd))
      Mentions.drop(linked, 0, linked.length)
      for (span in linked.getSpans(0, linked.length, BlockSpan::class.java)) linked.removeSpan(span)
      linked.setSpan(HrefSpan(link.href), 0, linked.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      Document.clearMeaning(text, allStart, allEnd, blocksToo = false)
      text.replace(allStart, allEnd, linked)
      val end = allStart + linked.length
      return Applied(TypedRule(allStart, end, original, null), end, null)
    }

    Marks.rule(before)?.let { rule ->
      val markedStart = start + rule.marked.first
      val markedEnd = start + rule.marked.last + 1
      val wordsStart = start + rule.words.first
      val wordsEnd = start + rule.words.last + 1
      val original = SpannableStringBuilder(text.subSequence(markedStart, markedEnd))
      val styled = SpannableStringBuilder(text.subSequence(wordsStart, wordsEnd))
      for (span in styled.getSpans(0, styled.length, BlockSpan::class.java)) styled.removeSpan(span)
      Marks.set(styled, 0, styled.length) { it or rule.mark }
      Document.clearMeaning(text, markedStart, markedEnd, blocksToo = false)
      text.replace(markedStart, markedEnd, styled)
      val end = markedStart + styled.length
      return Applied(TypedRule(markedStart, end, original, null), end, rule.mark)
    }
    return null
  }

  // Whether a backspace over [from, to) is the one that undoes the rule:
  // the character before a caret at the rule's end.
  fun undoes(rule: TypedRule, from: Int, to: Int, caretStart: Int, caretEnd: Int): Boolean =
    caretStart == caretEnd && caretStart == rule.end &&
      ((to - from == 1 && to == caretStart) || (rule.end == rule.start && to == from))

  // The markers back as typed. The caret after them. The mark or link
  // the rule put on is taken off first: a span over exactly the replaced
  // range would stretch over the markers put back.
  fun undo(text: Editable, rule: TypedRule): Int {
    if (rule.end > text.length) return rule.end
    val original = SpannableStringBuilder(rule.original)
    for (span in original.getSpans(0, original.length, BlockSpan::class.java)) original.removeSpan(span)
    val block = rule.block
    if (block != null) {
      val lineStart = Document.lineStart(text, rule.start)
      Blocks.set(text, listOf(BlockLine(lineStart, Document.lineEnd(text, lineStart), block)))
      text.insert(rule.start, original)
      Blocks.set(text, listOf(BlockLine(lineStart, Document.lineEnd(text, lineStart), block)))
    } else {
      Document.clearMeaning(text, rule.start, rule.end, blocksToo = false)
      text.replace(rule.start, rule.end, original)
    }
    return rule.start + original.length
  }
}
