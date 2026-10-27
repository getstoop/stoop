import Foundation

// Links: an address held on each character of the words it links
// (.editorHref). The link around a caret or selection, what the link
// dialog opens with and what its Save and Remove do, an address the
// format reads back whole, bare addresses that only look like links, and
// "[words](https://…)" typed in full.
enum Links {
  static func at(_ text: NSAttributedString, _ index: Int) -> String? {
    guard index >= 0, index < text.length else { return nil }
    return text.attribute(.editorHref, at: index, effectiveRange: nil) as? String
  }

  // The whole link a caret is in (not at its edges: typing there isn't
  // linked), or a selection lies inside: every neighbouring character
  // with the same address, so a link partly bold is one link.
  static func around(_ text: NSAttributedString, selection: NSRange) -> (range: NSRange, href: String)? {
    let at = selection.length == 0 ? selection.location - 1 : selection.location
    guard let href = self.at(text, at) else { return nil }
    if selection.length == 0, self.at(text, selection.location) != href { return nil }
    var start = at
    while start > 0, self.at(text, start - 1) == href { start -= 1 }
    var end = at + 1
    while end < text.length, self.at(text, end) == href { end += 1 }
    guard NSMaxRange(selection) <= end else { return nil }
    return (NSRange(location: start, length: end - start), href)
  }

  // What typing at a position carries: the address, only inside a link.
  static func typing(_ text: NSAttributedString, at location: Int) -> String? {
    guard let href = at(text, location - 1), at(text, location) == href else { return nil }
    return href
  }

  // What the link dialog opens with (web's linkDraft): the link being
  // edited, else the selected words on one line, else nothing at the
  // caret (or, across lines, at the end of the last). Nil in a code
  // block, which holds no links. The range is where Save lands.
  struct Draft: Equatable {
    let range: NSRange
    let text: String
    let href: String
    let editing: Bool
  }

  static func draft(_ text: NSAttributedString, selection: NSRange) -> Draft? {
    let string = text.string as NSString
    let line = Document.line(string, at: selection.location)
    let endLine = Document.line(string, at: NSMaxRange(selection))
    if Blocks.at(text, line: line).block == .code || Blocks.at(text, line: endLine).block == .code { return nil }
    if let link = around(text, selection: selection) {
      return Draft(range: link.range, text: string.substring(with: link.range), href: link.href, editing: true)
    }
    let onOneLine = NSMaxRange(selection) <= NSMaxRange(Document.content(string, of: line))
    let range = onOneLine ? selection : NSRange(location: NSMaxRange(selection), length: 0)
    return Draft(range: range, text: string.substring(with: range), href: "", editing: false)
  }

  // The dialog's Save: the words linked to the address, over `range`.
  // Words unchanged keep their own marks; new words take those where they
  // start. A pill in the words becomes its words (a mention is never
  // linked). The range the link now holds.
  @discardableResult
  static func set(_ text: NSMutableAttributedString, in range: NSRange, words: String, href: String) -> NSRange {
    let address = href.trimmingCharacters(in: .whitespacesAndNewlines)
    var linked = words.trimmingCharacters(in: .whitespacesAndNewlines)
    if linked.isEmpty { linked = address }
    var target = range
    let string = text.string as NSString
    if string.substring(with: range) != linked {
      let block = Blocks.at(text, line: Document.line(string, at: range.location))
      var attrs: [NSAttributedString.Key: Any] = [.editorBlock: block]
      let marks = Marks.typing(text, at: range.location)
      if !marks.isEmpty { attrs[.editorMarks] = marks.rawValue }
      text.replaceCharacters(in: range, with: NSAttributedString(string: linked, attributes: attrs))
      target = NSRange(location: range.location, length: (linked as NSString).length)
    }
    Mentions.drop(text, in: target)
    text.addAttribute(.editorHref, value: address, range: target)
    return target
  }

  // The dialog's Remove: the words stay, unlinked.
  static func remove(_ text: NSMutableAttributedString, in range: NSRange) {
    text.removeAttribute(.editorHref, range: range)
  }

  // An address the message format reads back whole: http(s), no space or
  // "<", every ")" closing a "(" (core readableAddress).
  static func readable(_ href: String) -> Bool {
    guard href.range(of: "^https?://[^\\s<]+$", options: [.regularExpression, .caseInsensitive]) != nil else { return false }
    var depth = 0
    for character in href {
      if character == "(" { depth += 1 }
      if character == ")" {
        depth -= 1
        if depth < 0 { return false }
      }
    }
    return depth == 0
  }

  // MARK: Bare addresses

  // A bare address stays text (the message format links it on its own)
  // and only looks like a link. Trailing punctuation belongs to the
  // sentence, as the parser reads it. The addresses in a range that are
  // plain words: not linked, not a pill, not code.
  private static let address = try! NSRegularExpression(pattern: "https?://[^\\s<>]+", options: [.caseInsensitive])
  private static let trailing = CharacterSet(charactersIn: ".,;:!?)]'\"")

  static func bareAddresses(_ text: NSAttributedString, in range: NSRange) -> [NSRange] {
    let string = text.string as NSString
    var out: [NSRange] = []
    for match in address.matches(in: text.string, range: range) {
      var found = match.range
      while found.length > 0, let scalar = UnicodeScalar(string.character(at: NSMaxRange(found) - 1)), trailing.contains(scalar) {
        found.length -= 1
      }
      guard found.length > 0 else { continue }
      var plain = true
      text.enumerateAttributes(in: found) { _, part, stop in
        if at(text, part.location) != nil || Mentions.at(text, part.location) != nil || Marks.at(text, part.location).contains(.code) {
          plain = false
          stop.pointee = true
        }
      }
      if plain { out.append(found) }
    }
    return out
  }

  // MARK: Typed in full

  // "[words](https://address)" once its ")" is typed, at the end of the
  // line's text up to the caret.
  private static let rule = try! NSRegularExpression(pattern: "\\[([^\\[\\]]+)\\]\\((https?://[^\\s()]+)\\)$")

  struct Rule: Equatable {
    // In `before`: the whole, and the words.
    let all: NSRange
    let words: NSRange
    let href: String
  }

  static func rule(endingIn before: String) -> Rule? {
    let whole = NSRange(location: 0, length: (before as NSString).length)
    guard let match = rule.firstMatch(in: before, range: whole) else { return nil }
    return Rule(all: match.range, words: match.range(at: 1), href: (before as NSString).substring(with: match.range(at: 2)))
  }

  // MARK: Look

  static func look(into look: inout CharLook) {
    look.color = .accent
    look.underline = true
  }
}
