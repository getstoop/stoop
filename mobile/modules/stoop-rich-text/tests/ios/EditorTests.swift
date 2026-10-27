import Foundation
import XCTest
@testable import StoopEditor

// The editor's rules, on the text as the field holds it: a few cases per
// feature, each a behaviour the composer shows (the Maestro flows check
// the same from the outside). Run with `swift test` in the module.

private let ada = EditorMention(kind: "person", id: "u1", handle: "ada")
private let garden = EditorMention(kind: "channel", id: "c1", handle: "garden")

private func text(_ lines: [EditorLine]) -> NSMutableAttributedString { Document.attributed(lines) }
private func paragraph(_ runs: EditorRun...) -> EditorLine { EditorLine(runs: runs) }
private func plain(_ words: String) -> NSMutableAttributedString { text([paragraph(EditorRun(text: words))]) }
private func range(_ location: Int, _ length: Int = 0) -> NSRange { NSRange(location: location, length: length) }

final class DocumentTests: XCTestCase {
  func testLinesRoundTrip() {
    let lines = [
      paragraph(EditorRun(text: "hi "), EditorRun(text: "bold", marks: ["bold"]), EditorRun(text: " "), EditorRun(mention: ada)),
      EditorLine(block: "quote", group: 1, runs: [EditorRun(text: "see ", marks: []), EditorRun(text: "docs", href: "https://x.org")]),
      EditorLine(block: "quote", group: 1, runs: []),
      EditorLine(block: "bullet", depth: 0, group: 2, runs: [EditorRun(text: "one")]),
      EditorLine(block: "ordered", depth: 1, group: 2, runs: [EditorRun(text: "two")]),
      EditorLine(block: "code", group: 3, lang: "js", runs: [EditorRun(text: "x = 1")]),
      EditorLine(block: "code", group: 3, lang: "js", runs: []),
      EditorLine(block: "paragraph", group: 4, runs: [EditorRun(text: "after")]),
      EditorLine(block: "bullet", group: 5, runs: []),
    ]
    let built = text(lines)
    XCTAssertEqual(built.string, "hi bold @ada\nsee docs\n\none\ntwo\nx = 1\n\nafter\n\u{200B}")
    XCTAssertEqual(Document.lines(built), lines)
  }

  func testEmptyAndPlainTexts() {
    XCTAssertEqual(Document.lines(NSAttributedString()), [paragraph()])
    XCTAssertEqual(Document.lines(plain("a\n")), [paragraph(EditorRun(text: "a")), EditorLine(group: 1)])
  }

  func testCodeKeepsOnlyWords() {
    let built = text([EditorLine(block: "code", runs: [EditorRun(text: "a", marks: ["bold"]), EditorRun(mention: ada)])])
    XCTAssertEqual(Document.lines(built), [EditorLine(block: "code", runs: [EditorRun(text: "a@ada")])])
  }

  func testActiveFormats() {
    let built = text([
      paragraph(EditorRun(text: "ab", marks: ["bold"]), EditorRun(text: "cd", marks: ["bold", "italic"], href: "https://x.org")),
      EditorLine(block: "ordered", runs: [EditorRun(text: "e")]),
    ])
    XCTAssertEqual(Document.activeFormats(built, selection: range(2), caretMarks: nil), ["bold"])
    XCTAssertEqual(Document.activeFormats(built, selection: range(3), caretMarks: nil), ["bold", "italic", "link"])
    XCTAssertEqual(Document.activeFormats(built, selection: range(0, 4), caretMarks: nil), ["bold"])
    XCTAssertEqual(Document.activeFormats(built, selection: range(0), caretMarks: [.strike]), ["strike"])
    XCTAssertEqual(Document.activeFormats(built, selection: range(6), caretMarks: nil), ["orderedList"])
  }

  func testTextBeforeMasksPillsAndSkipsHolder() {
    let built = text([paragraph(EditorRun(text: "hi "), EditorRun(mention: ada), EditorRun(text: " @b")), EditorLine(block: "bullet", runs: [])])
    XCTAssertEqual(Document.textBefore(built, at: 10), "hi \u{FFFC}\u{FFFC}\u{FFFC}\u{FFFC} @b")
    XCTAssertEqual(Document.textBefore(built, at: built.length), "")
  }
}

final class MarksTests: XCTestCase {
  func testTypingCarriesTheMarkBefore() {
    let built = text([paragraph(EditorRun(text: "ab", marks: ["bold"]), EditorRun(text: "c"))])
    XCTAssertEqual(Marks.typing(built, at: 2), [.bold])
    XCTAssertEqual(Marks.typing(built, at: 3), [])
    XCTAssertEqual(Marks.typing(built, at: 0), [])
    let code = text([EditorLine(block: "code", runs: [EditorRun(text: "x")])])
    XCTAssertEqual(Marks.typing(code, at: 1), [])
  }

  func testToggleFollowsWebsRule() {
    let pill = text([paragraph(EditorRun(text: "a "), EditorRun(mention: ada))])
    Marks.toggle(pill, .code, in: range(0, 6))
    XCTAssertEqual(Document.lines(pill), [paragraph(EditorRun(text: "a @ada", marks: ["code"]))], "inline code holds no pill")
    let built = text([paragraph(EditorRun(text: "ab", marks: ["bold"]), EditorRun(text: "cd"))])
    XCTAssertTrue(Marks.toggle(built, .bold, in: range(0, 4)))
    XCTAssertEqual(Marks.common(built, in: range(0, 4)), [.bold])
    XCTAssertFalse(Marks.toggle(built, .bold, in: range(0, 4)))
    XCTAssertEqual(Marks.common(built, in: range(0, 4)), [])
  }

  func testMarkableSkipsCodeLinesAndNewlines() {
    let built = text([paragraph(EditorRun(text: "ab")), EditorLine(block: "code", runs: [EditorRun(text: "cd")]), paragraph(EditorRun(text: "ef"))])
    XCTAssertEqual(Marks.markable(built, in: range(0, built.length)), [range(0, 2), range(6, 2)])
    XCTAssertTrue(Marks.markable(built, in: range(3, 2)).isEmpty)
  }

  func testRules() {
    XCTAssertEqual(Marks.rule(endingIn: "say **hi**"), Marks.Rule(marked: range(4, 6), words: range(6, 2), mark: .bold))
    XCTAssertEqual(Marks.rule(endingIn: "*it*")?.mark, .italic)
    XCTAssertEqual(Marks.rule(endingIn: "a `x`")?.mark, .code)
    XCTAssertEqual(Marks.rule(endingIn: "||s||")?.mark, .spoiler)
    XCTAssertNil(Marks.rule(endingIn: "**hi"))
    XCTAssertNil(Marks.rule(endingIn: "** hi **"))
    XCTAssertNil(Marks.rule(endingIn: "a**b**"))
  }
}

final class LinksTests: XCTestCase {
  let built = text([paragraph(EditorRun(text: "see "), EditorRun(text: "the ", href: "https://x.org"), EditorRun(text: "docs", marks: ["bold"], href: "https://x.org"), EditorRun(text: " now"))])

  func testAroundCaretAndSelection() {
    XCTAssertEqual(Links.around(built, selection: range(6))?.range, range(4, 8))
    XCTAssertNil(Links.around(built, selection: range(4)), "at the start is outside")
    XCTAssertNil(Links.around(built, selection: range(12)), "at the end is outside")
    XCTAssertEqual(Links.around(built, selection: range(5, 3))?.href, "https://x.org")
    XCTAssertNil(Links.around(built, selection: range(5, 10)), "running out of it")
    XCTAssertNil(Links.typing(built, at: 12))
    XCTAssertEqual(Links.typing(built, at: 8), "https://x.org")
  }

  func testDraftAndSet() {
    XCTAssertEqual(Links.draft(built, selection: range(6)), Links.Draft(range: range(4, 8), text: "the docs", href: "https://x.org", editing: true))
    XCTAssertEqual(Links.draft(built, selection: range(13, 3)), Links.Draft(range: range(13, 3), text: "now", href: "", editing: false))
    let fresh = plain("plain words")
    let target = Links.set(fresh, in: range(6, 5), words: "", href: " https://y.org ")
    XCTAssertEqual(target, range(6, 13))
    XCTAssertEqual(Document.lines(fresh), [paragraph(EditorRun(text: "plain "), EditorRun(text: "https://y.org", href: "https://y.org"))])
    Links.remove(fresh, in: target)
    XCTAssertEqual(Document.lines(fresh), [paragraph(EditorRun(text: "plain https://y.org"))])
  }

  func testSetDropsPillsAndKeepsMarks() {
    let words = text([paragraph(EditorRun(text: "ab", marks: ["bold"]), EditorRun(mention: ada))])
    Links.set(words, in: range(0, 6), words: "ab@ada", href: "https://x.org")
    XCTAssertEqual(Document.lines(words), [paragraph(EditorRun(text: "ab", marks: ["bold"], href: "https://x.org"), EditorRun(text: "@ada", href: "https://x.org"))])
  }

  func testReadableAndBareAddresses() {
    XCTAssertTrue(Links.readable("https://x.org/a_(b)"))
    XCTAssertFalse(Links.readable("https://x.org/a)b"))
    XCTAssertFalse(Links.readable("x.org"))
    let bare = text([paragraph(EditorRun(text: "go https://x.org/a). "), EditorRun(text: "https://in.code", marks: ["code"]))])
    XCTAssertEqual(Links.bareAddresses(bare, in: range(0, bare.length)), [range(3, 15)])
  }

  func testRule() {
    XCTAssertEqual(Links.rule(endingIn: "see [docs](https://x.org/a)"), Links.Rule(all: range(4, 23), words: range(5, 4), href: "https://x.org/a"))
    XCTAssertNil(Links.rule(endingIn: "[docs](x.org)"))
  }
}

final class MentionsTests: XCTestCase {
  let built = text([paragraph(EditorRun(text: "hi "), EditorRun(mention: ada), EditorRun(text: " "), EditorRun(mention: ada))])

  func testOneUnit() {
    XCTAssertEqual(Mentions.pill(built, around: 5), range(3, 4))
    XCTAssertNil(Mentions.pill(built, around: 3))
    XCTAssertNil(Mentions.pill(built, around: 7))
    XCTAssertEqual(Mentions.whole(built, range(5)), range(7))
    XCTAssertEqual(Mentions.whole(built, range(2, 3)), range(2, 5))
    XCTAssertEqual(Mentions.whole(built, range(5, 5)), range(3, 9))
    XCTAssertTrue(Mentions.isWholePill(built, range(3, 4)))
    XCTAssertFalse(Mentions.isWholePill(built, range(3, 3)))
  }

  func testEdgeFollowsTheMove() {
    XCTAssertEqual(Mentions.edge(built, at: 5, was: 7), 3, "stepped left from the end")
    XCTAssertEqual(Mentions.edge(built, at: 5, was: 2), 7, "stepped right from before")
    XCTAssertEqual(Mentions.edge(built, at: 4, was: 20), 3, "a tap goes to the nearer edge")
    XCTAssertEqual(Mentions.edge(built, at: 1, was: 7), 1)
  }

  func testBrokenPillsBecomeWords() {
    built.replaceCharacters(in: range(5, 1), with: "")
    Mentions.dropBroken(built, in: range(0, built.length))
    XCTAssertEqual(Document.lines(built), [paragraph(EditorRun(text: "hi @aa "), EditorRun(mention: ada))])
  }

  func testMakeUnlinks() {
    let words = text([paragraph(EditorRun(text: "@ada", href: "https://x.org"))])
    Mentions.make(words, in: range(0, 4), ada)
    XCTAssertEqual(Document.lines(words), [paragraph(EditorRun(mention: ada))])
  }
}

final class BlocksTests: XCTestCase {
  func testTouchedLinesAndToggle() {
    let built = text([paragraph(EditorRun(text: "a")), paragraph(EditorRun(text: "b")), paragraph(EditorRun(text: "c"))])
    XCTAssertEqual(Blocks.lines(built, touching: range(0, 2)).map(\.range), [range(0, 2), range(2, 2)], "a selection ending at a line's start takes it")
    XCTAssertEqual(Blocks.lines(built, touching: range(3)).map(\.range), [range(2, 2)])
    Blocks.set(built, Blocks.toggle(built, selection: range(0, 3), .quote, group: 0))
    XCTAssertEqual(Document.lines(built).map(\.block), ["quote", "quote", "paragraph"])
    XCTAssertEqual(Blocks.toggle(built, selection: range(0), .quote, group: 0).map(\.block), [.paragraph], "off when the first line has it")
  }

  func testCodeBlockHoldsPlainText() {
    let built = text([paragraph(EditorRun(text: "a", marks: ["bold"]), EditorRun(mention: ada), EditorRun(text: "b", href: "https://x.org"))])
    Blocks.set(built, Blocks.toggle(built, selection: range(0), .code, group: 7))
    XCTAssertEqual(Document.lines(built), [EditorLine(block: "code", runs: [EditorRun(text: "a@adab")])])
  }

  func testListsIndentAndNormalise() {
    let built = text([paragraph(EditorRun(text: "a")), paragraph(EditorRun(text: "b")), paragraph(EditorRun(text: "c"))])
    Blocks.set(built, Blocks.toggleList(built, selection: range(0, built.length), .bullet))
    Blocks.set(built, Blocks.indent(built, selection: range(2), by: 1))
    Blocks.set(built, Blocks.indent(built, selection: range(4), by: 1))
    Blocks.set(built, Blocks.indent(built, selection: range(4), by: 1))
    XCTAssertEqual(Document.lines(built).map(\.depth), [0, 1, 2])
    XCTAssertTrue(Blocks.indent(built, selection: range(0), by: 1).map(\.block.depth) == [0], "never deeper than one past the item before")
    // Outdenting the middle item brings the one under it along.
    Blocks.set(built, Blocks.indent(built, selection: range(2), by: -1))
    XCTAssertEqual(Document.lines(built).map(\.depth), [0, 0, 1])
    Blocks.set(built, Blocks.indent(built, selection: range(0), by: -1))
    XCTAssertEqual(Document.lines(built).map(\.block), ["paragraph", "bullet", "bullet"])
    XCTAssertEqual(Document.lines(built).map(\.depth), [0, 0, 1], "a list's first line is held to level 0 as it is read")
  }

  func testHolderStandsForAnEmptyLastLine() {
    let built = plain("")
    Blocks.set(built, Blocks.toggleList(built, selection: range(0), .bullet))
    XCTAssertEqual(built.string, Blocks.holder)
    XCTAssertEqual(Document.lines(built), [EditorLine(block: "bullet")])
    XCTAssertTrue(Blocks.isEmpty(built, line: range(0, 1)))
    built.replaceCharacters(in: range(1), with: NSAttributedString(string: "x", attributes: [.editorBlock: BlockBox(.bullet)]))
    XCTAssertEqual(Blocks.holderFix(built), range(0, 1), "words beside it send it away")
    built.replaceCharacters(in: Blocks.holderFix(built)!, with: "")
    XCTAssertEqual(built.string, "x")
    XCTAssertNil(Blocks.holderFix(built))
    // A Return at a block's end carries the block, and a holder after it
    // when the new line is the last.
    let quote = text([EditorLine(block: "quote", runs: [EditorRun(text: "q")])])
    let newline = Blocks.newline(quote, caret: 1)
    XCTAssertEqual(newline?.string, "\n" + Blocks.holder)
    XCTAssertEqual(Blocks.newline(text([EditorLine(block: "quote", runs: [EditorRun(text: "q")]), paragraph(EditorRun(text: "p"))]), caret: 1)?.string, "\n")
    XCTAssertNil(Blocks.newline(plain("p"), caret: 1))
    // The holder is never put in from the line before: an empty last line
    // after a list the Return left stays plain.
    let left = text([EditorLine(block: "bullet", runs: [EditorRun(text: "i")]), EditorLine(block: "bullet", runs: [])])
    Blocks.set(left, Blocks.returnKey(left, caret: 3)!)
    XCTAssertEqual(left.string, "i\n")
    XCTAssertNil(Blocks.holderFix(left))
    XCTAssertEqual(Document.lines(left).map(\.block), ["bullet", "paragraph"])
  }

  func testReturnAndBackspaceAtAnEdge() {
    let built = text([
      EditorLine(block: "quote", runs: [EditorRun(text: "q")]), EditorLine(block: "quote", runs: []),
      EditorLine(block: "bullet", depth: 1, runs: [EditorRun(text: "i")]), EditorLine(block: "bullet", depth: 1, runs: []),
    ])
    // "q\n" + "\n" + "i\n" + holder
    XCTAssertNil(Blocks.returnKey(built, caret: 1), "a Return in words adds a line")
    XCTAssertEqual(Blocks.returnKey(built, caret: 2)?.map(\.block.block), [.paragraph], "on an empty quote line, out")
    XCTAssertEqual(Blocks.returnKey(built, caret: 6)?.map(\.block.depth), [0], "on an empty nested item, up a level")
    XCTAssertEqual(Blocks.backspaceKey(built, caret: 0), .plain([(range(0, 2), .paragraph)]), "the first quote line leaves the quote")
    XCTAssertNil(Blocks.backspaceKey(built, caret: 2), "a later quote line joins the one above by the newline going")
    XCTAssertEqual(Blocks.backspaceKey(built, caret: 6), .plain([(range(5, 1), .paragraph)]), "an item's holder counts as its start")
    XCTAssertNil(Blocks.backspaceKey(built, caret: 4), "not at a line's start")
    let code = text([EditorLine(block: "code", group: 1, runs: [EditorRun(text: "a")]), EditorLine(block: "code", group: 1, runs: [])])
    XCTAssertEqual(Blocks.returnKey(code, caret: 2)?.map(\.block.block), [.paragraph], "the blank last code line leaves the block")
    XCTAssertEqual(Blocks.backspaceKey(code, caret: 3), .join(range(1, 2)), "a code block's empty later line joins the one above")
    let words = text([EditorLine(block: "quote", runs: [EditorRun(text: "q")]), EditorLine(block: "quote", runs: [EditorRun(text: "w")])])
    XCTAssertNil(Blocks.backspaceKey(words, caret: 2), "a later line with words just deletes the newline")
  }

  func testEmptiedLastLineKeepsItsBlock() {
    let built = text([EditorLine(block: "bullet", runs: [EditorRun(text: "a")]), EditorLine(block: "bullet", depth: 1, runs: [EditorRun(text: "bc")])])
    XCTAssertTrue(Blocks.emptiesLastBlockLine(built, deleting: range(2, 2)))
    XCTAssertFalse(Blocks.emptiesLastBlockLine(built, deleting: range(3, 1)), "a backspace at the end leaves a word")
    XCTAssertFalse(Blocks.emptiesLastBlockLine(built, deleting: range(1, 3)), "a deletion joining the lines keeps the first's words")
    XCTAssertFalse(Blocks.emptiesLastBlockLine(plain("ab"), deleting: range(0, 2)), "a paragraph needs no holder")
  }

  func testCodeBlockIsTheOnePlaceWordsAreStripped() {
    let built = text([paragraph(EditorRun(text: "a", marks: ["bold"]), EditorRun(mention: ada), EditorRun(text: "b", href: "https://x.org"))])
    built.addAttribute(.editorBlock, value: BlockBox(.code, group: 2), range: range(0, built.length))
    Document.settle(built, edited: range(0, built.length))
    XCTAssertEqual(Document.lines(built), [EditorLine(block: "code", runs: [EditorRun(text: "a@adab")])])
  }

  func testRulesAndDrawing() {
    XCTAssertEqual(Blocks.rule("- "), .bullet)
    XCTAssertEqual(Blocks.rule("12) "), .ordered)
    XCTAssertEqual(Blocks.rule("```"), .code)
    XCTAssertNil(Blocks.rule("-"))
    let blocks = [BlockBox(.ordered), BlockBox(.bullet, depth: 1), BlockBox(.ordered), BlockBox(.code, group: 1), BlockBox(.code, group: 1), BlockBox(.code, group: 2)]
    XCTAssertEqual(blocks.indices.map { Blocks.marker(blocks, at: $0) }, ["1.", "◦", "2.", nil, nil, nil])
    XCTAssertEqual(Blocks.runs(blocks).map { [$0.first, $0.last] }, [[3, 4], [5, 5]])
  }
}

final class SettleTests: XCTestCase {
  func testJoinedLinesTakeTheFirstsBlock() {
    let built = text([EditorLine(block: "bullet", runs: [EditorRun(text: "a")]), paragraph(EditorRun(text: "b", marks: ["bold"]))])
    built.replaceCharacters(in: range(1, 1), with: "")
    Document.settle(built, edited: range(1))
    XCTAssertEqual(Document.lines(built), [EditorLine(block: "bullet", runs: [EditorRun(text: "a"), EditorRun(text: "b", marks: ["bold"])])])
  }

  func testCommandsLeaveNoStrayHolder() {
    // A link saved on a holder line, and lines pasted over one.
    let linked = text([EditorLine(block: "bullet", runs: [])])
    Links.set(linked, in: range(1), words: "docs", href: "https://x.org")
    XCTAssertEqual(Blocks.holderFix(linked), range(0, 1))
    let pasted = text([EditorLine(block: "quote", runs: [])])
    Clipboard.insert(pasted, lines: [paragraph(EditorRun(text: "x")), EditorLine(block: "bullet", runs: [])], at: range(1), regroup: { $0 })
    XCTAssertEqual(pasted.string, "x\n" + Blocks.holder)
    XCTAssertNil(Blocks.holderFix(pasted))
    XCTAssertEqual(Document.lines(pasted).map(\.block), ["paragraph", "bullet"])
  }

  func testIndentOutCarriesChildren() {
    let built = text([
      EditorLine(block: "bullet", runs: [EditorRun(text: "a")]), EditorLine(block: "bullet", depth: 1, runs: [EditorRun(text: "b")]),
      EditorLine(block: "bullet", depth: 2, runs: [EditorRun(text: "c")]), EditorLine(block: "bullet", depth: 1, runs: [EditorRun(text: "d")]),
    ])
    Blocks.set(built, Blocks.indent(built, selection: range(2), by: -1))
    XCTAssertEqual(Document.lines(built).map(\.depth), [0, 0, 1, 1])
    XCTAssertEqual(Document.activeFormats(text([EditorLine(block: "code", runs: [EditorRun(text: "x")]), paragraph(EditorRun(text: "y", marks: ["bold"]))]), selection: range(0, 3), caretMarks: nil), ["bold", "codeblock"], "a selection running out of a code block can take a mark")
  }
}

final class InputRulesTests: XCTestCase {
  func testBlockMarkerAndItsUndo() {
    let built = plain("- ")
    let applied = InputRules.apply(built, caret: 2, codeGroup: { 9 })
    XCTAssertEqual(built.string, Blocks.holder)
    XCTAssertEqual(Document.lines(built).map(\.block), ["bullet"])
    XCTAssertEqual(applied?.caret, 1)
    XCTAssertTrue(InputRules.undoes(applied!.rule, backspaceOver: range(0, 1), caret: range(1)))
    XCTAssertEqual(InputRules.undo(built, applied!.rule), 2)
    XCTAssertEqual(built.string, "- ")
    XCTAssertEqual(Document.lines(built).map(\.block), ["paragraph"])
  }

  func testMarkerPairAndLink() {
    let built = plain("say **hi**")
    let applied = InputRules.apply(built, caret: 10, codeGroup: { 0 })
    XCTAssertEqual(Document.lines(built), [paragraph(EditorRun(text: "say "), EditorRun(text: "hi", marks: ["bold"]))])
    XCTAssertEqual(applied?.markOff, .bold)
    XCTAssertEqual(InputRules.undo(built, applied!.rule), 10)
    XCTAssertEqual(built.string, "say **hi**")
    let link = plain("[docs](https://x.org)")
    XCTAssertNotNil(InputRules.apply(link, caret: 21, codeGroup: { 0 }))
    XCTAssertEqual(Document.lines(link), [paragraph(EditorRun(text: "docs", href: "https://x.org"))])
    XCTAssertNil(InputRules.apply(text([EditorLine(block: "code", runs: [EditorRun(text: "**x**")])]), caret: 5, codeGroup: { 0 }))
  }
}

final class ClipboardTests: XCTestCase {
  func testPasteDecides() {
    let built = plain("some words")
    XCTAssertEqual(Clipboard.paste(built, selection: range(5, 5), clipboard: " https://x.org\n"), .link(words: "words", href: "https://x.org", range: range(5, 5)))
    XCTAssertEqual(Clipboard.paste(built, selection: range(5), clipboard: "a\r\nb"), .ask(text: "a\nb", range: range(5)))
    XCTAssertNil(Clipboard.paste(text([EditorLine(block: "code", runs: [EditorRun(text: "x")])]), selection: range(1), clipboard: "y"))
  }

  func testInsertJoinsTheLineAndKeepsBlocksInAnEmptyOne() {
    let built = text([paragraph(EditorRun(text: "ab", marks: ["bold"]))])
    let caret = Clipboard.insert(built, lines: [paragraph(EditorRun(text: "x"))], at: range(1), regroup: { $0 })
    XCTAssertEqual(caret, 2)
    XCTAssertEqual(Document.lines(built), [paragraph(EditorRun(text: "axb", marks: ["bold"]))])
    let empty = text([EditorLine(block: "quote", runs: [])])
    Clipboard.insert(empty, lines: [EditorLine(block: "code", group: 3, runs: [EditorRun(text: "c")]), paragraph(EditorRun(text: "p"))], at: range(1), regroup: { $0 + 100 })
    XCTAssertEqual(Document.lines(empty).map(\.block), ["code", "paragraph"])
    XCTAssertEqual(empty.string, "c\np")
    let quoted = text([EditorLine(block: "quote", runs: [EditorRun(text: "q")])])
    Clipboard.insert(quoted, lines: [paragraph(EditorRun(text: "x")), paragraph(EditorRun(text: "y"))], at: range(1), regroup: { $0 })
    XCTAssertEqual(Document.lines(quoted).map(\.block), ["quote", "paragraph"], "the first line joins the line pasted into")
  }

  func testCopy() {
    let built = text([paragraph(EditorRun(text: "ab"), EditorRun(mention: ada)), EditorLine(block: "bullet", runs: [])])
    XCTAssertEqual(Clipboard.copy(built, range(1, built.length - 1)), [paragraph(EditorRun(text: "b"), EditorRun(mention: ada)), EditorLine(block: "bullet", group: 1)])
  }
}
