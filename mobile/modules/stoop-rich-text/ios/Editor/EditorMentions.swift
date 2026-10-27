import Foundation

// Mentions as pills: who a mention names, held on each character of the
// words it shows as (.editorMention), the same box on all of them. A pill
// is one unit: the caret never rests inside it, a change that would cut
// into it takes it whole, and words no longer the handle are no longer a
// pill.
final class MentionBox: NSObject {
  let mention: EditorMention

  init(_ mention: EditorMention) {
    self.mention = mention
  }

  // How it reads: #name for a channel, @handle for the rest (core
  // mentionText).
  var words: String { (mention.kind == "channel" ? "#" : "@") + mention.handle }

  // Equal only to itself: two pills of the same person side by side stay
  // two runs, not one the storage joined.
}

enum Mentions {
  static func at(_ text: NSAttributedString, _ index: Int) -> MentionBox? {
    guard index >= 0, index < text.length else { return nil }
    return text.attribute(.editorMention, at: index, effectiveRange: nil) as? MentionBox
  }

  // The whole of the pill holding `index`.
  static func range(_ text: NSAttributedString, ofPillAt index: Int) -> NSRange? {
    guard let box = at(text, index) else { return nil }
    var start = index
    while start > 0, at(text, start - 1) === box { start -= 1 }
    var end = index + 1
    while end < text.length, at(text, end) === box { end += 1 }
    return NSRange(location: start, length: end - start)
  }

  // The pill whose words hold `location` strictly inside them (not at
  // their edges).
  static func pill(_ text: NSAttributedString, around location: Int) -> NSRange? {
    guard location > 0, let box = at(text, location), at(text, location - 1) === box else { return nil }
    return range(text, ofPillAt: location)
  }

  static func isWholePill(_ text: NSAttributedString, _ range: NSRange) -> Bool {
    guard range.length > 0, let whole = self.range(text, ofPillAt: range.location) else { return false }
    return whole == range
  }

  // A range grown to take every pill it cuts into whole; an insertion
  // inside a pill moved to its end.
  static func whole(_ text: NSAttributedString, _ range: NSRange) -> NSRange {
    if range.length == 0 {
      if let pill = pill(text, around: range.location) { return NSRange(location: NSMaxRange(pill), length: 0) }
      return range
    }
    var start = range.location
    var end = NSMaxRange(range)
    if let pill = pill(text, around: start) { start = pill.location }
    if let pill = pill(text, around: end) { end = NSMaxRange(pill) }
    return NSRange(location: start, length: end - start)
  }

  // Where a selection's edge rests when it lands at `at`, having been at
  // `was`: never inside a pill. It goes on past the pill the way it was
  // moving (stepped left from a pill's end, to its start), or to the
  // nearer edge when it jumped there (a tap).
  static func edge(_ text: NSAttributedString, at: Int, was: Int) -> Int {
    guard let pill = pill(text, around: at) else { return at }
    if was <= pill.location { return NSMaxRange(pill) }
    if was >= NSMaxRange(pill) { return pill.location }
    return at - pill.location < NSMaxRange(pill) - at ? pill.location : NSMaxRange(pill)
  }

  // A pill whose words were changed (typed into, cut short, joined) is no
  // longer the pill: its box comes off and the words stay as text.
  static func dropBroken(_ text: NSMutableAttributedString, in range: NSRange) {
    let string = text.string as NSString
    var boxes: [MentionBox] = []
    text.enumerateAttribute(.editorMention, in: range) { value, _, _ in
      if let box = value as? MentionBox, !boxes.contains(where: { $0 === box }) { boxes.append(box) }
    }
    for box in boxes {
      var ranges: [NSRange] = []
      text.enumerateAttribute(.editorMention, in: NSRange(location: 0, length: text.length)) { value, part, _ in
        if let other = value as? MentionBox, other === box { ranges.append(part) }
      }
      if ranges.count == 1, string.substring(with: ranges[0]) == box.words { continue }
      for part in ranges { text.removeAttribute(.editorMention, range: part) }
    }
  }

  // The words at `range` made the pill: unlinked, one box.
  static func make(_ text: NSMutableAttributedString, in range: NSRange, _ mention: EditorMention) {
    Links.remove(text, in: range)
    text.addAttribute(.editorMention, value: MentionBox(mention), range: range)
  }

  // Pills in a range made their words (a code block, inline code, a link
  // and a link typed in full hold none).
  static func drop(_ text: NSMutableAttributedString, in range: NSRange) {
    text.removeAttribute(.editorMention, range: range)
  }

  // Whether any pill lies in the range.
  static func any(_ text: NSAttributedString, in range: NSRange) -> Bool {
    var found = false
    text.enumerateAttribute(.editorMention, in: range) { value, _, stop in
      if value != nil {
        found = true
        stop.pointee = true
      }
    }
    return found
  }

  // The text of a range with each pill's words as U+FFFC, so the mention
  // list's query can't start inside one and every index still counts.
  static func masked(_ text: NSAttributedString, in range: NSRange) -> String {
    let string = text.string as NSString
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

  // MARK: Look

  static func look(into look: inout CharLook) {
    look.semibold = true
    look.color = .accent
    look.fill = .mention
  }
}
