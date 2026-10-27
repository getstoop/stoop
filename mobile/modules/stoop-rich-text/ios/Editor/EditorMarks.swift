import Foundation

// The inline marks: bold, italic, underline, strike, inline code and
// spoiler, held on each character as bits (.editorMarks). What they mean
// to typing, to a toggle and to a shortcut typed around words is here;
// how each looks is in `look`, which the styler draws.
struct Marks: OptionSet, Hashable {
  let rawValue: Int
  static let bold = Marks(rawValue: 1)
  static let italic = Marks(rawValue: 2)
  static let underline = Marks(rawValue: 4)
  static let strike = Marks(rawValue: 8)
  static let code = Marks(rawValue: 16)
  static let spoiler = Marks(rawValue: 32)

  // In core's order (EditorMark), which is the toolbar's.
  static let named: [(String, Marks)] = [
    ("bold", .bold), ("italic", .italic), ("underline", .underline),
    ("strike", .strike), ("code", .code), ("spoiler", .spoiler),
  ]

  init(rawValue: Int) { self.rawValue = rawValue }

  init(names: [String]) {
    var marks: Marks = []
    for (name, mark) in Marks.named where names.contains(name) { marks.insert(mark) }
    self = marks
  }

  static func named(_ name: String) -> Marks? { named.first { $0.0 == name }?.1 }

  var names: [String] { Marks.named.filter { contains($0.1) }.map(\.0) }

  // MARK: Reading

  static func at(_ text: NSAttributedString, _ index: Int) -> Marks {
    guard index >= 0, index < text.length else { return [] }
    return Marks(rawValue: (text.attribute(.editorMarks, at: index, effectiveRange: nil) as? Int) ?? 0)
  }

  // What typing at a position carries: the marks of the character before
  // it on its line (typing at the end of bold words goes on in bold; a
  // pill's marks go on too, the pill itself never does), none at a
  // line's start or in a code block.
  static func typing(_ text: NSAttributedString, at location: Int) -> Marks {
    let string = text.string as NSString
    let at = max(0, min(location, string.length))
    guard at > 0, string.character(at: at - 1) != Document.newline else { return [] }
    if Blocks.at(text, line: Document.line(string, at: at)).block == .code { return [] }
    if Blocks.isHolderCharacter(string, at: at - 1) { return [] }
    return self.at(text, at - 1)
  }

  // The parts of a range a mark can go on: words, not newlines, and not
  // a code block's.
  static func markable(_ text: NSAttributedString, in range: NSRange) -> [NSRange] {
    let string = text.string as NSString
    var out: [NSRange] = []
    Document.forEachLine(string, in: range) { line, content in
      let part = NSIntersectionRange(content, range)
      guard part.length > 0, Blocks.at(text, line: line).block != .code else { return }
      if Blocks.isHolder(text, line: line) { return }
      out.append(part)
    }
    return out
  }

  // The marks every markable character of a range has.
  static func common(_ text: NSAttributedString, in range: NSRange) -> Marks {
    var common: Marks?
    for part in markable(text, in: range) {
      text.enumerateAttribute(.editorMarks, in: part) { value, _, _ in
        let marks = Marks(rawValue: (value as? Int) ?? 0)
        common = common.map { $0.intersection(marks) } ?? marks
      }
    }
    return common ?? []
  }

  // MARK: Writing

  // Each markable character's marks changed by `change`. Inline code
  // holds no pill: a pill given code becomes its words.
  static func set(_ text: NSMutableAttributedString, in range: NSRange, _ change: (Marks) -> Marks) {
    for part in markable(text, in: range) {
      text.enumerateAttribute(.editorMarks, in: part) { value, run, _ in
        let marks = change(Marks(rawValue: (value as? Int) ?? 0))
        if marks.isEmpty {
          text.removeAttribute(.editorMarks, range: run)
        } else {
          text.addAttribute(.editorMarks, value: marks.rawValue, range: run)
        }
        if marks.contains(.code) { Mentions.drop(text, in: run) }
      }
    }
  }

  // Every mark off, whatever the block (a line made a code block).
  static func clear(_ text: NSMutableAttributedString, in range: NSRange) {
    text.removeAttribute(.editorMarks, range: range)
  }

  // A mark over a selection: on everywhere, unless all of it has it
  // already, then off (web's rule). Whether it went on.
  @discardableResult
  static func toggle(_ text: NSMutableAttributedString, _ mark: Marks, in range: NSRange) -> Bool {
    let on = !common(text, in: range).contains(mark)
    set(text, in: range) { on ? $0.union(mark) : $0.subtracting(mark) }
    return on
  }

  // MARK: Typed around words

  // A marker pair typed around words (web's input rules): "**x**" bold,
  // "*x*" italic, "__x__" underline, "~~x~~" strike, "||x||" spoiler,
  // "`x`" code. Matched at the end of the line's text up to the caret.
  static let rules: [(NSRegularExpression, Marks)] = {
    func rule(_ open: String, _ mark: Marks) -> (NSRegularExpression, Marks) {
      let marker = NSRegularExpression.escapedPattern(for: open)
      let first = NSRegularExpression.escapedPattern(for: String(open.first!))
      let pattern = "(?:^|\\s)(\(marker)([^\\s\(first)](?:[^\(first)]*[^\\s\(first)])?)\(marker))$"
      return (try! NSRegularExpression(pattern: pattern), mark)
    }
    return [
      rule("**", .bold), rule("__", .underline), rule("~~", .strike), rule("||", .spoiler), rule("`", .code),
      // A lone "*", not the second star of "**".
      (try! NSRegularExpression(pattern: "(?:^|[^*])(\\*([^\\s*](?:[^*]*[^\\s*])?)\\*)$"), .italic),
    ]
  }()

  struct Rule: Equatable {
    // In `before`: the markers and words, and the words alone.
    let marked: NSRange
    let words: NSRange
    let mark: Marks
  }

  static func rule(endingIn before: String) -> Rule? {
    let whole = NSRange(location: 0, length: (before as NSString).length)
    for (pattern, mark) in rules {
      guard let match = pattern.firstMatch(in: before, range: whole) else { continue }
      return Rule(marked: match.range(at: 1), words: match.range(at: 2), mark: mark)
    }
    return nil
  }

  // MARK: Look

  func look(into look: inout CharLook) {
    if contains(.bold) { look.bold = true }
    if contains(.italic) { look.italic = true }
    if contains(.underline) { look.underline = true }
    if contains(.strike) { look.strike = true }
    if contains(.code) {
      look.mono = true
      look.fill = .code
    }
    if contains(.spoiler) { look.spoiler = true }
  }
}

// A character's look, as the features describe it and the styler draws
// it: faces, lines, a colour, and the box behind it.
struct CharLook: Equatable {
  enum Color { case text, muted, accent }
  enum Fill { case code, mention }

  var bold = false
  var italic = false
  var semibold = false
  var mono = false
  var underline = false
  var strike = false
  var color: Color = .text
  var fill: Fill?
  var spoiler = false
}
