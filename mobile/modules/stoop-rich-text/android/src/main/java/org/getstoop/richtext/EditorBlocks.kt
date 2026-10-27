package org.getstoop.richtext

import android.text.Editable
import android.text.Spannable
import android.text.SpannableString
import android.text.Spanned

// Blocks: each line is a paragraph, a quote line, a list item (bulleted
// or numbered, four levels) or a code block's line, held as one span over
// the line, its "\n" included (BlockSpan). Here: the lines a selection
// touches and what the row's buttons do to them, Return and Backspace at
// a block's edge, the markers typed at a line's start, the invariants an
// edit must leave true, and what each block draws. As on iOS
// (ios/Editor/EditorBlocks.swift).
internal enum class Block(val key: String) {
  PARAGRAPH("paragraph"), QUOTE("quote"), BULLET("bullet"), ORDERED("ordered"), CODE("code");

  val isList get() = this == BULLET || this == ORDERED

  companion object {
    fun of(key: String) = entries.firstOrNull { it.key == key } ?: PARAGRAPH
  }
}

// A line's block.
internal data class BlockInfo(val block: Block, val depth: Int = 0, val group: Int = 0, val lang: String? = null) {
  fun normalised() = BlockInfo(
    block,
    if (block.isList) depth.coerceIn(0, Blocks.MAX_DEPTH) else 0,
    if (block == Block.CODE) group else 0,
    if (block == Block.CODE) lang else null,
  )

  fun with(depth: Int) = BlockInfo(block, depth, group, lang).normalised()

  companion object {
    val PARAGRAPH = BlockInfo(Block.PARAGRAPH)
  }
}

// A line (its start and its end before the "\n") with the block it gets.
internal data class BlockLine(val start: Int, val end: Int, val block: BlockInfo)

internal object Blocks {
  const val MAX_DEPTH = 3

  // An empty line at the end of the text has no character to carry its
  // block, and Android's layout gives a zero-length last line no
  // paragraph spans, so one in a block holds this, and only this: a
  // zero-width space the caret sits after, never shown, never sent. It
  // is put in where a line is made or emptied (a Return at a block's
  // end, a block given to the empty last line, the last line of a block
  // emptied) and taken out wherever it no longer stands alone
  // (`holderFix`).
  const val HOLDER = "\u200B"
  const val HOLDER_CHARACTER = '\u200B'

  // MARK: Reading

  // The block of the line starting at `lineStart`: the span that starts
  // there (a holder's, when words were just typed after it: they land
  // outside its span until the line is settled), else one covering its
  // first character; a paragraph for the empty last line.
  fun at(text: Spanned, lineStart: Int): BlockInfo = spanAt(text, lineStart) ?: BlockInfo.PARAGRAPH

  // The block a line's span says, null when it has none (text put in at
  // the exclusive end of the line before's span: a paste, dictation).
  private fun spanAt(text: Spanned, lineStart: Int): BlockInfo? {
    if (lineStart >= text.length) return null
    val spans = text.getSpans(lineStart, lineStart + 1, BlockSpan::class.java)
      .filter { text.getSpanEnd(it) > text.getSpanStart(it) && text.getSpanStart(it) <= lineStart }
    return (spans.firstOrNull { text.getSpanStart(it) == lineStart } ?: spans.firstOrNull())?.info
  }

  fun atLineOf(text: Spanned, at: Int): BlockInfo = at(text, Document.lineStart(text, at))

  fun isHolderCharacter(text: CharSequence, index: Int): Boolean =
    index >= 0 && index < text.length && text[index] == HOLDER_CHARACTER

  // A line that is its holder and nothing else.
  fun isHolder(text: CharSequence, lineStart: Int): Boolean =
    Document.lineEnd(text, lineStart) == lineStart + 1 && isHolderCharacter(text, lineStart)

  // No words on the line (its holder doesn't count).
  fun isEmpty(text: CharSequence, lineStart: Int): Boolean =
    Document.lineEnd(text, lineStart) == lineStart || isHolder(text, lineStart)

  // The lines a caret or selection touches, each with its block: a caret
  // its own line; a selection every line it reaches, one whose start it
  // ends at included (web's rule); the empty last line as a zero-length
  // line at the end.
  fun lines(text: Spanned, start: Int, end: Int): List<BlockLine> {
    val out = ArrayList<BlockLine>()
    Document.forEachLine(text, start, end) { lineStart, lineEnd, _ ->
      if (start == end && out.isNotEmpty()) return@forEachLine
      out.add(BlockLine(lineStart, lineEnd, at(text, lineStart)))
    }
    return out
  }

  // MARK: Writing

  // The line's span replaced by one for `info`, over the line and its
  // "\n".
  private fun setSpan(text: Spannable, lineStart: Int, info: BlockInfo) {
    val spanEnd = Document.lineSpanEnd(text, lineStart)
    if (spanEnd <= lineStart) return
    for (span in text.getSpans(lineStart, spanEnd, BlockSpan::class.java)) {
      Document.cutOut(text, span, lineStart, spanEnd)
    }
    text.setSpan(BlockSpan(info), lineStart, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }

  // A code block holds plain text: marks, links and pills go, the words
  // stay. The one place that rule is written.
  private fun stripCode(text: Spannable, start: Int, end: Int) {
    if (end <= start) return
    Marks.clear(text, start, end)
    Links.remove(text, start until end)
    Mentions.drop(text, start, end)
  }

  // Each line given a block. The empty last line gets a holder for a
  // block, and loses it for a paragraph.
  fun set(text: Editable, lines: List<BlockLine>) {
    // Last first, so a holder put in or taken out moves no line before it.
    for (line in lines.sortedByDescending { it.start }) {
      val info = line.block.normalised()
      if (line.start >= text.length) {
        if (info.block != Block.PARAGRAPH) text.append(holder(info))
        continue
      }
      if (info.block == Block.PARAGRAPH && isHolder(text, line.start)) {
        text.delete(line.start, line.start + 1)
        if (Document.lineSpanEnd(text, line.start) > line.start) setSpan(text, line.start, info)
        continue
      }
      setSpan(text, line.start, info)
      if (info.block == Block.CODE) stripCode(text, line.start, Document.lineEnd(text, line.start))
    }
  }

  // Quote or code block on every line the caret or selection touches, or
  // off (back to plain lines) when the first has it already (web decides
  // by where the selection starts). Lines made a code block become one
  // block, `group`.
  fun toggle(text: Spanned, start: Int, end: Int, kind: Block, group: Int): List<BlockLine> {
    val lines = lines(text, start, end)
    val on = lines.firstOrNull()?.block?.block != kind
    val made = if (on) BlockInfo(kind, 0, group) else BlockInfo.PARAGRAPH
    return lines.map { it.copy(block = made) }
  }

  // A bulleted or numbered list on every line touched, or off when the
  // first is in that list already. A line already in a list keeps its
  // level.
  fun toggleList(text: Spanned, start: Int, end: Int, kind: Block): List<BlockLine> {
    val lines = lines(text, start, end)
    val on = lines.firstOrNull()?.block?.block != kind
    return lines.map { line ->
      line.copy(block = if (on) BlockInfo(kind, if (line.block.block.isList) line.block.depth else 0) else BlockInfo.PARAGRAPH)
    }
  }

  // The list level of the line before a line, null when it is no item.
  private fun depthBefore(text: Spanned, lineStart: Int): Int? {
    if (lineStart <= 0) return null
    val before = atLineOf(text, lineStart - 1)
    return if (before.block.isList) before.depth else null
  }

  // Indent (one level deeper, four at most, and never more than one past
  // the item before) or outdent (one level up; from the top level, out of
  // the list) each list line touched. An outdented item brings the items
  // under it along, as web lifts an item with its children. Empty when no
  // list line is touched.
  fun indent(text: Spanned, start: Int, end: Int, step: Int): List<BlockLine> {
    val lines = ArrayList(lines(text, start, end).filter { it.block.block.isList })
    if (lines.isEmpty()) return emptyList()
    if (step < 0) {
      val last = lines.last()
      var lineStart = Document.lineSpanEnd(text, last.start)
      while (lineStart < text.length) {
        val block = at(text, lineStart)
        if (!block.block.isList || block.depth <= last.block.depth) break
        lines.add(BlockLine(lineStart, Document.lineEnd(text, lineStart), block))
        lineStart = Document.lineSpanEnd(text, lineStart)
      }
    }
    var previous = depthBefore(text, lines[0].start)
    return lines.map { line ->
      val block = line.block
      val next = when {
        step > 0 -> {
          val deepest = minOf(MAX_DEPTH, (previous ?: -1) + 1)
          block.with(minOf(block.depth + 1, maxOf(block.depth, deepest)))
        }
        block.depth > 0 -> block.with(block.depth - 1)
        else -> BlockInfo.PARAGRAPH
      }
      previous = if (next.block.isList) next.depth else null
      line.copy(block = next)
    }
  }

  // MARK: Return and Backspace

  // Return on an empty quote line, or on a code block's blank last line,
  // leaves the block: the line becomes plain; on an empty list item it
  // goes up a level, or out of the list from the top. Null when Return
  // just adds a line.
  fun returnKey(text: Spanned, caret: Int): List<BlockLine>? {
    val start = Document.lineStart(text, caret)
    val end = Document.lineEnd(text, start)
    val block = at(text, start)
    if (!isEmpty(text, start)) return null
    val made = when (block.block) {
      Block.QUOTE -> BlockInfo.PARAGRAPH
      Block.CODE -> if (isLastOfCodeBlock(text, start, block)) BlockInfo.PARAGRAPH else return null
      Block.BULLET, Block.ORDERED -> if (block.depth > 0) block.with(block.depth - 1) else BlockInfo.PARAGRAPH
      Block.PARAGRAPH -> return null
    }
    return listOf(BlockLine(start, end, made))
  }

  // What Backspace does at a block's edge, when not just deleting: the
  // line made plain (at the start of a quote's first line, of a list
  // item, or of a code block's first line, rather than joining it to the
  // one before), or an empty later line of a quote or code block (its
  // holder) taken out to join the line above, as on web.
  sealed class BackspaceAction {
    data class Plain(val lines: List<BlockLine>) : BackspaceAction()
    data class Join(val start: Int, val end: Int) : BackspaceAction()
  }

  // Null when Backspace just deletes.
  fun backspaceKey(text: Spanned, caret: Int): BackspaceAction? {
    val start = Document.lineStart(text, caret)
    val holder = isHolder(text, start)
    val atStart = caret == start || (holder && caret == start + 1)
    if (!atStart) return null
    val block = at(text, start)
    val before = if (start > 0) atLineOf(text, start - 1) else null
    val starts = when (block.block) {
      Block.QUOTE -> before?.block != Block.QUOTE
      Block.CODE -> !(before?.block == Block.CODE && before.group == block.group)
      Block.BULLET, Block.ORDERED -> true
      Block.PARAGRAPH -> false
    }
    if (starts) return BackspaceAction.Plain(listOf(BlockLine(start, Document.lineEnd(text, start), BlockInfo.PARAGRAPH)))
    if (holder && start > 0) return BackspaceAction.Join(start - 1, start + 1)
    return null
  }

  // What a Return at `caret` puts in when the line is a block's: the
  // newline carrying the block, and a holder after it when the new line
  // is the last. Null on a paragraph (the keyboard's own Return will do)
  // or where Return leaves the block (`returnKey`).
  fun newline(text: Spanned, caret: Int): SpannableString? {
    val start = Document.lineStart(text, caret)
    val block = at(text, start)
    if (block.block == Block.PARAGRAPH) return null
    val last = Document.lineEnd(text, start) >= text.length && caret >= Document.lineEnd(text, start)
    val made = SpannableString(if (last) "\n" + HOLDER else "\n")
    made.setSpan(BlockSpan(block), 0, made.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return made
  }

  // Whether deleting [start, end) leaves the last line of a block with no
  // words: the holder then stands in for them, so the line keeps its
  // block (a nested item stays at its level).
  fun emptiesLastBlockLine(text: Spanned, start: Int, end: Int): Boolean {
    val lineStart = Document.lineStart(text, start)
    val lineEnd = Document.lineEnd(text, lineStart)
    if (lineEnd < text.length || lineEnd == lineStart || isHolder(text, lineStart)) return false
    if (start > lineStart || end < lineEnd) return false
    return at(text, lineStart).block != Block.PARAGRAPH
  }

  private fun isLastOfCodeBlock(text: Spanned, lineStart: Int, block: BlockInfo): Boolean {
    val next = Document.lineSpanEnd(text, lineStart)
    if (next >= text.length || next == Document.lineEnd(text, lineStart)) return true
    val after = at(text, next)
    return !(after.block == Block.CODE && after.group == block.group)
  }

  // MARK: Typed at a line's start

  private val ordered = Regex("^\\d{1,9}[.)] $")

  // "> " a quote, "- " or "* " a bulleted item, "1. " or "1) " a numbered
  // one, "```" a code block: the whole of a paragraph's text up to the
  // caret.
  fun rule(before: String): Block? = when {
    before == "> " -> Block.QUOTE
    before == "- " || before == "* " -> Block.BULLET
    before == "```" -> Block.CODE
    ordered.matches(before) -> Block.ORDERED
    else -> null
  }

  // MARK: Invariants

  // Each line holds one block span, its first character's: two lines
  // joined by a backspace become one line of the first's kind, a line
  // split by a Return keeps its kind on both halves (the span a Return
  // stretched over both is cut), and a code line holds plain text. A
  // line with no span that the change in [from, to) began (text with
  // newlines put in at the exclusive end of the line before: a paste,
  // dictation) takes the line before's, as iOS's typing attributes carry
  // it; one that was there before the change (the empty last line a
  // Return left a block for) is a paragraph.
  fun normalise(text: Editable, from: Int, to: Int) {
    Document.forEachLine(text, from, to) { start, end, spanEnd ->
      if (spanEnd <= start) return@forEachLine
      val info = spanAt(text, start) ?: (if (start > from && start > 0) atLineOf(text, start - 1) else BlockInfo.PARAGRAPH)
      setSpan(text, start, info)
      if (info.block == Block.CODE) stripCode(text, start, end)
    }
  }

  // Each list line held to one level deeper than the list line before it
  // at most (0 for a list's first line), as core's linesToDoc reads
  // lines, so what the field draws is what is sent. The lines changed
  // (start and end after the "\n").
  fun normaliseDepths(text: Editable): List<Pair<Int, Int>> {
    val changed = ArrayList<Pair<Int, Int>>()
    var before = -1
    Document.forEachLine(text) { start, _, spanEnd ->
      if (spanEnd <= start) return@forEachLine
      val block = at(text, start)
      if (!block.block.isList) {
        before = -1
        return@forEachLine
      }
      val depth = minOf(block.depth, before + 1)
      if (depth != block.depth) {
        setSpan(text, start, block.with(depth))
        changed.add(start to spanEnd)
      }
      before = depth
    }
    return changed
  }

  // A holder that no longer stands alone on the last line (words were put
  // beside it, or lines after it): where it is, to take out, if any.
  fun holderFix(text: Spanned): Int? {
    var fix: Int? = null
    Document.forEachLine(text) { start, end, spanEnd ->
      if (fix != null) return@forEachLine
      for (index in start until end) {
        if (isHolderCharacter(text, index) && (end - start > 1 || spanEnd > end)) {
          fix = index
          return@forEachLine
        }
      }
    }
    return fix
  }

  // The holder for a block, as a Return or an emptied line puts it in.
  fun holder(block: BlockInfo): SpannableString {
    val made = SpannableString(HOLDER)
    made.setSpan(BlockSpan(block), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return made
  }

  // MARK: What a block draws

  // The runs of lines drawn as one: a code block's box, a quote's bar.
  // `blocks` is each line's block, first to last.
  data class Run(val kind: Block, val first: Int, val last: Int)

  fun runs(blocks: List<BlockInfo>): List<Run> {
    val out = ArrayList<Run>()
    var index = 0
    while (index < blocks.size) {
      val block = blocks[index]
      if (block.block != Block.CODE && block.block != Block.QUOTE) {
        index++
        continue
      }
      var end = index + 1
      while (end < blocks.size && blocks[end].block == block.block && (block.block != Block.CODE || blocks[end].group == block.group)) end++
      out.add(Run(block.block, index, end - 1))
      index = end
    }
    return out
  }

  // A list line's marker: a bullet by level (•, ◦, ▪), or the item's
  // number counted among the items before it at its level.
  fun marker(blocks: List<BlockInfo>, index: Int): String? {
    val block = blocks[index]
    if (!block.block.isList) return null
    if (block.block == Block.BULLET) return listOf("•", "◦", "▪", "•")[minOf(block.depth, 3)]
    var number = 1
    var back = index - 1
    while (back >= 0 && blocks[back].block.isList && blocks[back].depth >= block.depth) {
      if (blocks[back].depth == block.depth) {
        if (blocks[back].block != Block.ORDERED) break
        number++
      }
      back--
    }
    return "$number."
  }

  // MARK: Look

  fun look(block: BlockInfo, look: CharLook): CharLook = when (block.block) {
    Block.QUOTE -> look.copy(color = CharLook.Color.MUTED)
    Block.CODE -> look.copy(mono = true)
    else -> look
  }

  // How far a block's lines are indented, in the style's units.
  data class Metrics(val quoteBarWidth: Double, val quotePadX: Double, val listIndent: Double, val prePadX: Double)

  fun indent(block: BlockInfo, metrics: Metrics): Double = when (block.block) {
    Block.QUOTE -> metrics.quoteBarWidth + metrics.quotePadX
    Block.BULLET, Block.ORDERED -> metrics.listIndent * (block.depth + 1)
    Block.CODE -> metrics.prePadX
    Block.PARAGRAPH -> 0.0
  }
}
