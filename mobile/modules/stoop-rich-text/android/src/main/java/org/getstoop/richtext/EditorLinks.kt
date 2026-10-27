package org.getstoop.richtext

import android.text.Editable
import android.text.Spannable
import android.text.Spanned

// Links: an address held over the words it links (HrefSpan). The link
// around a caret or selection, what the link dialog opens with and what
// its Save and Remove do, an address the format reads back whole, bare
// addresses that only look like links, and "[words](https://…)" typed in
// full. As on iOS (ios/Editor/EditorLinks.swift).
internal object Links {
  // The address every character of [start, end) has.
  fun at(text: Spanned, start: Int, end: Int): String? =
    Document.spansAt(text, start, end, HrefSpan::class.java).firstOrNull()?.href

  private fun at(text: Spanned, index: Int): String? =
    if (index < 0 || index >= text.length) null else at(text, index, index + 1)

  // The whole link a caret is in (not at its edges: typing there isn't
  // linked), or a selection lies inside: every neighbouring character
  // with the same address, so a link partly bold is one link.
  fun around(text: Spanned, start: Int, end: Int): Pair<IntRange, String>? {
    val at = if (start == end) start - 1 else start
    val href = at(text, at) ?: return null
    if (start == end && at(text, start) != href) return null
    var from = at
    while (from > 0 && at(text, from - 1) == href) from--
    var to = at + 1
    while (to < text.length && at(text, to) == href) to++
    if (end > to) return null
    return (from until to) to href
  }

  // What typing at a position carries: the address, only inside a link.
  fun typing(text: Spanned, at: Int): String? {
    val href = at(text, at - 1) ?: return null
    return if (at(text, at) == href) href else null
  }

  // What the link dialog opens with (web's linkDraft): the link being
  // edited, else the selected words on one line, else nothing at the
  // caret (or, across lines, at the end of the last). Null in a code
  // block, which holds no links. The range is where Save lands.
  data class Draft(val range: IntRange, val text: String, val href: String, val editing: Boolean)

  fun draft(text: Spanned, start: Int, end: Int): Draft? {
    if (Blocks.atLineOf(text, start).block == Block.CODE || Blocks.atLineOf(text, end).block == Block.CODE) return null
    around(text, start, end)?.let { (range, href) ->
      return Draft(range, text.subSequence(range.first, range.last + 1).toString(), href, true)
    }
    val onOneLine = end <= Document.lineEnd(text, start)
    val range = if (onOneLine) start until end else end until end
    return Draft(range, text.subSequence(range.first, if (range.isEmpty()) range.first else range.last + 1).toString(), "", false)
  }

  // The dialog's Save: the words linked to the address, over `range`.
  // Words unchanged keep their own marks; new words take those where they
  // start. A pill in the words becomes its words (a mention is never
  // linked). The range the link now holds.
  fun set(text: Editable, range: IntRange, words: String, href: String): IntRange {
    val from = range.first
    var to = if (range.isEmpty()) from else range.last + 1
    val address = href.trim()
    val linked = words.trim().ifEmpty { address }
    if (text.subSequence(from, to).toString() != linked) {
      val marks = Marks.typing(text, from)
      Document.clearMeaning(text, from, to, blocksToo = false)
      text.replace(from, to, linked)
      to = from + linked.length
      Marks.set(text, from, to) { marks }
    }
    Mentions.drop(text, from, to)
    remove(text, from until to)
    if (to > from) text.setSpan(HrefSpan(address), from, to, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return from until to
  }

  // The dialog's Remove: the words stay, unlinked.
  fun remove(text: Spannable, range: IntRange) {
    if (range.isEmpty()) return
    for (span in text.getSpans(range.first, range.last + 1, HrefSpan::class.java)) {
      Document.cutOut(text, span, range.first, range.last + 1)
    }
  }

  // An address the message format reads back whole: http(s), no space or
  // "<", every ")" closing a "(" (core readableAddress).
  fun readable(href: String): Boolean {
    if (!Regex("^https?://[^\\s<]+$", RegexOption.IGNORE_CASE).matches(href)) return false
    var depth = 0
    for (character in href) {
      if (character == '(') depth++
      if (character == ')' && --depth < 0) return false
    }
    return depth == 0
  }

  // MARK: Bare addresses

  // A bare address stays text (the message format links it on its own)
  // and only looks like a link. Trailing punctuation belongs to the
  // sentence, as the parser reads it. The addresses in [start, end) that
  // are plain words: not linked, not a pill, not code.
  private val address = Regex("https?://[^\\s<>]+", RegexOption.IGNORE_CASE)

  fun bareAddresses(text: Spanned, start: Int, end: Int): List<IntRange> {
    val out = ArrayList<IntRange>()
    for (match in address.findAll(text.subSequence(start, end))) {
      val from = start + match.range.first
      var to = start + match.range.last + 1
      while (to > from && text[to - 1] in ".,;:!?)]'\"") to--
      if (to <= from) continue
      val plain = Document.boundaries(text, from, to).zipWithNext().none { (pieceStart, pieceEnd) ->
        pieceStart < pieceEnd && (at(text, pieceStart, pieceEnd) != null || Mentions.at(text, pieceStart, pieceEnd) != null ||
          Marks.at(text, pieceStart, pieceEnd) and Marks.CODE != 0)
      }
      if (plain) out.add(from until to)
    }
    return out
  }

  // MARK: Typed in full

  // "[words](https://address)" once its ")" is typed, at the end of the
  // line's text up to the caret.
  private val rule = Regex("\\[([^\\[\\]]+)\\]\\((https?://[^\\s()]+)\\)$")

  // In `before`: the whole, and the words.
  data class Rule(val all: IntRange, val words: IntRange, val href: String)

  fun rule(before: String): Rule? {
    val match = rule.find(before) ?: return null
    return Rule(match.range, match.groups[1]!!.range, match.groupValues[2])
  }

  // MARK: Look

  fun look(look: CharLook): CharLook = look.copy(color = CharLook.Color.ACCENT, underline = true)
}
