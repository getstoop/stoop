import Foundation

// Blocks: each line is a paragraph, a quote line, a list item (bulleted
// or numbered, four levels) or a code block's line, held on every
// character of the line, its "\n" included (.editorBlock). Here: the lines
// a selection touches and what the row's buttons do to them, Return and
// Backspace at a block's edge, the markers typed at a line's start, the
// invariants an edit must leave true, and what each block draws.
enum Block: String {
  case paragraph, quote, bullet, ordered, code

  var isList: Bool { self == .bullet || self == .ordered }
}

// A line's block. Equal by value, so the storage keeps one attribute run
// for a line.
final class BlockBox: NSObject {
  let block: Block
  let depth: Int
  let group: Int
  let lang: String?

  init(_ block: Block, depth: Int = 0, group: Int = 0, lang: String? = nil) {
    self.block = block
    self.depth = block.isList ? max(0, min(depth, Blocks.maxDepth)) : 0
    self.group = block == .code ? group : 0
    self.lang = block == .code ? lang : nil
  }

  static let paragraph = BlockBox(.paragraph)

  func with(depth: Int) -> BlockBox { BlockBox(block, depth: depth, group: group, lang: lang) }

  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? BlockBox else { return false }
    return other.block == block && other.depth == depth && other.group == group && other.lang == lang
  }
  override var hash: Int { block.hashValue ^ depth ^ (group << 4) }
}

typealias BlockLine = (range: NSRange, block: BlockBox)

enum Blocks {
  static let maxDepth = 3

  // An empty line at the end of the text has no character to carry its
  // block, so one in a block holds this, and only this: a zero-width
  // space the caret sits after, never shown, never sent. It is put in
  // where a line is made or emptied (a Return at a block's end, a block
  // given to the empty last line, the last line of a block emptied) and
  // taken out wherever it no longer stands alone (`holderFix`).
  static let holder = "\u{200B}"
  static let holderCharacter: unichar = 0x200B

  // MARK: Reading

  // The block of a line: its first character's (a holder not counting
  // when words were put in beside it), a paragraph for the empty last
  // line.
  static func at(_ text: NSAttributedString, line: NSRange) -> BlockBox {
    guard line.length > 0, line.location < text.length else { return .paragraph }
    var index = line.location
    if line.length > 1, isHolderCharacter(text.string as NSString, at: index) { index += 1 }
    return (text.attribute(.editorBlock, at: index, effectiveRange: nil) as? BlockBox) ?? .paragraph
  }

  static func at(_ text: NSAttributedString, lineAt location: Int) -> BlockBox {
    at(text, line: Document.line(text.string as NSString, at: location))
  }

  static func isHolderCharacter(_ string: NSString, at index: Int) -> Bool {
    index >= 0 && index < string.length && string.character(at: index) == holderCharacter
  }

  // A line that is its holder and nothing else.
  static func isHolder(_ text: NSAttributedString, line: NSRange) -> Bool {
    let string = text.string as NSString
    let content = Document.content(string, of: line)
    return content.length == 1 && isHolderCharacter(string, at: content.location)
  }

  // No words on the line (its holder doesn't count).
  static func isEmpty(_ text: NSAttributedString, line: NSRange) -> Bool {
    Document.content(text.string as NSString, of: line).length == 0 || isHolder(text, line: line)
  }

  // The lines a caret or selection touches, each with its block: a caret
  // its own line; a selection every line it reaches, one whose start it
  // ends at included (web's rule); the empty last line as a zero-length
  // range at the end.
  static func lines(_ text: NSAttributedString, touching selection: NSRange) -> [BlockLine] {
    let string = text.string as NSString
    var out: [BlockLine] = []
    Document.forEachLine(string, in: selection) { line, _ in
      if selection.length == 0, !out.isEmpty { return }
      out.append((line, at(text, line: line)))
    }
    return out
  }

  // MARK: Writing

  // A code block holds plain text: marks, links and pills go, the words
  // stay. The one place that rule is written.
  static func stripCode(_ text: NSMutableAttributedString, line: NSRange) {
    let content = Document.content(text.string as NSString, of: line)
    guard content.length > 0 else { return }
    Marks.clear(text, in: content)
    Links.remove(text, in: content)
    Mentions.drop(text, in: content)
  }

  // Each line given a block. The empty last line gets a holder for a
  // block, and loses it for a paragraph.
  static func set(_ text: NSMutableAttributedString, _ lines: [BlockLine]) {
    // Last first, so a holder put in or taken out moves no line before it.
    for (range, block) in lines.sorted(by: { $0.range.location > $1.range.location }) {
      if range.length == 0 {
        if block.block != .paragraph {
          text.replaceCharacters(in: range, with: NSAttributedString(string: holder, attributes: [.editorBlock: block]))
        }
        continue
      }
      if block.block == .paragraph, isHolder(text, line: range) {
        text.replaceCharacters(in: NSRange(location: range.location, length: 1), with: "")
        let rest = NSRange(location: range.location, length: range.length - 1)
        if rest.length > 0 { text.addAttribute(.editorBlock, value: block, range: rest) }
        continue
      }
      text.addAttribute(.editorBlock, value: block, range: range)
      if block.block == .code { stripCode(text, line: range) }
    }
  }

  // Quote or code block on every line the caret or selection touches, or
  // off (back to plain lines) when the first has it already (web decides
  // by where the selection starts). Lines made a code block become one
  // block, `group`.
  static func toggle(_ text: NSAttributedString, selection: NSRange, _ kind: Block, group: Int) -> [BlockLine] {
    let lines = lines(text, touching: selection)
    let on = lines.first?.block.block != kind
    return lines.map { ($0.range, on ? BlockBox(kind, group: group) : .paragraph) }
  }

  // A bulleted or numbered list on every line touched, or off when the
  // first is in that list already. A line already in a list keeps its
  // level.
  static func toggleList(_ text: NSAttributedString, selection: NSRange, _ kind: Block) -> [BlockLine] {
    let lines = lines(text, touching: selection)
    let on = lines.first?.block.block != kind
    return lines.map { line in
      (line.range, on ? BlockBox(kind, depth: line.block.block.isList ? line.block.depth : 0) : .paragraph)
    }
  }

  // The list level of the line before a line, nil when it is no item.
  private static func depthBefore(_ text: NSAttributedString, _ line: NSRange) -> Int? {
    guard line.location > 0 else { return nil }
    let before = at(text, lineAt: line.location - 1)
    return before.block.isList ? before.depth : nil
  }

  // Indent (one level deeper, four at most, and never more than one past
  // the item before) or outdent (one level up; from the top level, out of
  // the list) each list line touched. An outdented item brings the items
  // under it along, as web lifts an item with its children. Empty when
  // no list line is touched.
  static func indent(_ text: NSAttributedString, selection: NSRange, by step: Int) -> [BlockLine] {
    var lines = lines(text, touching: selection).filter { $0.block.block.isList }
    guard !lines.isEmpty else { return [] }
    if step < 0, let last = lines.last {
      let string = text.string as NSString
      var location = NSMaxRange(last.range)
      while location < string.length {
        let line = Document.line(string, at: location)
        let block = at(text, line: line)
        guard block.block.isList, block.depth > last.block.depth else { break }
        lines.append((line, block))
        location = NSMaxRange(line)
      }
    }
    var previous = depthBefore(text, lines[0].range)
    for index in lines.indices {
      let block = lines[index].block
      if step > 0 {
        let deepest = min(maxDepth, (previous ?? -1) + 1)
        lines[index].block = block.with(depth: min(block.depth + 1, max(block.depth, deepest)))
      } else if block.depth > 0 {
        lines[index].block = block.with(depth: block.depth - 1)
      } else {
        lines[index].block = .paragraph
      }
      previous = lines[index].block.block.isList ? lines[index].block.depth : nil
    }
    return lines
  }

  // MARK: Return and Backspace

  // Return on an empty quote line, or on a code block's blank last line,
  // leaves the block: the line becomes plain; on an empty list item it
  // goes up a level, or out of the list from the top. Nil when Return
  // just adds a line.
  static func returnKey(_ text: NSAttributedString, caret: Int) -> [BlockLine]? {
    let line = Document.line(text.string as NSString, at: caret)
    let block = at(text, line: line)
    guard isEmpty(text, line: line) else { return nil }
    switch block.block {
    case .quote: return [(line, .paragraph)]
    case .code: return isLastOfCodeBlock(text, line, block) ? [(line, .paragraph)] : nil
    case .bullet, .ordered: return [(line, block.depth > 0 ? block.with(depth: block.depth - 1) : .paragraph)]
    case .paragraph: return nil
    }
  }

  // What Backspace does at a block's edge, when not just deleting.
  enum BackspaceAction: Equatable {
    // The line made plain: at the start of a quote's first line, of a
    // list item, or of a code block's first line, rather than joining it
    // to the one before.
    case plain([BlockLine])
    // The line taken out: an empty later line of a quote or code block
    // (its holder) joins the line above, as on web.
    case join(NSRange)

    static func == (lhs: BackspaceAction, rhs: BackspaceAction) -> Bool {
      switch (lhs, rhs) {
      case let (.plain(left), .plain(right)):
        return left.count == right.count && zip(left, right).allSatisfy { $0.range == $1.range && $0.block == $1.block }
      case let (.join(left), .join(right)): return left == right
      default: return false
      }
    }
  }

  // Nil when Backspace just deletes.
  static func backspaceKey(_ text: NSAttributedString, caret: Int) -> BackspaceAction? {
    let string = text.string as NSString
    let line = Document.line(string, at: caret)
    let holder = isHolder(text, line: line)
    let atStart = caret == line.location || (holder && caret == line.location + 1)
    guard atStart else { return nil }
    let block = at(text, line: line)
    let before: BlockBox? = line.location > 0 ? at(text, lineAt: line.location - 1) : nil
    let starts: Bool
    switch block.block {
    case .quote: starts = before?.block != .quote
    case .code: starts = !(before?.block == .code && before?.group == block.group)
    case .bullet, .ordered: starts = true
    case .paragraph: starts = false
    }
    if starts { return .plain([(line, .paragraph)]) }
    if holder, line.location > 0 { return .join(NSRange(location: line.location - 1, length: line.length + 1)) }
    return nil
  }

  // What a Return at `caret` puts in when the line is a block's: the
  // newline carrying the block, and a holder after it when the new line
  // is the last. Nil on a paragraph (the text view's own Return will do)
  // or where Return leaves the block (`returnKey`).
  static func newline(_ text: NSAttributedString, caret: Int) -> NSAttributedString? {
    let line = Document.line(text.string as NSString, at: caret)
    let block = at(text, line: line)
    guard block.block != .paragraph else { return nil }
    let last = NSMaxRange(line) >= text.length && caret >= NSMaxRange(Document.content(text.string as NSString, of: line))
    return NSAttributedString(string: last ? "\n" + holder : "\n", attributes: [.editorBlock: block])
  }

  // Whether deleting `range` leaves the last line of a block with no
  // words: the holder then stands in for them, so the line keeps its
  // block (a nested item stays at its level).
  static func emptiesLastBlockLine(_ text: NSAttributedString, deleting range: NSRange) -> Bool {
    let string = text.string as NSString
    let line = Document.line(string, at: range.location)
    let content = Document.content(string, of: line)
    guard line.length == content.length, content.length > 0, !isHolder(text, line: line) else { return false }
    guard range.location <= content.location, NSMaxRange(range) >= NSMaxRange(content), range.location >= line.location else { return false }
    return at(text, line: line).block != .paragraph
  }

  private static func isLastOfCodeBlock(_ text: NSAttributedString, _ line: NSRange, _ block: BlockBox) -> Bool {
    let next = NSMaxRange(line)
    guard next < text.length else { return true }
    let after = at(text, lineAt: next)
    return !(after.block == .code && after.group == block.group)
  }

  // MARK: Typed at a line's start

  // "> " a quote, "- " or "* " a bulleted item, "1. " or "1) " a numbered
  // one, "```" a code block: the whole of a paragraph's text up to the
  // caret.
  static func rule(_ before: String) -> Block? {
    switch before {
    case "> ": return .quote
    case "- ", "* ": return .bullet
    case "```": return .code
    default: return before.range(of: "^\\d{1,9}[.)] $", options: .regularExpression) != nil ? .ordered : nil
    }
  }

  // MARK: Invariants

  // Each line holds one block, its first character's: two lines joined by
  // a backspace become one line of the first's kind, and a code line
  // holds plain text.
  static func normalise(_ text: NSMutableAttributedString, lines range: NSRange) {
    let string = text.string as NSString
    Document.forEachLine(string, in: range) { line, _ in
      guard line.length > 0 else { return }
      let block = at(text, line: line)
      text.addAttribute(.editorBlock, value: block, range: line)
      if block.block == .code { stripCode(text, line: line) }
    }
  }

  // Each list line held to one level deeper than the list line before it
  // at most (0 for a list's first line), as core's linesToDoc reads
  // lines, so what the field draws is what is sent. The lines changed.
  static func normaliseDepths(_ text: NSMutableAttributedString) -> [NSRange] {
    var changed: [NSRange] = []
    var before = -1
    Document.forEachLine(text.string as NSString) { line, _ in
      guard line.length > 0 else { return }
      let block = at(text, line: line)
      guard block.block.isList else {
        before = -1
        return
      }
      let depth = min(block.depth, before + 1)
      if depth != block.depth {
        text.addAttribute(.editorBlock, value: block.with(depth: depth), range: line)
        changed.append(line)
      }
      before = depth
    }
    return changed
  }

  // A holder that no longer stands alone on the last line (words were put
  // beside it, or lines after it): the edit that takes it out, if any.
  static func holderFix(_ text: NSAttributedString) -> NSRange? {
    let string = text.string as NSString
    var fix: NSRange?
    Document.forEachLine(string) { line, content in
      guard fix == nil else { return }
      var index = content.location
      while index < NSMaxRange(content) {
        if isHolderCharacter(string, at: index), content.length > 1 || line.length > content.length {
          fix = NSRange(location: index, length: 1)
          return
        }
        index += 1
      }
    }
    return fix
  }

  // MARK: What a block draws

  // The runs of lines drawn as one: a code block's box, a quote's bar.
  // `blocks` is each line's block, first to last.
  static func runs(_ blocks: [BlockBox]) -> [(kind: Block, first: Int, last: Int)] {
    var out: [(Block, Int, Int)] = []
    var index = 0
    while index < blocks.count {
      let block = blocks[index]
      guard block.block == .code || block.block == .quote else {
        index += 1
        continue
      }
      var end = index + 1
      while end < blocks.count, blocks[end].block == block.block, block.block != .code || blocks[end].group == block.group {
        end += 1
      }
      out.append((block.block, index, end - 1))
      index = end
    }
    return out
  }

  // A list line's marker: a bullet by level (•, ◦, ▪), or the item's
  // number counted among the items before it at its level.
  static func marker(_ blocks: [BlockBox], at index: Int) -> String? {
    let block = blocks[index]
    guard block.block.isList else { return nil }
    if block.block == .bullet { return ["•", "◦", "▪", "•"][min(block.depth, 3)] }
    var number = 1
    var back = index - 1
    while back >= 0, blocks[back].block.isList, blocks[back].depth >= block.depth {
      if blocks[back].depth == block.depth {
        guard blocks[back].block == .ordered else { break }
        number += 1
      }
      back -= 1
    }
    return "\(number)."
  }

  // MARK: Look

  static func look(_ block: BlockBox, into look: inout CharLook) {
    switch block.block {
    case .quote: look.color = .muted
    case .code: look.mono = true
    default: break
    }
  }

  // How far a block's lines are indented, in the style's units.
  struct Metrics {
    var quoteBarWidth: Double
    var quotePadX: Double
    var listIndent: Double
    var prePadX: Double
  }

  static func indent(_ block: BlockBox, _ metrics: Metrics) -> Double {
    switch block.block {
    case .quote: return metrics.quoteBarWidth + metrics.quotePadX
    case .bullet, .ordered: return metrics.listIndent * Double(block.depth + 1)
    case .code: return metrics.prePadX
    case .paragraph: return 0
    }
  }
}
