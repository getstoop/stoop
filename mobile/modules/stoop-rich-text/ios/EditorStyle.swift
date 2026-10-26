import ExpoModulesCore
import UIKit

// The composer's look, from the theme (RichField.tsx builds it from the
// generated `markdown` values, as the timeline's paragraphs are).
struct EditorStyleRecord: Record {
  @Field var textColor: UIColor = .label
  @Field var mutedColor: UIColor = .secondaryLabel
  @Field var accentColor: UIColor = .tintColor
  @Field var mentionFill: UIColor = .systemGray5
  @Field var raised: UIColor = .systemGray5
  @Field var border: UIColor = .separator
  @Field var hatch: UIColor = .systemGray3
  @Field var placeholderColor: UIColor = .placeholderText
  @Field var fontSize: Double = 17
  @Field var lineHeight: Double = 23
  @Field var codeScale: Double = 0.9
  @Field var quoteBarWidth: Double = 3
  @Field var quotePadX: Double = 12
  @Field var listIndent: Double = 24
  @Field var prePadX: Double = 12
  @Field var radius: Double = 4
  @Field var fillPad: Double = 2
}

// Gives text its look from its meaning (EditorModel's keys): fonts,
// colours, indents, and the boxes RichLayoutManager draws. Run over a
// line whenever it changes, so typed, pasted and loaded text look alike.
final class EditorStyler {
  var style = EditorStyleRecord()
  private var hatchCache: (UIColor, UIColor, UIColor)?

  var bodyFont: UIFont { UIFont.systemFont(ofSize: CGFloat(style.fontSize)) }

  // The typing attributes' look for a meaning, for text not yet typed.
  func look(for meaning: [NSAttributedString.Key: Any]) -> [NSAttributedString.Key: Any] {
    let block = (meaning[.editorBlock] as? BlockBox) ?? .paragraph
    let marks = EditorMarks(rawValue: (meaning[.editorMarks] as? Int) ?? 0)
    var attrs = meaning
    for (key, value) in charLook(block: block, marks: marks, href: meaning[.editorHref] as? String, mention: nil) {
      attrs[key] = value
    }
    attrs[.paragraphStyle] = paragraphStyle(block)
    attrs[.baselineOffset] = baselineOffset
    return attrs
  }

  private var baselineOffset: CGFloat {
    max(0, (CGFloat(style.lineHeight) - bodyFont.lineHeight) / 2)
  }

  // Each line touching `range` restyled whole. A line takes one block,
  // its first character's, so two lines joined by a backspace become one
  // line of the first's kind.
  func restyle(_ storage: NSTextStorage, lines range: NSRange) {
    let string = storage.string as NSString
    guard string.length > 0 else { return }
    let start = min(range.location, string.length)
    var lines = string.lineRange(for: NSRange(location: start, length: min(range.length, string.length - start)))
    if lines.length == 0 { return }
    lines = NSIntersectionRange(lines, NSRange(location: 0, length: string.length))

    var location = lines.location
    while location < NSMaxRange(lines) {
      let line = string.lineRange(for: NSRange(location: location, length: 0))
      let block = (storage.attribute(.editorBlock, at: line.location, effectiveRange: nil) as? BlockBox) ?? .paragraph
      storage.addAttribute(.editorBlock, value: block, range: line)
      storage.addAttributes(
        [.paragraphStyle: paragraphStyle(block), .baselineOffset: baselineOffset],
        range: line)
      storage.removeAttribute(.underlineStyle, range: line)
      storage.removeAttribute(.strikethroughStyle, range: line)
      storage.removeAttribute(.stoopFill, range: line)
      storage.removeAttribute(.stoopSpoiler, range: line)
      storage.enumerateAttributes(in: line) { attrs, part, _ in
        let marks = EditorMarks(rawValue: (attrs[.editorMarks] as? Int) ?? 0)
        let look = charLook(
          block: block, marks: marks, href: attrs[.editorHref] as? String,
          mention: attrs[.editorMention] as? MentionBox, at: part.location)
        storage.addAttributes(look, range: part)
      }
      if block.block != .code { styleBareAddresses(storage, in: line) }
      location = NSMaxRange(line)
    }
  }

  // A bare address stays text (the message format links it on its own);
  // it only looks like a link: the accent, underlined. Trailing
  // punctuation belongs to the sentence, as the parser reads it.
  private static let address = try! NSRegularExpression(pattern: "https?://[^\\s<>]+", options: [.caseInsensitive])

  private func styleBareAddresses(_ storage: NSTextStorage, in line: NSRange) {
    let string = storage.string as NSString
    for match in EditorStyler.address.matches(in: storage.string, range: line) {
      var range = match.range
      while range.length > 0, ".,;:!?)]'\"".contains(Character(UnicodeScalar(string.character(at: NSMaxRange(range) - 1)) ?? " ")) {
        range.length -= 1
      }
      var plain = true
      storage.enumerateAttributes(in: range) { attrs, _, stop in
        let marks = EditorMarks(rawValue: (attrs[.editorMarks] as? Int) ?? 0)
        if attrs[.editorHref] != nil || attrs[.editorMention] != nil || marks.contains(.code) {
          plain = false
          stop.pointee = true
        }
      }
      guard plain, range.length > 0 else { continue }
      storage.addAttributes(
        [.foregroundColor: style.accentColor, .underlineStyle: NSUnderlineStyle.single.rawValue], range: range)
    }
  }

  private func charLook(
    block: BlockBox, marks: EditorMarks, href: String?, mention: MentionBox?, at location: Int = 0
  ) -> [NSAttributedString.Key: Any] {
    let size = CGFloat(style.fontSize)
    let codeBlock = block.block == .code
    let mono = codeBlock || marks.contains(.code)
    var font: UIFont
    if mono {
      let monoSize = size * CGFloat(style.codeScale)
      font = UIFont(name: "Menlo", size: monoSize) ?? UIFont.monospacedSystemFont(ofSize: monoSize, weight: .regular)
    } else {
      font = UIFont.systemFont(ofSize: size, weight: mention != nil ? .semibold : .regular)
    }
    var traits = font.fontDescriptor.symbolicTraits
    if !codeBlock {
      if marks.contains(.bold) { traits.insert(.traitBold) }
      if marks.contains(.italic) { traits.insert(.traitItalic) }
    }
    if let descriptor = font.fontDescriptor.withSymbolicTraits(traits) {
      font = UIFont(descriptor: descriptor, size: font.pointSize)
    }

    var color = style.textColor
    if block.block == .quote { color = style.mutedColor }
    if href != nil || mention != nil { color = style.accentColor }
    var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    if codeBlock { return attrs }
    if marks.contains(.underline) || href != nil {
      attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
    }
    if marks.contains(.strike) { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    let pad = CGFloat(style.fillPad)
    if let mention = mention {
      attrs[.stoopFill] = FillBox(id: mention.hash, color: style.mentionFill, pad: pad)
    } else if marks.contains(.code) {
      attrs[.stoopFill] = FillBox(id: -1, color: style.raised, pad: pad)
    }
    if marks.contains(.spoiler) {
      attrs[.stoopSpoiler] = FillBox(id: -2, color: hatched(), pad: pad)
    }
    return attrs
  }

  func paragraphStyle(_ block: BlockBox) -> NSParagraphStyle {
    let paragraph = NSMutableParagraphStyle()
    let lineHeight = CGFloat(style.lineHeight)
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
    paragraph.lineBreakMode = .byWordWrapping
    var indent: CGFloat = 0
    switch block.block {
    case .quote:
      indent = CGFloat(style.quoteBarWidth + style.quotePadX)
    case .bullet, .ordered:
      indent = CGFloat(style.listIndent) * CGFloat(block.depth + 1)
    case .code:
      indent = CGFloat(style.prePadX)
      paragraph.tailIndent = -CGFloat(style.prePadX)
    case .paragraph:
      break
    }
    paragraph.firstLineHeadIndent = indent
    paragraph.headIndent = indent
    return paragraph
  }

  // The spoiler's fill: diagonal stripes of the hatch colour over the
  // raised one, as the artboards draw it.
  private func hatched() -> UIColor {
    if let cache = hatchCache, cache.0 == style.raised, cache.1 == style.hatch { return cache.2 }
    let side: CGFloat = 10
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { context in
      style.raised.setFill()
      context.fill(CGRect(x: 0, y: 0, width: side, height: side))
      style.hatch.setStroke()
      let path = UIBezierPath()
      path.lineWidth = side / 2 / sqrt(2)
      for offset in stride(from: -side, through: side * 2, by: side) {
        path.move(to: CGPoint(x: offset, y: side))
        path.addLine(to: CGPoint(x: offset + side, y: 0))
      }
      path.stroke()
    }
    let color = UIColor(patternImage: image)
    hatchCache = (style.raised, style.hatch, color)
    return color
  }
}
