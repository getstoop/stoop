package org.getstoop.richtext

import android.text.SpannableStringBuilder
import android.text.Spanned
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// The editor's rules, on the text as the field holds it: a few cases per
// feature, each a behaviour the composer shows (the Maestro flows check
// the same from the outside), the same cases as tests/ios. Run with
// `./gradlew :stoop-rich-text:testDebugUnitTest` in mobile/android.

private val ada = EditorMention("person", "u1", "ada")

private fun text(lines: List<EditorLine>) = Document.attributed(lines)
private fun paragraph(vararg runs: EditorRun) = EditorLine(runs = runs.toList())
private fun plain(words: String) = text(listOf(paragraph(EditorRun.text(words))))
private fun words(words: String, marks: List<String> = emptyList(), href: String? = null) = EditorRun.text(words, marks, href)
private fun mention(mention: EditorMention, marks: List<String> = emptyList()) = EditorRun.mention(mention, marks)
private fun block(info: BlockInfo, text: SpannableStringBuilder, start: Int) {
  text.setSpan(BlockSpan(info), start, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DocumentTests {
  @Test
  fun linesRoundTrip() {
    val lines = listOf(
      paragraph(words("hi "), words("bold", listOf("bold")), words(" "), mention(ada)),
      EditorLine("quote", group = 1, runs = listOf(words("see "), words("docs", href = "https://x.org"))),
      EditorLine("quote", group = 1),
      EditorLine("bullet", 0, 2, runs = listOf(words("one"))),
      EditorLine("ordered", 1, 2, runs = listOf(words("two"))),
      EditorLine("code", 0, 3, "js", listOf(words("x = 1"))),
      EditorLine("code", 0, 3, "js"),
      EditorLine("paragraph", 0, 4, runs = listOf(words("after"))),
      EditorLine("bullet", 0, 5),
    )
    val built = text(lines)
    assertEquals("hi bold @ada\nsee docs\n\none\ntwo\nx = 1\n\nafter\n\u200B", built.toString())
    assertEquals(lines, Document.lines(built))
  }

  @Test
  fun emptyAndPlainTexts() {
    assertEquals(listOf(paragraph()), Document.lines(SpannableStringBuilder()))
    assertEquals(listOf(paragraph(words("a")), EditorLine(group = 1)), Document.lines(plain("a\n")))
  }

  @Test
  fun codeKeepsOnlyWords() {
    val built = text(listOf(EditorLine("code", runs = listOf(words("a", listOf("bold")), mention(ada)))))
    assertEquals(listOf(EditorLine("code", runs = listOf(words("a@ada")))), Document.lines(built))
  }

  @Test
  fun activeFormats() {
    val built = text(listOf(
      paragraph(words("ab", listOf("bold")), words("cd", listOf("bold", "italic"), "https://x.org")),
      EditorLine("ordered", runs = listOf(words("e"))),
    ))
    assertEquals(listOf("bold"), Document.activeFormats(built, 2, 2, null))
    assertEquals(listOf("bold", "italic", "link"), Document.activeFormats(built, 3, 3, null))
    assertEquals(listOf("bold"), Document.activeFormats(built, 0, 4, null))
    assertEquals(listOf("strike"), Document.activeFormats(built, 0, 0, Marks.STRIKE))
    assertEquals(listOf("orderedList"), Document.activeFormats(built, 6, 6, null))
  }

  @Test
  fun textBeforeMasksPillsAndSkipsHolder() {
    val built = text(listOf(paragraph(words("hi "), mention(ada), words(" @b")), EditorLine("bullet")))
    assertEquals("hi \uFFFC\uFFFC\uFFFC\uFFFC @b", Document.textBefore(built, 10))
    assertEquals("", Document.textBefore(built, built.length))
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MarksTests {
  @Test
  fun typingCarriesTheMarkBefore() {
    val built = text(listOf(paragraph(words("ab", listOf("bold")), words("c"))))
    assertEquals(Marks.BOLD, Marks.typing(built, 2))
    assertEquals(0, Marks.typing(built, 3))
    assertEquals(0, Marks.typing(built, 0))
    val code = text(listOf(EditorLine("code", runs = listOf(words("x")))))
    assertEquals(0, Marks.typing(code, 1))
  }

  @Test
  fun inlineCodeHoldsNoPill() {
    val built = text(listOf(paragraph(words("a "), mention(ada))))
    Marks.toggle(built, Marks.CODE, 0, 6)
    assertEquals(listOf(paragraph(words("a @ada", listOf("code")))), Document.lines(built))
  }

  @Test
  fun toggleFollowsWebsRule() {
    val built = text(listOf(paragraph(words("ab", listOf("bold")), words("cd"))))
    assertTrue(Marks.toggle(built, Marks.BOLD, 0, 4))
    assertEquals(Marks.BOLD, Marks.common(built, 0, 4))
    assertFalse(Marks.toggle(built, Marks.BOLD, 0, 4))
    assertEquals(0, Marks.common(built, 0, 4))
  }

  @Test
  fun markableSkipsCodeLinesAndNewlines() {
    val built = text(listOf(paragraph(words("ab")), EditorLine("code", runs = listOf(words("cd"))), paragraph(words("ef"))))
    assertEquals(listOf(0 to 2, 6 to 8), Marks.markable(built, 0, built.length))
    assertTrue(Marks.markable(built, 3, 5).isEmpty())
  }

  @Test
  fun rules() {
    assertEquals(Marks.Rule(4..9, 6..7, Marks.BOLD), Marks.rule("say **hi**"))
    assertEquals(Marks.ITALIC, Marks.rule("*it*")?.mark)
    assertEquals(Marks.CODE, Marks.rule("a `x`")?.mark)
    assertEquals(Marks.SPOILER, Marks.rule("||s||")?.mark)
    assertNull(Marks.rule("**hi"))
    assertNull(Marks.rule("** hi **"))
    assertNull(Marks.rule("a**b**"))
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LinksTests {
  private val built = text(listOf(paragraph(words("see "), words("the ", href = "https://x.org"), words("docs", listOf("bold"), "https://x.org"), words(" now"))))

  @Test
  fun aroundCaretAndSelection() {
    assertEquals(4..11, Links.around(built, 6, 6)?.first)
    assertNull("at the start is outside", Links.around(built, 4, 4))
    assertNull("at the end is outside", Links.around(built, 12, 12))
    assertEquals("https://x.org", Links.around(built, 5, 8)?.second)
    assertNull("running out of it", Links.around(built, 5, 15))
    assertNull(Links.typing(built, 12))
    assertEquals("https://x.org", Links.typing(built, 8))
  }

  @Test
  fun draftAndSet() {
    assertEquals(Links.Draft(4..11, "the docs", "https://x.org", true), Links.draft(built, 6, 6))
    assertEquals(Links.Draft(13..15, "now", "", false), Links.draft(built, 13, 16))
    val fresh = plain("plain words")
    val target = Links.set(fresh, 6..10, "", " https://y.org ")
    assertEquals(6..18, target)
    assertEquals(listOf(paragraph(words("plain "), words("https://y.org", href = "https://y.org"))), Document.lines(fresh))
    Links.remove(fresh, target)
    assertEquals(listOf(paragraph(words("plain https://y.org"))), Document.lines(fresh))
  }

  @Test
  fun setDropsPillsAndKeepsMarks() {
    val built = text(listOf(paragraph(words("ab", listOf("bold")), mention(ada))))
    Links.set(built, 0..5, "ab@ada", "https://x.org")
    assertEquals(listOf(paragraph(words("ab", listOf("bold"), "https://x.org"), words("@ada", href = "https://x.org"))), Document.lines(built))
  }

  @Test
  fun readableAndBareAddresses() {
    assertTrue(Links.readable("https://x.org/a_(b)"))
    assertFalse(Links.readable("https://x.org/a)b"))
    assertFalse(Links.readable("x.org"))
    val bare = text(listOf(paragraph(words("go https://x.org/a). "), words("https://in.code", listOf("code")))))
    assertEquals(listOf(3..17), Links.bareAddresses(bare, 0, bare.length))
  }

  @Test
  fun rule() {
    assertEquals(Links.Rule(4..26, 5..8, "https://x.org/a"), Links.rule("see [docs](https://x.org/a)"))
    assertNull(Links.rule("[docs](x.org)"))
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MentionsTests {
  private val built = text(listOf(paragraph(words("hi "), mention(ada), words(" "), mention(ada))))

  @Test
  fun oneUnit() {
    assertEquals(3..6, Mentions.pill(built, 5))
    assertNull(Mentions.pill(built, 3))
    assertNull(Mentions.pill(built, 7))
    assertEquals(7 to 7, Mentions.whole(built, 5, 5))
    assertEquals(2 to 7, Mentions.whole(built, 2, 5))
    assertEquals(3 to 12, Mentions.whole(built, 5, 10))
    assertTrue(Mentions.isWholePill(built, 3, 7))
    assertFalse(Mentions.isWholePill(built, 3, 6))
  }

  @Test
  fun edgeFollowsTheMove() {
    assertEquals("stepped left from the end", 3, Mentions.edge(built, 5, 7))
    assertEquals("stepped right from before", 7, Mentions.edge(built, 5, 2))
    assertEquals("a tap goes to the nearer edge", 3, Mentions.edge(built, 4, 20))
    assertEquals(1, Mentions.edge(built, 1, 7))
  }

  @Test
  fun brokenPillsBecomeWords() {
    built.delete(5, 6)
    Mentions.dropBroken(built, 0, built.length)
    assertEquals(listOf(paragraph(words("hi @aa "), mention(ada))), Document.lines(built))
  }

  @Test
  fun makeUnlinks() {
    val linked = text(listOf(paragraph(words("@ada", href = "https://x.org"))))
    Mentions.make(linked, 0, 4, ada)
    assertEquals(listOf(paragraph(mention(ada))), Document.lines(linked))
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BlocksTests {
  @Test
  fun wordsTypedAfterAHolderKeepItsBlock() {
    val built = text(listOf(EditorLine("bullet", 0, runs = listOf(words("a"))), EditorLine("bullet", 1)))
    built.append("s")
    assertEquals(BlockInfo(Block.BULLET, 1), Blocks.at(built, 2))
    Document.settle(built, 3, 4)
    val stray = Blocks.holderFix(built)!!
    built.delete(stray, stray + 1)
    assertEquals(listOf(EditorLine("bullet", 0, runs = listOf(words("a"))), EditorLine("bullet", 1, runs = listOf(words("s")))), Document.lines(built))
  }

  @Test
  fun touchedLinesAndToggle() {
    val built = text(listOf(paragraph(words("a")), paragraph(words("b")), paragraph(words("c"))))
    assertEquals("a selection ending at a line's start takes it", listOf(0, 2), Blocks.lines(built, 0, 2).map { it.start })
    assertEquals(listOf(2), Blocks.lines(built, 3, 3).map { it.start })
    Blocks.set(built, Blocks.toggle(built, 0, 3, Block.QUOTE, 0))
    assertEquals(listOf("quote", "quote", "paragraph"), Document.lines(built).map { it.block })
    assertEquals("off when the first line has it", listOf(Block.PARAGRAPH), Blocks.toggle(built, 0, 0, Block.QUOTE, 0).map { it.block.block })
  }

  @Test
  fun codeBlockHoldsPlainText() {
    val built = text(listOf(paragraph(words("a", listOf("bold")), mention(ada), words("b", href = "https://x.org"))))
    Blocks.set(built, Blocks.toggle(built, 0, 0, Block.CODE, 7))
    assertEquals(listOf(EditorLine("code", runs = listOf(words("a@adab")))), Document.lines(built))
  }

  @Test
  fun listsIndentAndNormalise() {
    val built = text(listOf(paragraph(words("a")), paragraph(words("b")), paragraph(words("c"))))
    Blocks.set(built, Blocks.toggleList(built, 0, built.length, Block.BULLET))
    Blocks.set(built, Blocks.indent(built, 2, 2, 1))
    Blocks.set(built, Blocks.indent(built, 4, 4, 1))
    Blocks.set(built, Blocks.indent(built, 4, 4, 1))
    assertEquals(listOf(0, 1, 2), Document.lines(built).map { it.depth })
    assertEquals("never deeper than one past the item before", listOf(0), Blocks.indent(built, 0, 0, 1).map { it.block.depth })
    // Outdenting the middle item brings the one under it along.
    Blocks.set(built, Blocks.indent(built, 2, 2, -1))
    assertEquals(listOf(0, 0, 1), Document.lines(built).map { it.depth })
    Blocks.set(built, Blocks.indent(built, 0, 0, -1))
    assertEquals(listOf("paragraph", "bullet", "bullet"), Document.lines(built).map { it.block })
    assertEquals("a list's first line is held to level 0 as it is read", listOf(0, 0, 1), Document.lines(built).map { it.depth })
  }

  @Test
  fun holderStandsForAnEmptyLastLine() {
    val built = plain("")
    Blocks.set(built, Blocks.toggleList(built, 0, 0, Block.BULLET))
    assertEquals(Blocks.HOLDER, built.toString())
    assertEquals(listOf(EditorLine("bullet")), Document.lines(built))
    assertTrue(Blocks.isEmpty(built, 0))
    built.append("x")
    block(BlockInfo(Block.BULLET), built, 0)
    assertEquals("words beside it send it away", 0, Blocks.holderFix(built))
    built.delete(0, 1)
    assertEquals("x", built.toString())
    assertNull(Blocks.holderFix(built))
    // A Return at a block's end carries the block, and a holder after it
    // when the new line is the last.
    val quote = text(listOf(EditorLine("quote", runs = listOf(words("q")))))
    assertEquals("\n" + Blocks.HOLDER, Blocks.newline(quote, 1).toString())
    assertEquals("\n", Blocks.newline(text(listOf(EditorLine("quote", runs = listOf(words("q"))), paragraph(words("p")))), 1).toString())
    assertNull(Blocks.newline(plain("p"), 1))
    // The holder is never put in from the line before: an empty last line
    // after a list the Return left stays plain.
    val left = text(listOf(EditorLine("bullet", runs = listOf(words("i"))), EditorLine("bullet")))
    Blocks.set(left, Blocks.returnKey(left, 3)!!)
    assertEquals("i\n", left.toString())
    assertNull(Blocks.holderFix(left))
    assertEquals(listOf("bullet", "paragraph"), Document.lines(left).map { it.block })
  }

  @Test
  fun returnAndBackspaceAtAnEdge() {
    val built = text(listOf(
      EditorLine("quote", runs = listOf(words("q"))), EditorLine("quote"),
      EditorLine("bullet", 1, runs = listOf(words("i"))), EditorLine("bullet", 1),
    ))
    // "q\n" + "\n" + "i\n" + holder
    assertNull("a Return in words adds a line", Blocks.returnKey(built, 1))
    assertEquals("on an empty quote line, out", listOf(Block.PARAGRAPH), Blocks.returnKey(built, 2)?.map { it.block.block })
    assertEquals("on an empty nested item, up a level", listOf(0), Blocks.returnKey(built, 6)?.map { it.block.depth })
    assertEquals("the first quote line leaves the quote", Blocks.BackspaceAction.Plain(listOf(BlockLine(0, 1, BlockInfo.PARAGRAPH))), Blocks.backspaceKey(built, 0))
    assertNull("a later quote line joins the one above by the newline going", Blocks.backspaceKey(built, 2))
    assertEquals("an item's holder counts as its start", Blocks.BackspaceAction.Plain(listOf(BlockLine(5, 6, BlockInfo.PARAGRAPH))), Blocks.backspaceKey(built, 6))
    assertNull("not at a line's start", Blocks.backspaceKey(built, 4))
    val code = text(listOf(EditorLine("code", 0, 1, runs = listOf(words("a"))), EditorLine("code", 0, 1)))
    assertEquals("the blank last code line leaves the block", listOf(Block.PARAGRAPH), Blocks.returnKey(code, 2)?.map { it.block.block })
    assertEquals("a code block's empty later line joins the one above", Blocks.BackspaceAction.Join(1, 3), Blocks.backspaceKey(code, 3))
    val lines = text(listOf(EditorLine("quote", runs = listOf(words("q"))), EditorLine("quote", runs = listOf(words("w")))))
    assertNull("a later line with words just deletes the newline", Blocks.backspaceKey(lines, 2))
  }

  @Test
  fun emptiedLastLineKeepsItsBlock() {
    val built = text(listOf(EditorLine("bullet", runs = listOf(words("a"))), EditorLine("bullet", 1, runs = listOf(words("bc")))))
    assertTrue(Blocks.emptiesLastBlockLine(built, 2, 4))
    assertFalse("a backspace at the end leaves a word", Blocks.emptiesLastBlockLine(built, 3, 4))
    assertFalse("a deletion joining the lines keeps the first's words", Blocks.emptiesLastBlockLine(built, 1, 4))
    assertFalse("a paragraph needs no holder", Blocks.emptiesLastBlockLine(plain("ab"), 0, 2))
  }

  @Test
  fun codeBlockIsTheOnePlaceWordsAreStripped() {
    val built = text(listOf(paragraph(words("a", listOf("bold")), mention(ada), words("b", href = "https://x.org"))))
    Blocks.set(built, listOf(BlockLine(0, built.length, BlockInfo(Block.CODE, 0, 2))))
    assertEquals(listOf(EditorLine("code", runs = listOf(words("a@adab")))), Document.lines(built))
  }

  @Test
  fun textAtABlocksEndStaysInTheBlock() {
    // Lines put in at the exclusive end of a code line's span (a plain
    // paste, dictation) take the block, as iOS's typing attributes would.
    val built = text(listOf(EditorLine("code", 0, 1, runs = listOf(words("x")))))
    built.append("a\nb")
    Document.settle(built, 1, 4)
    assertEquals(listOf("code", "code"), Document.lines(built).map { it.block })
    // Typed on the empty last line a Return left a block for, words stay
    // plain: that line was there before the change.
    val left = text(listOf(EditorLine("quote", runs = listOf(words("q")))))
    left.append("\n")
    Document.settle(left, 1, 2)
    left.append("after")
    Document.settle(left, 2, 7)
    assertEquals(listOf("quote", "paragraph"), Document.lines(left).map { it.block })
  }

  @Test
  fun rulesAndDrawing() {
    assertEquals(Block.BULLET, Blocks.rule("- "))
    assertEquals(Block.ORDERED, Blocks.rule("12) "))
    assertEquals(Block.CODE, Blocks.rule("```"))
    assertNull(Blocks.rule("-"))
    val blocks = listOf(BlockInfo(Block.ORDERED), BlockInfo(Block.BULLET, 1), BlockInfo(Block.ORDERED), BlockInfo(Block.CODE, 0, 1), BlockInfo(Block.CODE, 0, 1), BlockInfo(Block.CODE, 0, 2))
    assertEquals(listOf("1.", "◦", "2.", null, null, null), blocks.indices.map { Blocks.marker(blocks, it) })
    assertEquals(listOf(listOf(3, 4), listOf(5, 5)), Blocks.runs(blocks).map { listOf(it.first, it.last) })
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SettleTests {
  @Test
  fun joinedLinesTakeTheFirstsBlock() {
    val built = text(listOf(EditorLine("bullet", runs = listOf(words("a"))), paragraph(words("b", listOf("bold")))))
    built.delete(1, 2)
    Document.settle(built, 1, 1)
    assertEquals(listOf(EditorLine("bullet", runs = listOf(words("a"), words("b", listOf("bold"))))), Document.lines(built))
  }

  @Test
  fun commandsLeaveNoStrayHolder() {
    val linked = text(listOf(EditorLine("bullet")))
    Links.set(linked, 1 until 1, "docs", "https://x.org")
    assertEquals(0, Blocks.holderFix(linked))
    val pasted = text(listOf(EditorLine("quote")))
    Clipboard.insert(pasted, listOf(paragraph(words("x")), EditorLine("bullet")), 1, 1) { it }
    assertEquals("x\n" + Blocks.HOLDER, pasted.toString())
    assertNull(Blocks.holderFix(pasted))
    assertEquals(listOf("paragraph", "bullet"), Document.lines(pasted).map { it.block })
  }

  @Test
  fun indentOutCarriesChildren() {
    val built = text(listOf(
      EditorLine("bullet", runs = listOf(words("a"))), EditorLine("bullet", 1, runs = listOf(words("b"))),
      EditorLine("bullet", 2, runs = listOf(words("c"))), EditorLine("bullet", 1, runs = listOf(words("d"))),
    ))
    Blocks.set(built, Blocks.indent(built, 2, 2, -1))
    assertEquals(listOf(0, 0, 1, 1), Document.lines(built).map { it.depth })
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InputRulesTests {
  @Test
  fun undoLeavesTheMarkersUnmarked() {
    val built = plain("say **hi**")
    val applied = InputRules.apply(built, 10) { 0 }!!
    InputRules.undo(built, applied.rule)
    assertEquals(listOf(paragraph(words("say **hi**"))), Document.lines(built))
    assertEquals(0, Marks.typing(built, 10))
    val link = plain("[docs](https://x.org)")
    val linked = InputRules.apply(link, 21) { 0 }!!
    InputRules.undo(link, linked.rule)
    assertEquals(listOf(paragraph(words("[docs](https://x.org)"))), Document.lines(link))
  }

  @Test
  fun blockMarkerAndItsUndo() {
    val built = plain("- ")
    val applied = InputRules.apply(built, 2) { 9 }
    assertEquals(Blocks.HOLDER, built.toString())
    assertEquals(listOf("bullet"), Document.lines(built).map { it.block })
    assertEquals(1, applied?.caret)
    assertTrue(InputRules.undoes(applied!!.rule, 0, 1, 1, 1))
    assertEquals(2, InputRules.undo(built, applied.rule))
    assertEquals("- ", built.toString())
    assertEquals(listOf("paragraph"), Document.lines(built).map { it.block })
  }

  @Test
  fun markerPairAndLink() {
    val built = plain("say **hi**")
    val applied = InputRules.apply(built, 10) { 0 }
    assertEquals(listOf(paragraph(words("say "), words("hi", listOf("bold")))), Document.lines(built))
    assertEquals(Marks.BOLD, applied?.markOff)
    assertEquals(10, InputRules.undo(built, applied!!.rule))
    assertEquals("say **hi**", built.toString())
    val link = plain("[docs](https://x.org)")
    assertTrue(InputRules.apply(link, 21) { 0 } != null)
    assertEquals(listOf(paragraph(words("docs", href = "https://x.org"))), Document.lines(link))
    assertNull(InputRules.apply(text(listOf(EditorLine("code", runs = listOf(words("**x**"))))), 5) { 0 })
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ClipboardTests {
  @Test
  fun pasteDecides() {
    val built = plain("some words")
    assertEquals(Clipboard.Paste.Link("words", "https://x.org", 5, 10), Clipboard.paste(built, 5, 10, " https://x.org\n"))
    assertEquals(Clipboard.Paste.Ask("a\nb", 5, 5), Clipboard.paste(built, 5, 5, "a\r\nb"))
    assertNull(Clipboard.paste(text(listOf(EditorLine("code", runs = listOf(words("x"))))), 1, 1, "y"))
  }

  @Test
  fun insertJoinsTheLineAndKeepsBlocksInAnEmptyOne() {
    val built = text(listOf(paragraph(words("ab", listOf("bold")))))
    val caret = Clipboard.insert(built, listOf(paragraph(words("x"))), 1, 1) { it }
    assertEquals(2, caret)
    assertEquals(listOf(paragraph(words("axb", listOf("bold")))), Document.lines(built))
    val empty = text(listOf(EditorLine("quote")))
    Clipboard.insert(empty, listOf(EditorLine("code", 0, 3, runs = listOf(words("c"))), paragraph(words("p"))), 1, 1) { it + 100 }
    assertEquals(listOf("code", "paragraph"), Document.lines(empty).map { it.block })
    assertEquals("c\np", empty.toString())
    val quoted = text(listOf(EditorLine("quote", runs = listOf(words("q")))))
    Clipboard.insert(quoted, listOf(paragraph(words("x")), paragraph(words("y"))), 1, 1) { it }
    assertEquals("the first line joins the line pasted into", listOf("quote", "paragraph"), Document.lines(quoted).map { it.block })
  }

  @Test
  fun copy() {
    val built = text(listOf(paragraph(words("ab"), mention(ada)), EditorLine("bullet")))
    assertEquals(listOf(paragraph(words("b"), mention(ada)), EditorLine("bullet", group = 1)), Clipboard.copy(built, 1, built.length))
  }
}
