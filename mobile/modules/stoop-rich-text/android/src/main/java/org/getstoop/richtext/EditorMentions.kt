package org.getstoop.richtext

import android.text.Spannable
import android.text.Spanned

// Mentions as pills: who a mention names, held over the words it shows
// as (MentionSpan). A pill is one unit: the caret never rests inside it,
// a change that would cut into it takes it whole, and words no longer
// the handle are no longer a pill. As on iOS
// (ios/Editor/EditorMentions.swift).
internal object Mentions {
  // The pill every character of [start, end) is in.
  fun at(text: Spanned, start: Int, end: Int): MentionSpan? =
    Document.spansAt(text, start, end, MentionSpan::class.java).firstOrNull()

  private fun at(text: Spanned, index: Int): MentionSpan? =
    if (index < 0 || index >= text.length) null else at(text, index, index + 1)

  // The whole of the pill holding `index`.
  fun range(text: Spanned, index: Int): IntRange? {
    val span = at(text, index) ?: return null
    return text.getSpanStart(span) until text.getSpanEnd(span)
  }

  // The pill whose words hold `at` strictly inside them (not at their
  // edges).
  fun pill(text: Spanned, at: Int): IntRange? {
    if (at <= 0) return null
    val span = at(text, at) ?: return null
    if (at(text, at - 1) !== span) return null
    return range(text, at)
  }

  fun isWholePill(text: Spanned, start: Int, end: Int): Boolean {
    if (end <= start) return false
    val whole = range(text, start) ?: return false
    return whole.first == start && whole.last + 1 == end
  }

  // [start, end) grown to take every pill it cuts into whole; an
  // insertion inside a pill moved to its end.
  fun whole(text: Spanned, start: Int, end: Int): Pair<Int, Int> {
    if (start == end) {
      pill(text, start)?.let { return (it.last + 1) to (it.last + 1) }
      return start to end
    }
    var from = start
    var to = end
    pill(text, from)?.let { from = it.first }
    pill(text, to)?.let { to = it.last + 1 }
    return from to to
  }

  // Where a selection's edge rests when it lands at `at`, having been at
  // `was`: never inside a pill. It goes on past the pill the way it was
  // moving (stepped left from a pill's end, to its start), or to the
  // nearer edge when it jumped there (a tap).
  fun edge(text: Spanned, at: Int, was: Int): Int {
    val pill = pill(text, at) ?: return at
    val start = pill.first
    val end = pill.last + 1
    return when {
      was <= start -> end
      was >= end -> start
      at - start < end - at -> start
      else -> end
    }
  }

  // A pill whose words were changed (typed into, cut short, joined) is no
  // longer the pill: its span comes off and the words stay as text.
  fun dropBroken(text: Spannable, start: Int, end: Int) {
    for (span in text.getSpans(start, end, MentionSpan::class.java)) {
      val from = text.getSpanStart(span)
      val to = text.getSpanEnd(span)
      if (to <= from || text.subSequence(from, to).toString() != span.words) text.removeSpan(span)
    }
  }

  // The words at [start, end) made the pill: unlinked, one span.
  fun make(text: Spannable, start: Int, end: Int, mention: EditorMention) {
    if (end <= start) return
    Links.remove(text, start until end)
    drop(text, start, end)
    text.setSpan(MentionSpan(mention), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  }

  // Pills in [start, end) made their words (a code block, inline code, a
  // link and a link typed in full hold none).
  fun drop(text: Spannable, start: Int, end: Int) {
    for (span in text.getSpans(start, end, MentionSpan::class.java)) {
      if (text.getSpanStart(span) < end && text.getSpanEnd(span) > start) text.removeSpan(span)
    }
  }

  // Whether any pill lies in [start, end).
  fun any(text: Spanned, start: Int, end: Int): Boolean =
    text.getSpans(start, end, MentionSpan::class.java).any { text.getSpanStart(it) < end && text.getSpanEnd(it) > start }

  // The text of [start, end) with each pill's words as U+FFFC, so the
  // mention list's query can't start inside one and every index still
  // counts.
  fun masked(text: Spanned, start: Int, end: Int): String {
    val out = StringBuilder(text.subSequence(start, end))
    for (span in text.getSpans(start, end, MentionSpan::class.java)) {
      val from = maxOf(text.getSpanStart(span), start)
      val to = minOf(text.getSpanEnd(span), end)
      for (index in from until to) out.setCharAt(index - start, '\uFFFC')
    }
    return out.toString()
  }

  // MARK: Look

  fun look(look: CharLook): CharLook = look.copy(semibold = true, color = CharLook.Color.ACCENT, fill = CharLook.Fill.MENTION)
}
