package org.getstoop.richtext

import android.text.Editable
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned

// The composer's document, as the text view holds it: text whose
// characters carry their meaning as spans, and nothing else. Each feature
// owns one span and the rules about it (EditorMarks, EditorLinks,
// EditorMentions, EditorBlocks); this file holds what JS sees of the
// whole (lines in, lines out: core/editor/lines.ts), the line walking
// everything else uses, and the order the invariants run in after an edit
// (`settle`). As on iOS (ios/Editor/EditorDocument.swift); the tests
// (src/test) run it under Robolectric.

// One line as JS hands it over and reads it back.
data class EditorLine(
  val block: String = "paragraph",
  val depth: Int = 0,
  val group: Int = 0,
  val lang: String? = null,
  val runs: List<EditorRun> = emptyList(),
)

data class EditorRun(
  val text: String? = null,
  val marks: List<String> = emptyList(),
  val href: String? = null,
  val mention: EditorMention? = null,
) {
  companion object {
    fun text(text: String, marks: List<String> = emptyList(), href: String? = null) = EditorRun(text, marks, href, null)
    fun mention(mention: EditorMention, marks: List<String> = emptyList()) = EditorRun(null, marks, null, mention)
  }
}

data class EditorMention(val kind: String, val id: String, val handle: String)

// What a character means. The look (fonts, colours, fills) is worked out
// from these by the styler and never read back. Every meaning span is
// EXCLUSIVE_EXCLUSIVE: nothing relies on a span stretching over typed
// text; the view puts the meaning on what is typed itself.
internal class MarksSpan(val marks: Int)

internal class HrefSpan(val href: String)

// Equal only to itself: two pills of the same person side by side stay
// two runs.
internal class MentionSpan(val mention: EditorMention) {
  // How it reads: #name for a channel, @handle for the rest (core
  // mentionText).
  val words get() = (if (mention.kind == "channel") "#" else "@") + mention.handle
}

internal class BlockSpan(val info: BlockInfo)

internal val MEANING_SPANS = listOf(MarksSpan::class.java, HrefSpan::class.java, MentionSpan::class.java, BlockSpan::class.java)

internal object Document {
  const val NEWLINE = '\n'

  // MARK: Lines

  // The start of the line holding `at`.
  fun lineStart(text: CharSequence, at: Int): Int {
    var start = at.coerceIn(0, text.length)
    while (start > 0 && text[start - 1] != NEWLINE) start--
    return start
  }

  // The line's end, before its "\n".
  fun lineEnd(text: CharSequence, at: Int): Int {
    var end = at.coerceIn(0, text.length)
    while (end < text.length && text[end] != NEWLINE) end++
    return end
  }

  // The line's end, its "\n" included.
  fun lineSpanEnd(text: CharSequence, lineStart: Int): Int {
    val end = lineEnd(text, lineStart)
    return if (end < text.length) end + 1 else end
  }

  // Every line of the text (or those meeting [from, to)), first to last,
  // the empty last line after a trailing "\n" included as a zero-length
  // line: its start, its end before the "\n", and its end after it.
  fun forEachLine(text: CharSequence, from: Int = 0, to: Int = text.length, body: (start: Int, end: Int, spanEnd: Int) -> Unit) {
    val first = from.coerceIn(0, text.length)
    val last = to.coerceIn(first, text.length)
    var start = lineStart(text, first)
    while (true) {
      val end = lineEnd(text, start)
      val spanEnd = if (end < text.length) end + 1 else end
      body(start, end, spanEnd)
      if (spanEnd >= text.length || spanEnd > last) {
        if (spanEnd == text.length && spanEnd > start && text[text.length - 1] == NEWLINE && spanEnd <= last) {
          body(text.length, text.length, text.length)
        }
        return
      }
      start = spanEnd
    }
  }

  // MARK: Spans

  fun <T> spansAt(text: Spanned, start: Int, end: Int, kind: Class<T>): List<T> =
    text.getSpans(start, end, kind).filter { text.getSpanStart(it) <= start && text.getSpanEnd(it) >= end && text.getSpanEnd(it) > text.getSpanStart(it) }

  // The places within [start, end) where a meaning span begins or ends.
  fun boundaries(text: Spanned, start: Int, end: Int): List<Int> {
    val cuts = sortedSetOf(start, end)
    for (kind in listOf(MarksSpan::class.java, HrefSpan::class.java, MentionSpan::class.java)) {
      for (span in text.getSpans(start, end, kind)) {
        cuts.add(text.getSpanStart(span).coerceIn(start, end))
        cuts.add(text.getSpanEnd(span).coerceIn(start, end))
      }
    }
    return cuts.toList()
  }

  // A span cut back to what lies outside [from, to): the parts outside
  // set again as fresh spans, the span itself removed.
  fun cutOut(text: Spannable, span: Any, from: Int, to: Int) {
    val start = text.getSpanStart(span)
    val end = text.getSpanEnd(span)
    if (start >= to || end <= from) return
    text.removeSpan(span)
    if (start < from) text.setSpan(remake(span), start, from, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    if (end > to) text.setSpan(remake(span), to, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }

  private fun remake(span: Any): Any = when (span) {
    is MarksSpan -> MarksSpan(span.marks)
    is HrefSpan -> HrefSpan(span.href)
    is BlockSpan -> BlockSpan(span.info)
    else -> span
  }

  // The meaning taken off [from, to) before other text goes in there: a
  // span the builder would otherwise stretch over the new text. Pills go
  // whole; the rest is cut back to what lies outside.
  fun clearMeaning(text: Spannable, from: Int, to: Int, blocksToo: Boolean) {
    Mentions.drop(text, from, to)
    val kinds = if (blocksToo) listOf(MarksSpan::class.java, HrefSpan::class.java, BlockSpan::class.java) else listOf(MarksSpan::class.java, HrefSpan::class.java)
    for (kind in kinds) {
      for (span in text.getSpans(from, to, kind)) cutOut(text, span, from, to)
    }
  }

  fun removeEmptySpans(text: Spannable) {
    for (kind in MEANING_SPANS) {
      for (span in text.getSpans(0, text.length, kind)) {
        if (text.getSpanEnd(span) <= text.getSpanStart(span)) text.removeSpan(span)
      }
    }
  }

  // MARK: In and out

  // Lines into text carrying their meaning (no look yet), joined by "\n".
  // An empty last line in a block gets the block's holder (EditorBlocks).
  fun attributed(lines: List<EditorLine>): SpannableStringBuilder {
    val out = SpannableStringBuilder()
    lines.forEachIndexed { index, line ->
      val block = BlockInfo(Block.of(line.block), line.depth, line.group, line.lang).normalised()
      val start = out.length
      for (run in line.runs) {
        val at = out.length
        val mention = run.mention
        val words = if (mention != null) MentionSpan(mention).words else run.text ?: ""
        if (words.isEmpty()) continue
        out.append(words)
        if (block.block == Block.CODE) continue
        if (mention != null) {
          out.setSpan(MentionSpan(mention), at, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        } else {
          run.href?.let { out.setSpan(HrefSpan(it), at, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        }
        val marks = Marks.of(run.marks)
        if (marks != 0) out.setSpan(MarksSpan(marks), at, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
      if (index < lines.size - 1) {
        out.append(NEWLINE)
      } else if (line.runs.isEmpty() && block.block != Block.PARAGRAPH) {
        out.append(Blocks.HOLDER)
      }
      if (out.length > start) out.setSpan(BlockSpan(block), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    return out
  }

  // Text back into lines. Groups are numbered as core reads them: a new
  // one wherever the kind of block changes, at each paragraph, and
  // between two code blocks.
  fun lines(text: Spanned): List<EditorLine> {
    val out = ArrayList<EditorLine>()
    var group = -1
    var previousFamily: String? = null
    var previousCode = 0
    forEachLine(text) { start, end, _ ->
      val block = Blocks.at(text, start)
      val family = if (block.block.isList) "list" else block.block.key
      if (previousFamily == null || family == "paragraph" || family != previousFamily ||
        (family == "code" && previousCode != block.group)
      ) {
        group++
      }
      previousFamily = family
      previousCode = block.group
      val wordsEnd = if (Blocks.isHolder(text, start)) start else end
      out.add(EditorLine(block.block.key, block.depth, group, block.lang, runs(text, start, wordsEnd)))
    }
    return out
  }

  fun runs(text: Spanned, start: Int, end: Int): List<EditorRun> {
    val out = ArrayList<EditorRun>()
    if (end <= start) return out
    val cuts = boundaries(text, start, end)
    // One run per mention span, however many pieces it spans (its marks
    // may differ along it; the first's are the run's).
    var lastMention: MentionSpan? = null
    for (i in 0 until cuts.size - 1) {
      val from = cuts[i]
      val to = cuts[i + 1]
      if (from >= to) continue
      val marks = Marks.names(Marks.at(text, from, to))
      val mention = Mentions.at(text, from, to)
      if (mention != null) {
        if (mention !== lastMention) out.add(EditorRun.mention(mention.mention, marks))
        lastMention = mention
        continue
      }
      lastMention = null
      val run = EditorRun.text(text.subSequence(from, to).toString(), marks, Links.at(text, from, to))
      // Neighbouring pieces that mean the same are one run, as iOS's
      // storage keeps them.
      val last = out.lastOrNull()
      if (last != null && last.mention == null && last.marks == run.marks && last.href == run.href) {
        out[out.size - 1] = last.copy(text = last.text + run.text)
      } else {
        out.add(run)
      }
    }
    return out
  }

  // MARK: After an edit

  // The spans put right after characters changed in [from, to): each line
  // one block (its first character's), code lines plain, a pill whose
  // words changed no longer a pill, list levels in step. The lines whose
  // look must be done again.
  fun settle(text: Editable, from: Int, to: Int): IntRange {
    removeEmptySpans(text)
    var first = lineStart(text, from)
    var last = lineSpanEnd(text, lineStart(text, to.coerceIn(0, text.length)))
    Blocks.normalise(text, first, last)
    Mentions.dropBroken(text, first, last)
    for ((start, end) in Blocks.normaliseDepths(text)) {
      first = minOf(first, start)
      last = maxOf(last, end)
    }
    return first until last
  }

  // MARK: What the toolbar shows

  // The formats in effect, as web's toolbar names them (core/editor
  // formats): at a caret, what typing would carry (`caretMarks` when a
  // toggle set them); over a selection, what all of its words have. And
  // the first line's block.
  fun activeFormats(text: Spanned, start: Int, end: Int, caretMarks: Int?): List<String> {
    val formats = ArrayList<String>()
    val block = Blocks.at(text, lineStart(text, start))
    // A selection is "in a code block" only when none of it can take a
    // mark; one that runs out of a code block into words can.
    val inCode = if (start == end) block.block == Block.CODE else Marks.markable(text, start, end).isEmpty()
    if (!inCode) {
      val marks = if (start == end) caretMarks ?: Marks.typing(text, start) else Marks.common(text, start, end)
      formats.addAll(Marks.names(marks))
    }
    if (Links.around(text, start, end) != null) formats.add("link")
    when (block.block) {
      Block.QUOTE -> formats.add("quote")
      Block.BULLET -> formats.add("list")
      Block.ORDERED -> formats.add("orderedList")
      Block.CODE -> formats.add("codeblock")
      Block.PARAGRAPH -> {}
    }
    return formats
  }

  // The caret's line up to the caret, for the mention list: a pill's
  // words as U+FFFC each (a query can't start inside one, and every index
  // still counts), a holder left out.
  fun textBefore(text: Spanned, at: Int): String {
    val end = at.coerceIn(0, text.length)
    val start = lineStart(text, end)
    if (Blocks.isHolder(text, start)) return ""
    return Mentions.masked(text, start, end)
  }
}
