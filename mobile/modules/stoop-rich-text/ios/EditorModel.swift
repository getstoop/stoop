import ExpoModulesCore
import UIKit

// The composer's document as JS hands it over and reads it back: lines,
// each with its block and styled runs (core/editor/lines.ts EditorLine).

struct EditorMentionRecord: Record {
  @Field var kind: String = "person"
  @Field var id: String = ""
  @Field var handle: String = ""
}

struct EditorRunRecord: Record {
  @Field var text: String?
  @Field var marks: [String] = []
  @Field var href: String?
  @Field var mention: EditorMentionRecord?
}

struct EditorLineRecord: Record {
  @Field var block: String = "paragraph"
  @Field var depth: Int = 0
  @Field var group: Int = 0
  @Field var lang: String?
  @Field var runs: [EditorRunRecord] = []
}

// The text JS puts in the field, from outside (a draft, an edit, a
// refused send): loaded when its revision changes.
struct EditorDocumentRecord: Record {
  @Field var revision: Int = 0
  @Field var lines: [EditorLineRecord] = []
}

// The marks a character carries, as bits.
struct EditorMarks: OptionSet, Hashable {
  let rawValue: Int
  static let bold = EditorMarks(rawValue: 1)
  static let italic = EditorMarks(rawValue: 2)
  static let underline = EditorMarks(rawValue: 4)
  static let strike = EditorMarks(rawValue: 8)
  static let code = EditorMarks(rawValue: 16)
  static let spoiler = EditorMarks(rawValue: 32)

  // In core's order (EditorMark).
  static let named: [(String, EditorMarks)] = [
    ("bold", .bold), ("italic", .italic), ("underline", .underline),
    ("strike", .strike), ("code", .code), ("spoiler", .spoiler),
  ]

  init(rawValue: Int) { self.rawValue = rawValue }

  init(names: [String]) {
    var marks: EditorMarks = []
    for (name, mark) in EditorMarks.named where names.contains(name) { marks.insert(mark) }
    self = marks
  }

  var names: [String] { EditorMarks.named.filter { contains($0.1) }.map(\.0) }
}

enum EditorBlock: String {
  case paragraph, quote, bullet, ordered, code

  var isList: Bool { self == .bullet || self == .ordered }
}

// A line's block, on every character of the line, its newline included.
// Equal by value, so the storage keeps one attribute run for a line.
final class BlockBox: NSObject {
  let block: EditorBlock
  let depth: Int
  let group: Int
  let lang: String?

  init(_ block: EditorBlock, depth: Int = 0, group: Int = 0, lang: String? = nil) {
    self.block = block
    self.depth = block.isList ? max(0, min(depth, 3)) : 0
    self.group = group
    self.lang = block == .code ? lang : nil
  }

  static let paragraph = BlockBox(.paragraph)

  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? BlockBox else { return false }
    return other.block == block && other.depth == depth && other.group == group && other.lang == lang
  }
  override var hash: Int { block.hashValue ^ depth ^ (group << 4) }
}

// Who a mention names, on each character of the words it shows as.
final class MentionBox: NSObject {
  let kind: String
  let id: String
  let handle: String

  init(kind: String, id: String, handle: String) {
    self.kind = kind
    self.id = id
    self.handle = handle
  }

  // How it reads: #name for a channel, @handle for the rest (core
  // mentionText).
  var words: String { (kind == "channel" ? "#" : "@") + handle }

  var json: [String: Any] { ["kind": kind, "id": id, "handle": handle] }

  // Equal only to itself: two pills of the same person side by side stay
  // two runs, not one the storage joined.
}

extension NSAttributedString.Key {
  // What a character means; the look is worked out from these (EditorStyle).
  static let editorMarks = NSAttributedString.Key("StoopEditorMarks")
  static let editorHref = NSAttributedString.Key("StoopEditorHref")
  static let editorMention = NSAttributedString.Key("StoopEditorMention")
  static let editorBlock = NSAttributedString.Key("StoopEditorBlock")
}

enum EditorDocument {
  static let meaningKeys: [NSAttributedString.Key] = [.editorMarks, .editorHref, .editorMention, .editorBlock]

  // Lines into text with their meaning (no look yet), lines joined by "\n".
  static func attributed(_ lines: [EditorLineRecord]) -> NSAttributedString {
    let out = NSMutableAttributedString()
    for (index, line) in lines.enumerated() {
      let block = BlockBox(
        EditorBlock(rawValue: line.block) ?? .paragraph,
        depth: line.depth, group: line.group, lang: line.lang)
      for run in line.runs {
        var attrs: [NSAttributedString.Key: Any] = [.editorBlock: block]
        let marks = EditorMarks(names: run.marks)
        if !marks.isEmpty { attrs[.editorMarks] = marks.rawValue }
        if let mention = run.mention {
          let box = MentionBox(kind: mention.kind, id: mention.id, handle: mention.handle)
          attrs[.editorMention] = box
          out.append(NSAttributedString(string: box.words, attributes: attrs))
        } else if let text = run.text, !text.isEmpty {
          if let href = run.href { attrs[.editorHref] = href }
          out.append(NSAttributedString(string: text, attributes: attrs))
        }
      }
      // An empty last line has no character to hold its block: the field
      // keeps it in its typing attributes (RichEditorView.load).
      if index < lines.count - 1 {
        out.append(NSAttributedString(string: "\n", attributes: [.editorBlock: block]))
      }
    }
    return out
  }

  // The block of the line that holds a character position.
  static func block(in text: NSAttributedString, lineAt location: Int) -> BlockBox? {
    let string = text.string as NSString
    let line = string.lineRange(for: NSRange(location: min(location, string.length), length: 0))
    guard line.length > 0 else { return nil }
    return text.attribute(.editorBlock, at: line.location, effectiveRange: nil) as? BlockBox
  }

  // Text back into lines, as JSON for the event. The last line, when
  // empty, takes its block from `trailing` (the typing attributes).
  static func lines(_ text: NSAttributedString, trailing: BlockBox?) -> [[String: Any]] {
    let string = text.string as NSString
    var out: [[String: Any]] = []
    var group = -1
    var previous: (family: String, code: Int)?
    var location = 0
    while true {
      let lineRange = string.lineRange(for: NSRange(location: location, length: 0))
      var content = lineRange
      if content.length > 0, string.character(at: NSMaxRange(content) - 1) == 10 {
        content.length -= 1
      }
      let atEnd = NSMaxRange(lineRange) >= string.length
      let block: BlockBox
      if lineRange.length > 0, let box = text.attribute(.editorBlock, at: lineRange.location, effectiveRange: nil) as? BlockBox {
        block = box
      } else if lineRange.length == 0, let trailing = trailing {
        block = trailing
      } else {
        block = .paragraph
      }
      // Groups as core reads them: a new one wherever the kind of block
      // changes, at each paragraph, and between two code blocks.
      let family = block.block.isList ? "list" : block.block.rawValue
      if previous == nil || family == "paragraph" || previous!.family != family
        || (family == "code" && previous!.code != block.group) {
        group += 1
      }
      previous = (family, block.group)

      var line: [String: Any] = [
        "block": block.block.rawValue,
        "depth": block.depth,
        "group": group,
        "runs": runs(text, in: content),
      ]
      if let lang = block.lang { line["lang"] = lang }
      out.append(line)

      // A text ending in "\n" has one more, empty, line after it.
      if atEnd {
        if lineRange.length > 0, string.character(at: NSMaxRange(lineRange) - 1) == 10 {
          location = string.length
          let last = trailing ?? (block.block == .paragraph ? .paragraph : block)
          let lastFamily = last.block.isList ? "list" : last.block.rawValue
          if lastFamily == "paragraph" || lastFamily != previous!.family
            || (lastFamily == "code" && previous!.code != last.group) {
            group += 1
          }
          var empty: [String: Any] = ["block": last.block.rawValue, "depth": last.depth, "group": group, "runs": []]
          if let lang = last.lang { empty["lang"] = lang }
          out.append(empty)
        }
        break
      }
      location = NSMaxRange(lineRange)
    }
    return out
  }

  private static func runs(_ text: NSAttributedString, in range: NSRange) -> [[String: Any]] {
    var out: [[String: Any]] = []
    guard range.length > 0 else { return out }
    let string = text.string as NSString
    // One run per mention box, however many attribute runs it spans
    // (its marks may differ along it; the first's are the run's).
    var lastMention: MentionBox?
    text.enumerateAttributes(in: range) { attrs, part, _ in
      let marks = EditorMarks(rawValue: (attrs[.editorMarks] as? Int) ?? 0).names
      if let mention = attrs[.editorMention] as? MentionBox {
        if mention !== lastMention { out.append(["mention": mention.json, "marks": marks]) }
        lastMention = mention
        return
      }
      lastMention = nil
      var run: [String: Any] = ["text": string.substring(with: part), "marks": marks]
      if let href = attrs[.editorHref] as? String { run["href"] = href }
      out.append(run)
    }
    return out
  }

  // A mention whose words were changed (typed into, cut short) is no
  // longer the mention: its box comes off and the words stay as text.
  static func dropBrokenMentions(_ text: NSMutableAttributedString, in range: NSRange) {
    let string = text.string as NSString
    let whole = NSRange(location: 0, length: text.length)
    var boxes: [MentionBox] = []
    text.enumerateAttribute(.editorMention, in: range) { value, _, _ in
      if let box = value as? MentionBox, !boxes.contains(where: { $0 === box }) { boxes.append(box) }
    }
    for box in boxes {
      var ranges: [NSRange] = []
      text.enumerateAttribute(.editorMention, in: whole) { value, part, _ in
        if let other = value as? MentionBox, other === box { ranges.append(part) }
      }
      if ranges.count == 1, string.substring(with: ranges[0]) == box.words { continue }
      for part in ranges { text.removeAttribute(.editorMention, range: part) }
    }
  }

  // Each list line held to one level deeper than the list line before it
  // at most (0 for a list's first line), as core's linesToDoc reads
  // lines, so what the field draws is what is sent. The lines it changed.
  static func normaliseListDepths(_ text: NSMutableAttributedString) -> [NSRange] {
    let string = text.string as NSString
    var changed: [NSRange] = []
    var before = -1
    var location = 0
    while location < string.length {
      let line = string.lineRange(for: NSRange(location: location, length: 0))
      if let block = text.attribute(.editorBlock, at: line.location, effectiveRange: nil) as? BlockBox, block.block.isList {
        let depth = min(block.depth, before + 1)
        if depth != block.depth {
          text.addAttribute(.editorBlock, value: BlockBox(block.block, depth: depth), range: line)
          changed.append(line)
        }
        before = depth
      } else {
        before = -1
      }
      location = NSMaxRange(line)
    }
    return changed
  }

  // The line's text up to a position, a mention's words as U+FFFC each, so
  // a query can't start inside one and every index still counts.
  static func textBefore(_ text: NSAttributedString, at location: Int) -> String {
    let string = text.string as NSString
    let end = min(location, string.length)
    let line = string.lineRange(for: NSRange(location: end, length: 0))
    let range = NSRange(location: line.location, length: end - line.location)
    var out = ""
    text.enumerateAttribute(.editorMention, in: range) { value, part, _ in
      if value is MentionBox {
        out += String(repeating: "\u{FFFC}", count: part.length)
      } else {
        out += string.substring(with: part)
      }
    }
    return out
  }
}
