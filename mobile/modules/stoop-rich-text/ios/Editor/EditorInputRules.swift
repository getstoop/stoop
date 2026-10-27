import Foundation

// Format as you type (web's input rules): after each character typed, the
// shortcut the line's text up to the caret completes, and a backspace
// straight after that puts the markers back as typed. Blocks first ("> ",
// "- ", "1. ", "```" at a paragraph's start), then a link typed in full,
// then a marker pair around words. Never in a code block.
struct TypedRule: Equatable {
  // Where the shortcut's result now is, the text it replaced, and (for a
  // block marker) the block the line had.
  let range: NSRange
  let original: NSAttributedString
  let block: BlockBox?
}

enum InputRules {
  struct Applied {
    let rule: TypedRule
    let caret: Int
    // A mark the words were given, which what is typed next doesn't get.
    let markOff: Marks?
  }

  // The shortcut a character typed at `caret` completes, applied; nil
  // when none. `codeGroup` numbers a code block made here.
  static func apply(_ text: NSMutableAttributedString, caret: Int, codeGroup: () -> Int) -> Applied? {
    let string = text.string as NSString
    guard caret <= string.length else { return nil }
    let line = Document.line(string, at: caret)
    let block = Blocks.at(text, line: line)
    guard block.block != .code else { return nil }
    let before = Document.textBefore(text, at: caret) as NSString
    let start = caret - before.length

    if block.block == .paragraph, let kind = Blocks.rule(before as String) {
      let marker = NSRange(location: line.location, length: before.length)
      let original = text.attributedSubstring(from: marker)
      text.replaceCharacters(in: marker, with: "")
      let made = BlockBox(kind, group: kind == .code ? codeGroup() : 0)
      let now = Document.line(text.string as NSString, at: line.location)
      Blocks.set(text, [(now, made)])
      // The line's holder, if one went in, is the result: a backspace on
      // it puts the marker back.
      let after = Document.line(text.string as NSString, at: line.location)
      let result = Blocks.isHolder(text, line: after) ? NSRange(location: after.location, length: 1) : NSRange(location: after.location, length: 0)
      return Applied(rule: TypedRule(range: result, original: original, block: .paragraph), caret: NSMaxRange(result), markOff: nil)
    }

    if let link = Links.rule(endingIn: before as String) {
      let all = NSRange(location: start + link.all.location, length: link.all.length)
      let words = NSRange(location: start + link.words.location, length: link.words.length)
      let original = text.attributedSubstring(from: all)
      let linked = NSMutableAttributedString(attributedString: text.attributedSubstring(from: words))
      let whole = NSRange(location: 0, length: linked.length)
      Mentions.drop(linked, in: whole)
      linked.addAttribute(.editorHref, value: link.href, range: whole)
      text.replaceCharacters(in: all, with: linked)
      let result = NSRange(location: all.location, length: linked.length)
      return Applied(rule: TypedRule(range: result, original: original, block: nil), caret: NSMaxRange(result), markOff: nil)
    }

    if let rule = Marks.rule(endingIn: before as String) {
      let marked = NSRange(location: start + rule.marked.location, length: rule.marked.length)
      let words = NSRange(location: start + rule.words.location, length: rule.words.length)
      let original = text.attributedSubstring(from: marked)
      let styled = NSMutableAttributedString(attributedString: text.attributedSubstring(from: words))
      Marks.set(styled, in: NSRange(location: 0, length: styled.length)) { $0.union(rule.mark) }
      text.replaceCharacters(in: marked, with: styled)
      let result = NSRange(location: marked.location, length: styled.length)
      return Applied(rule: TypedRule(range: result, original: original, block: nil), caret: NSMaxRange(result), markOff: rule.mark)
    }
    return nil
  }

  // Whether a backspace over `range` is the one that undoes the rule: the
  // character before a caret at the rule's end.
  static func undoes(_ rule: TypedRule, backspaceOver range: NSRange, caret: NSRange) -> Bool {
    caret.length == 0 && caret.location == NSMaxRange(rule.range)
      && (range.length == 1 && NSMaxRange(range) == caret.location || (rule.range.length == 0 && range.length == 0))
  }

  // The markers back as typed. The caret after them.
  static func undo(_ text: NSMutableAttributedString, _ rule: TypedRule) -> Int {
    guard NSMaxRange(rule.range) <= text.length else { return NSMaxRange(rule.range) }
    if let block = rule.block {
      let line = Document.line(text.string as NSString, at: rule.range.location)
      Blocks.set(text, [(line, block)])
      let at = NSRange(location: rule.range.location, length: 0)
      text.replaceCharacters(in: at, with: rule.original)
      let restored = Document.line(text.string as NSString, at: rule.range.location)
      text.addAttribute(.editorBlock, value: block, range: restored)
    } else {
      text.replaceCharacters(in: rule.range, with: rule.original)
    }
    return rule.range.location + rule.original.length
  }
}
