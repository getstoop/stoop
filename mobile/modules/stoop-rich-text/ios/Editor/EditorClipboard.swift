import Foundation

// Paste and copy. Paste reads the clipboard's text as Markdown (JS reads
// it, and hands back lines to put in), so a message's source pastes back
// formatted; an address pasted over selected words links them; in a code
// block the text view's own paste puts it in as it is. Copy and Cut hand
// JS the selection's lines, which puts their Markdown on the clipboard.
enum Clipboard {
  enum Paste: Equatable {
    case link(words: String, href: String, range: NSRange)
    case ask(text: String, range: NSRange)
  }

  // What a paste of `clipboard` over `selection` does; nil for the text
  // view's own paste.
  static func paste(_ text: NSAttributedString, selection: NSRange, clipboard: String) -> Paste? {
    guard !clipboard.isEmpty else { return nil }
    if Blocks.at(text, lineAt: selection.location).block == .code { return nil }
    let plain = clipboard.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let address = plain.trimmingCharacters(in: .whitespacesAndNewlines)
    if selection.length > 0, Links.readable(address) {
      let words = (text.string as NSString).substring(with: selection)
      if !words.contains("\n"), words.range(of: "https?://", options: [.regularExpression, .caseInsensitive]) == nil {
        return .link(words: words, href: address, range: selection)
      }
    }
    return .ask(text: plain, range: selection)
  }

  // The lines in place of `range`: the first joins the line pasted into
  // (which keeps its block, unless it is empty or wholly replaced: then
  // the pasted line keeps its own, as web puts a pasted block in an empty
  // line), the rest keep theirs, and the words after the paste end the
  // last. One line pasted into marked words takes their marks. The caret
  // after what went in. `regroup` numbers each pasted code block.
  static func insert(_ text: NSMutableAttributedString, lines: [EditorLine], at range: NSRange, regroup: (Int) -> Int) -> Int {
    var target = range
    let string = text.string as NSString
    let line = Document.line(string, at: range.location)
    let content = Document.content(string, of: line)
    // Over a holder, in place of it.
    if Blocks.isHolder(text, line: line) { target = NSUnionRange(target, NSRange(location: content.location, length: 1)) }
    let emptyLine = Blocks.isEmpty(text, line: line)
      || (target.location <= content.location && NSMaxRange(target) >= NSMaxRange(content))
    let built = Document.attributed(lines.map { line in
      var copy = line
      if line.block == "code" { copy.group = regroup(line.group) }
      return copy
    })
    let block = Blocks.at(text, line: line)
    if !emptyLine {
      let first = Document.line(built.string as NSString, at: 0)
      if first.length > 0 { built.addAttribute(.editorBlock, value: block, range: first) }
    }
    if lines.count == 1 {
      let marks = Marks.typing(text, at: target.location)
      if !marks.isEmpty { Marks.set(built, in: NSRange(location: 0, length: built.length)) { $0.union(marks) } }
    }
    text.replaceCharacters(in: target, with: built)
    return target.location + built.length
  }

  static func copy(_ text: NSAttributedString, _ range: NSRange) -> [EditorLine] {
    Document.lines(text.attributedSubstring(from: range))
  }
}
