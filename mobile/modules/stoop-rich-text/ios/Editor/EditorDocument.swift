import Foundation

// The composer's document, as the text view holds it: text whose
// characters carry their meaning as attributes, and nothing else. Each
// feature owns one attribute and the rules about it (EditorMarks,
// EditorLinks, EditorMentions, EditorBlocks); this file holds what JS
// sees of the whole (lines in, lines out: core/editor/lines.ts), the
// line walking everything else uses, and the order the invariants run in
// after an edit (`settle`). Nothing here imports UIKit, so it runs under
// `swift test` (../../Package.swift).

// One line as JS hands it over and reads it back.
struct EditorLine: Equatable {
  var block: String
  var depth: Int
  var group: Int
  var lang: String?
  var runs: [EditorRun]

  init(block: String = "paragraph", depth: Int = 0, group: Int = 0, lang: String? = nil, runs: [EditorRun] = []) {
    self.block = block
    self.depth = depth
    self.group = group
    self.lang = lang
    self.runs = runs
  }
}

struct EditorRun: Equatable {
  var text: String?
  var marks: [String]
  var href: String?
  var mention: EditorMention?

  init(text: String, marks: [String] = [], href: String? = nil) {
    self.text = text
    self.marks = marks
    self.href = href
  }

  init(mention: EditorMention, marks: [String] = []) {
    self.mention = mention
    self.marks = marks
  }
}

struct EditorMention: Equatable {
  var kind: String
  var id: String
  var handle: String
}

extension NSAttributedString.Key {
  // What a character means. The look (fonts, colours, fills) is worked out
  // from these by the styler and never read back.
  static let editorMarks = NSAttributedString.Key("StoopEditorMarks")
  static let editorHref = NSAttributedString.Key("StoopEditorHref")
  static let editorMention = NSAttributedString.Key("StoopEditorMention")
  static let editorBlock = NSAttributedString.Key("StoopEditorBlock")
}

enum Document {
  static let meaningKeys: [NSAttributedString.Key] = [.editorMarks, .editorHref, .editorMention, .editorBlock]

  static let newline: unichar = 10

  // MARK: Lines

  // The line holding `location`, its "\n" included; the empty line after
  // a trailing "\n" is a zero-length range at the end.
  static func line(_ string: NSString, at location: Int) -> NSRange {
    string.lineRange(for: NSRange(location: max(0, min(location, string.length)), length: 0))
  }

  // A line without its "\n".
  static func content(_ string: NSString, of line: NSRange) -> NSRange {
    var content = line
    if content.length > 0, string.character(at: NSMaxRange(content) - 1) == newline { content.length -= 1 }
    return content
  }

  // Every line of the text (or those meeting `range`), first to last, the
  // empty last line after a trailing "\n" included as a zero-length line.
  static func forEachLine(_ string: NSString, in range: NSRange? = nil, _ body: (_ line: NSRange, _ content: NSRange) -> Void) {
    let from = range.map { max(0, min($0.location, string.length)) } ?? 0
    let to = range.map { max(from, min(NSMaxRange($0), string.length)) } ?? string.length
    var location = from
    while true {
      let line = self.line(string, at: location)
      body(line, content(string, of: line))
      if line.length == 0 || NSMaxRange(line) > to || NSMaxRange(line) >= string.length {
        // A text ending in "\n" has one more, empty, line after it.
        if line.length > 0, NSMaxRange(line) == string.length, string.character(at: string.length - 1) == newline,
          NSMaxRange(line) <= to {
          let last = NSRange(location: string.length, length: 0)
          body(last, last)
        }
        return
      }
      location = NSMaxRange(line)
    }
  }

  // The whole lines meeting a range, as one range.
  static func lines(_ string: NSString, meeting range: NSRange) -> NSRange {
    let start = max(0, min(range.location, string.length))
    let end = max(start, min(NSMaxRange(range), string.length))
    return string.lineRange(for: NSRange(location: start, length: end - start))
  }

  // MARK: In and out

  // Lines into text carrying their meaning (no look yet), joined by "\n".
  // An empty last line in a block gets the block's holder (EditorBlocks).
  static func attributed(_ lines: [EditorLine]) -> NSMutableAttributedString {
    let out = NSMutableAttributedString()
    for (index, line) in lines.enumerated() {
      let block = BlockBox(Block(rawValue: line.block) ?? .paragraph, depth: line.depth, group: line.group, lang: line.lang)
      for run in line.runs {
        var attrs: [NSAttributedString.Key: Any] = [.editorBlock: block]
        let marks = Marks(names: run.marks)
        if !marks.isEmpty, block.block != .code { attrs[.editorMarks] = marks.rawValue }
        if let mention = run.mention, block.block != .code {
          let box = MentionBox(mention)
          attrs[.editorMention] = box
          out.append(NSAttributedString(string: box.words, attributes: attrs))
        } else if let text = run.mention.map({ MentionBox($0).words }) ?? run.text, !text.isEmpty {
          if let href = run.href, block.block != .code { attrs[.editorHref] = href }
          out.append(NSAttributedString(string: text, attributes: attrs))
        }
      }
      if index < lines.count - 1 {
        out.append(NSAttributedString(string: "\n", attributes: [.editorBlock: block]))
      } else if line.runs.isEmpty, block.block != .paragraph {
        out.append(NSAttributedString(string: Blocks.holder, attributes: [.editorBlock: block]))
      }
    }
    return out
  }

  // Text back into lines. Groups are numbered as core reads them: a new
  // one wherever the kind of block changes, at each paragraph, and
  // between two code blocks.
  static func lines(_ text: NSAttributedString) -> [EditorLine] {
    let string = text.string as NSString
    var out: [EditorLine] = []
    var group = -1
    var previous: (family: String, code: Int)?
    forEachLine(string) { line, content in
      let block = Blocks.at(text, line: line)
      let family = block.block.isList ? "list" : block.block.rawValue
      if previous == nil || family == "paragraph" || previous!.family != family
        || (family == "code" && previous!.code != block.group) {
        group += 1
      }
      previous = (family, block.group)
      var words = content
      if Blocks.isHolder(text, line: line) { words.length = 0 }
      out.append(EditorLine(block: block.block.rawValue, depth: block.depth, group: group, lang: block.lang, runs: runs(text, in: words)))
    }
    return out
  }

  static func runs(_ text: NSAttributedString, in range: NSRange) -> [EditorRun] {
    var out: [EditorRun] = []
    guard range.length > 0 else { return out }
    let string = text.string as NSString
    // One run per mention box, however many attribute runs it spans (its
    // marks may differ along it; the first's are the run's).
    var lastMention: MentionBox?
    text.enumerateAttributes(in: range) { attrs, part, _ in
      let marks = Marks(rawValue: (attrs[.editorMarks] as? Int) ?? 0).names
      if let mention = attrs[.editorMention] as? MentionBox {
        if mention !== lastMention { out.append(EditorRun(mention: mention.mention, marks: marks)) }
        lastMention = mention
        return
      }
      lastMention = nil
      out.append(EditorRun(text: string.substring(with: part), marks: marks, href: attrs[.editorHref] as? String))
    }
    return out
  }

  // MARK: After an edit

  // The attributes put right after characters changed in `edited`: each
  // line one block (its first character's), code lines plain, a pill
  // whose words changed no longer a pill, list levels in step. The lines
  // whose look must be done again.
  @discardableResult
  static func settle(_ text: NSMutableAttributedString, edited: NSRange) -> NSRange {
    let string = text.string as NSString
    var touched = lines(string, meeting: edited)
    Blocks.normalise(text, lines: touched)
    Mentions.dropBroken(text, in: touched)
    for line in Blocks.normaliseDepths(text) { touched = NSUnionRange(touched, line) }
    return touched
  }

  // MARK: What the toolbar shows

  // The formats in effect, as web's toolbar names them (core/editor
  // formats): at a caret, what typing would carry (`caretMarks` when a
  // toggle set them); over a selection, what all of its words have. And
  // the first line's block.
  static func activeFormats(_ text: NSAttributedString, selection: NSRange, caretMarks: Marks?) -> [String] {
    var formats: [String] = []
    let string = text.string as NSString
    let block = Blocks.at(text, line: line(string, at: selection.location))
    // A selection is "in a code block" only when none of it can take a
    // mark; one that runs out of a code block into words can.
    let inCode = selection.length == 0 ? block.block == .code : Marks.markable(text, in: selection).isEmpty
    if !inCode {
      let marks = selection.length == 0 ? (caretMarks ?? Marks.typing(text, at: selection.location)) : Marks.common(text, in: selection)
      formats += marks.names
    }
    if Links.around(text, selection: selection) != nil { formats.append("link") }
    switch block.block {
    case .quote: formats.append("quote")
    case .bullet: formats.append("list")
    case .ordered: formats.append("orderedList")
    case .code: formats.append("codeblock")
    case .paragraph: break
    }
    return formats
  }

  // The caret's line up to the caret, for the mention list: a pill's
  // words as U+FFFC each (a query can't start inside one, and every index
  // still counts), a holder left out.
  static func textBefore(_ text: NSAttributedString, at location: Int) -> String {
    let string = text.string as NSString
    let end = max(0, min(location, string.length))
    let line = self.line(string, at: end)
    if Blocks.isHolder(text, line: line) { return "" }
    return Mentions.masked(text, in: NSRange(location: line.location, length: end - line.location))
  }
}
