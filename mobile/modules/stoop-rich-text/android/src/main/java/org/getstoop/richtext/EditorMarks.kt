package org.getstoop.richtext

import android.text.Spannable
import android.text.Spanned

// The inline marks: bold, italic, underline, strike, inline code and
// spoiler, held on the text as bits (MarksSpan). What they mean to
// typing, to a toggle and to a shortcut typed around words is here; how
// each looks is in `look`, which the styler draws. As on iOS
// (ios/Editor/EditorMarks.swift).
internal object Marks {
  const val BOLD = 1
  const val ITALIC = 2
  const val UNDERLINE = 4
  const val STRIKE = 8
  const val CODE = 16
  const val SPOILER = 32

  // In core's order (EditorMark), which is the toolbar's.
  val named = listOf(
    "bold" to BOLD, "italic" to ITALIC, "underline" to UNDERLINE,
    "strike" to STRIKE, "code" to CODE, "spoiler" to SPOILER,
  )

  fun of(names: List<String>): Int = named.filter { it.first in names }.fold(0) { acc, (_, bit) -> acc or bit }

  fun named(name: String): Int? = named.firstOrNull { it.first == name }?.second

  fun names(marks: Int): List<String> = named.filter { marks and it.second != 0 }.map { it.first }

  // MARK: Reading

  // The marks every character of [start, end) has.
  fun at(text: Spanned, start: Int, end: Int): Int =
    Document.spansAt(text, start, end, MarksSpan::class.java).fold(0) { acc, span -> acc or span.marks }

  // What typing at a position carries: the marks of the character before
  // it on its line (typing at the end of bold words goes on in bold; a
  // pill's marks go on too, the pill itself never does), none at a
  // line's start or in a code block.
  fun typing(text: Spanned, at: Int): Int {
    val index = at.coerceIn(0, text.length)
    if (index == 0 || text[index - 1] == Document.NEWLINE) return 0
    if (Blocks.atLineOf(text, index).block == Block.CODE) return 0
    if (Blocks.isHolderCharacter(text, index - 1)) return 0
    return at(text, index - 1, index)
  }

  // The parts of a range a mark can go on: words, not newlines, and not a
  // code block's.
  fun markable(text: Spanned, start: Int, end: Int): List<Pair<Int, Int>> {
    val out = ArrayList<Pair<Int, Int>>()
    Document.forEachLine(text, start, end) { lineStart, lineEnd, _ ->
      val from = maxOf(lineStart, start)
      val to = minOf(lineEnd, end)
      if (to <= from || Blocks.at(text, lineStart).block == Block.CODE || Blocks.isHolder(text, lineStart)) return@forEachLine
      out.add(from to to)
    }
    return out
  }

  // The marks every markable character of a range has.
  fun common(text: Spanned, start: Int, end: Int): Int {
    var common: Int? = null
    for ((from, to) in markable(text, start, end)) {
      val cuts = Document.boundaries(text, from, to)
      for (i in 0 until cuts.size - 1) {
        if (cuts[i] >= cuts[i + 1]) continue
        val marks = at(text, cuts[i], cuts[i + 1])
        common = common?.and(marks) ?: marks
      }
    }
    return common ?: 0
  }

  // MARK: Writing

  // Each markable character's marks changed by `change`: the spans there
  // are cut at the range's ends and each piece takes what `change` gives
  // it. Inline code holds no pill: a pill given code becomes its words.
  fun set(text: Spannable, start: Int, end: Int, change: (Int) -> Int) {
    for ((from, to) in markable(text, start, end)) {
      val cuts = Document.boundaries(text, from, to)
      val pieces = (0 until cuts.size - 1).filter { cuts[it] < cuts[it + 1] }
        .map { Triple(cuts[it], cuts[it + 1], change(at(text, cuts[it], cuts[it + 1]))) }
      for (span in text.getSpans(from, to, MarksSpan::class.java)) Document.cutOut(text, span, from, to)
      for ((pieceStart, pieceEnd, marks) in pieces) {
        if (marks != 0) text.setSpan(MarksSpan(marks), pieceStart, pieceEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        if (marks and CODE != 0) Mentions.drop(text, pieceStart, pieceEnd)
      }
    }
  }

  // Every mark off, whatever the block (a line made a code block).
  fun clear(text: Spannable, start: Int, end: Int) {
    for (span in text.getSpans(start, end, MarksSpan::class.java)) Document.cutOut(text, span, start, end)
  }

  // A mark over a selection: on everywhere, unless all of it has it
  // already, then off (web's rule). Whether it went on.
  fun toggle(text: Spannable, mark: Int, start: Int, end: Int): Boolean {
    val on = common(text, start, end) and mark == 0
    set(text, start, end) { if (on) it or mark else it and mark.inv() }
    return on
  }

  // MARK: Typed around words

  // A marker pair typed around words (web's input rules): "**x**" bold,
  // "*x*" italic, "__x__" underline, "~~x~~" strike, "||x||" spoiler,
  // "`x`" code. Matched at the end of the line's text up to the caret.
  val rules: List<Pair<Regex, Int>> = run {
    fun rule(open: String, mark: Int): Pair<Regex, Int> {
      // Each marker character escaped (all are punctuation).
      val marker = open.map { "\\$it" }.joinToString("")
      val first = "\\${open[0]}"
      return Regex("(?:^|\\s)($marker([^\\s$first](?:[^$first]*[^\\s$first])?)$marker)$") to mark
    }
    listOf(
      rule("**", BOLD), rule("__", UNDERLINE), rule("~~", STRIKE), rule("||", SPOILER), rule("`", CODE),
      // A lone "*", not the second star of "**".
      Regex("(?:^|[^*])(\\*([^\\s*](?:[^*]*[^\\s*])?)\\*)$") to ITALIC,
    )
  }

  // In `before`: the markers and words, and the words alone.
  data class Rule(val marked: IntRange, val words: IntRange, val mark: Int)

  fun rule(before: String): Rule? {
    for ((pattern, mark) in rules) {
      val match = pattern.find(before) ?: continue
      return Rule(match.groups[1]!!.range, match.groups[2]!!.range, mark)
    }
    return null
  }

  // MARK: Look

  fun look(marks: Int, look: CharLook): CharLook = look.copy(
    bold = look.bold || marks and BOLD != 0,
    italic = look.italic || marks and ITALIC != 0,
    underline = look.underline || marks and UNDERLINE != 0,
    strike = look.strike || marks and STRIKE != 0,
    mono = look.mono || marks and CODE != 0,
    fill = if (marks and CODE != 0) CharLook.Fill.CODE else look.fill,
    spoiler = look.spoiler || marks and SPOILER != 0,
  )
}

// A character's look, as the features describe it and the styler draws
// it: faces, lines, a colour, and the box behind it.
internal data class CharLook(
  val bold: Boolean = false,
  val italic: Boolean = false,
  val semibold: Boolean = false,
  val mono: Boolean = false,
  val underline: Boolean = false,
  val strike: Boolean = false,
  val color: Color = Color.TEXT,
  val fill: Fill? = null,
  val spoiler: Boolean = false,
) {
  enum class Color { TEXT, MUTED, ACCENT }
  enum class Fill { CODE, MENTION }
}
