package org.getstoop.richtext

import android.text.Editable
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ParagraphStyle
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// The composer's document as JS hands it over and reads it back: lines,
// each with its block and styled runs (core/editor/lines.ts EditorLine),
// as on iOS (EditorModel.swift).

class EditorMentionRecord : Record {
  @Field val kind: String = "person"
  @Field val id: String = ""
  @Field val handle: String = ""
}

class EditorRunRecord : Record {
  @Field val text: String? = null
  @Field val marks: List<String> = emptyList()
  @Field val href: String? = null
  @Field val mention: EditorMentionRecord? = null
}

class EditorLineRecord : Record {
  @Field val block: String = "paragraph"
  @Field val depth: Int = 0
  @Field val group: Int = 0
  @Field val lang: String? = null
  @Field val runs: List<EditorRunRecord> = emptyList()
}

// The text JS puts in the field, from outside (a draft, an edit, a
// refused send): loaded when its revision changes.
class EditorDocumentRecord : Record {
  @Field val revision: Int = 0
  @Field val lines: List<EditorLineRecord> = emptyList()
}

// The marks a character carries, as bits, in core's order (EditorMark).
internal object Marks {
  const val BOLD = 1
  const val ITALIC = 2
  const val UNDERLINE = 4
  const val STRIKE = 8
  const val CODE = 16
  const val SPOILER = 32

  val named = listOf(
    "bold" to BOLD, "italic" to ITALIC, "underline" to UNDERLINE,
    "strike" to STRIKE, "code" to CODE, "spoiler" to SPOILER,
  )

  fun of(names: List<String>): Int = named.filter { it.first in names }.fold(0) { acc, (_, bit) -> acc or bit }

  fun names(marks: Int): List<String> = named.filter { marks and it.second != 0 }.map { it.first }
}

internal enum class Block(val key: String) {
  PARAGRAPH("paragraph"), QUOTE("quote"), BULLET("bullet"), ORDERED("ordered"), CODE("code");

  val isList get() = this == BULLET || this == ORDERED

  companion object {
    fun of(key: String) = entries.firstOrNull { it.key == key } ?: PARAGRAPH
  }
}

// A line's block, as one paragraph span over the line, its newline
// included.
internal data class BlockInfo(val block: Block, val depth: Int = 0, val group: Int = 0, val lang: String? = null) {
  fun normalised() = BlockInfo(
    block,
    if (block.isList) depth.coerceIn(0, 3) else 0,
    group,
    if (block == Block.CODE) lang else null,
  )

  companion object {
    val PARAGRAPH = BlockInfo(Block.PARAGRAPH)
  }
}

// What a character means; the look is worked out from these (EditorStyler).
internal class BlockSpan(val info: BlockInfo) : ParagraphStyle

// Marks extend to text typed at their end, as typing after bold is bold.
internal class MarksSpan(val marks: Int)

internal class HrefSpan(val href: String)

// Who a mention names, over the words it shows as.
internal class MentionSpan(val kind: String, val id: String, val handle: String) {
  val words get() = (if (kind == "channel") "#" else "@") + handle
  val json get() = mapOf("kind" to kind, "id" to id, "handle" to handle)
}

internal object EditorDocument {
  // Lines into text with their meaning (no look yet), joined by "\n".
  fun build(lines: List<EditorLineRecord>): SpannableStringBuilder {
    val out = SpannableStringBuilder()
    lines.forEachIndexed { index, line ->
      val info = BlockInfo(Block.of(line.block), line.depth, line.group, line.lang).normalised()
      val start = out.length
      for (run in line.runs) {
        val at = out.length
        val mention = run.mention
        if (mention != null) {
          val span = MentionSpan(mention.kind, mention.id, mention.handle)
          out.append(span.words)
          out.setSpan(span, at, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        } else {
          val text = run.text ?: continue
          if (text.isEmpty()) continue
          out.append(text)
          run.href?.let { out.setSpan(HrefSpan(it), at, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        }
        val marks = Marks.of(run.marks)
        if (marks != 0) out.setSpan(MarksSpan(marks), at, out.length, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
      }
      if (index < lines.size - 1) out.append('\n')
      if (out.length > start) out.setSpan(BlockSpan(info), start, out.length, Spanned.SPAN_PARAGRAPH)
    }
    return out
  }

  fun lineStart(text: CharSequence, at: Int): Int {
    var start = at.coerceIn(0, text.length)
    while (start > 0 && text[start - 1] != '\n') start--
    return start
  }

  // The line's end, before its newline.
  fun lineEnd(text: CharSequence, at: Int): Int {
    var end = at.coerceIn(0, text.length)
    while (end < text.length && text[end] != '\n') end++
    return end
  }

  fun blockAt(text: Spanned, lineStart: Int): BlockInfo? {
    if (lineStart >= text.length) return null
    return text.getSpans(lineStart, lineStart + 1, BlockSpan::class.java)
      .firstOrNull { text.getSpanStart(it) <= lineStart }?.info
  }

  fun marksAt(text: Spanned, start: Int, end: Int): Int =
    text.getSpans(start, end, MarksSpan::class.java)
      .filter { text.getSpanStart(it) <= start && text.getSpanEnd(it) >= end }
      .fold(0) { acc, span -> acc or span.marks }

  fun hrefAt(text: Spanned, start: Int, end: Int): String? =
    text.getSpans(start, end, HrefSpan::class.java)
      .firstOrNull { text.getSpanStart(it) <= start && text.getSpanEnd(it) >= end }?.href

  fun mentionAt(text: Spanned, start: Int, end: Int): MentionSpan? =
    text.getSpans(start, end, MentionSpan::class.java)
      .firstOrNull { text.getSpanStart(it) <= start && text.getSpanEnd(it) >= end }

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

  // Text back into lines, as maps for the event. The last line, when
  // empty, takes its block from `trailing`.
  fun lines(text: Spanned, trailing: BlockInfo?): List<Map<String, Any>> {
    val out = ArrayList<Map<String, Any>>()
    var group = -1
    var previousFamily: String? = null
    var previousCode = 0
    var start = 0
    while (true) {
      val end = lineEnd(text, start)
      val info = when {
        end > start || end < text.length -> blockAt(text, start) ?: BlockInfo.PARAGRAPH
        else -> trailing ?: BlockInfo.PARAGRAPH
      }
      val family = if (info.block.isList) "list" else info.block.key
      if (previousFamily == null || family == "paragraph" || family != previousFamily ||
        (family == "code" && previousCode != info.group)
      ) {
        group++
      }
      previousFamily = family
      previousCode = info.group
      val line = mutableMapOf<String, Any>(
        "block" to info.block.key,
        "depth" to info.depth,
        "group" to group,
        "runs" to runs(text, start, end),
      )
      info.lang?.let { line["lang"] = it }
      out.add(line)
      if (end >= text.length) break
      start = end + 1
    }
    return out
  }

  private fun runs(text: Spanned, start: Int, end: Int): List<Map<String, Any>> {
    val out = ArrayList<Map<String, Any>>()
    if (end <= start) return out
    val cuts = boundaries(text, start, end)
    var lastMention: MentionSpan? = null
    for (i in 0 until cuts.size - 1) {
      val from = cuts[i]
      val to = cuts[i + 1]
      if (from >= to) continue
      val marks = Marks.names(marksAt(text, from, to))
      val mention = mentionAt(text, from, to)
      if (mention != null) {
        if (mention !== lastMention) out.add(mapOf("mention" to mention.json, "marks" to marks))
        lastMention = mention
        continue
      }
      lastMention = null
      val run = mutableMapOf<String, Any>("text" to text.subSequence(from, to).toString(), "marks" to marks)
      hrefAt(text, from, to)?.let { run["href"] = it }
      out.add(run)
    }
    return out
  }

  // The line's text up to a position, a mention's words as U+FFFC each, so
  // a query can't start inside one and every index still counts.
  fun textBefore(text: Spanned, at: Int): String {
    val end = at.coerceIn(0, text.length)
    val start = lineStart(text, end)
    val out = StringBuilder(text.subSequence(start, end))
    for (span in text.getSpans(start, end, MentionSpan::class.java)) {
      val from = maxOf(text.getSpanStart(span), start)
      val to = minOf(text.getSpanEnd(span), end)
      for (i in from until to) out.setCharAt(i - start, '￼')
    }
    return out.toString()
  }

  // Each line holds one block span, its first character's: two lines
  // joined by a backspace become one line of the first's kind, and a line
  // split by a Return keeps its kind on both halves. A line with none
  // (words typed on an empty last line) takes `trailing`, the block that
  // line was given, else the line before's, as iOS's typing attributes
  // carry it over.
  fun normaliseBlocks(text: Editable, from: Int, to: Int, trailing: BlockInfo?) {
    var start = lineStart(text, from)
    val last = lineEnd(text, to)
    var before: BlockInfo? = if (start > 0) blockAt(text, lineStart(text, start - 1)) else null
    while (start <= text.length) {
      val end = lineEnd(text, start)
      val spanEnd = if (end < text.length) end + 1 else end
      if (spanEnd > start) {
        val info = blockAt(text, start)
          ?: (if (spanEnd == text.length) trailing else null)
          ?: before
          ?: BlockInfo.PARAGRAPH
        for (span in text.getSpans(start, spanEnd, BlockSpan::class.java)) {
          val s = text.getSpanStart(span)
          val e = text.getSpanEnd(span)
          if (s >= spanEnd || e <= start) continue
          text.removeSpan(span)
          // What the span covered beyond this line keeps its block.
          if (s < start) text.setSpan(BlockSpan(span.info), s, start, Spanned.SPAN_PARAGRAPH)
          if (e > spanEnd) text.setSpan(BlockSpan(span.info), spanEnd, e, Spanned.SPAN_PARAGRAPH)
        }
        text.setSpan(BlockSpan(info), start, spanEnd, Spanned.SPAN_PARAGRAPH)
        before = info
      }
      if (end >= last || end >= text.length) break
      start = end + 1
    }
  }

  // Marks stop at a line's end: a mark never carries over a Return, as
  // on iOS, where what is typed at a line's start carries no marks.
  fun cutMarksAtLines(text: Editable, from: Int, to: Int) {
    val start = lineStart(text, from)
    val end = lineEnd(text, to)
    for (span in text.getSpans(start, end, MarksSpan::class.java)) {
      val s = text.getSpanStart(span)
      val e = text.getSpanEnd(span)
      if ((s until e).none { text[it] == '\n' }) continue
      text.removeSpan(span)
      var pieceStart = s
      for (i in s..e) {
        if (i == e || text[i] == '\n') {
          if (i > pieceStart) text.setSpan(MarksSpan(span.marks), pieceStart, i, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
          pieceStart = i + 1
        }
      }
    }
  }

  // A mention whose words were changed (typed into, cut short) is no
  // longer the mention: its span comes off and the words stay as text.
  fun dropBrokenMentions(text: Editable, from: Int, to: Int) {
    val start = lineStart(text, from)
    val end = lineEnd(text, to)
    for (span in text.getSpans(start, end, MentionSpan::class.java)) {
      val s = text.getSpanStart(span)
      val e = text.getSpanEnd(span)
      if (text.subSequence(s, e).toString() != span.words) text.removeSpan(span)
    }
  }

  fun clearMeaning(text: Spannable, start: Int, end: Int) {
    for (kind in listOf(MarksSpan::class.java, HrefSpan::class.java, MentionSpan::class.java)) {
      for (span in text.getSpans(start, end, kind)) text.removeSpan(span)
    }
  }
}
