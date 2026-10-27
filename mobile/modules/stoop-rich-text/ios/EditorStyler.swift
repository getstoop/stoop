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

// Draws the look each feature describes (CharLook, Blocks.indent) onto
// the text: fonts, colours, lines, the boxes RichLayoutManager fills, and
// each line's indent. Run over the lines an edit touched, so typed, pasted
// and loaded text look alike; the meaning attributes are read, never
// changed.
final class EditorStyler {
  var style = EditorStyleRecord()
  private var hatchCache: (UIColor, UIColor, UIColor)?

  var bodyFont: UIFont { UIFont.systemFont(ofSize: CGFloat(style.fontSize)) }

  var metrics: Blocks.Metrics {
    Blocks.Metrics(quoteBarWidth: style.quoteBarWidth, quotePadX: style.quotePadX, listIndent: style.listIndent, prePadX: style.prePadX)
  }

  private var baselineOffset: CGFloat {
    max(0, (CGFloat(style.lineHeight) - bodyFont.lineHeight) / 2)
  }

  // The typing attributes for a position: its meaning, and the look of
  // that meaning, so what is typed arrives styled.
  func typing(block: BlockBox, marks: Marks, href: String?) -> [NSAttributedString.Key: Any] {
    var attrs: [NSAttributedString.Key: Any] = [.editorBlock: block]
    var look = CharLook()
    Blocks.look(block, into: &look)
    if block.block != .code {
      if !marks.isEmpty { attrs[.editorMarks] = marks.rawValue }
      marks.look(into: &look)
      if let href = href {
        attrs[.editorHref] = href
        Links.look(into: &look)
      }
    }
    for (key, value) in attributes(for: look, mentionId: nil) { attrs[key] = value }
    attrs[.paragraphStyle] = paragraphStyle(block)
    attrs[.baselineOffset] = baselineOffset
    return attrs
  }

  // Each line meeting `range` styled whole.
  func restyle(_ text: NSMutableAttributedString, lines range: NSRange) {
    let string = text.string as NSString
    guard string.length > 0 else { return }
    Document.forEachLine(string, in: range) { line, content in
      guard line.length > 0 else { return }
      let block = Blocks.at(text, line: line)
      text.addAttributes([.paragraphStyle: paragraphStyle(block), .baselineOffset: baselineOffset], range: line)
      for key in [NSAttributedString.Key.underlineStyle, .strikethroughStyle, .stoopFill, .stoopSpoiler] {
        text.removeAttribute(key, range: line)
      }
      text.enumerateAttributes(in: line) { attrs, part, _ in
        var look = CharLook()
        Blocks.look(block, into: &look)
        let mention = attrs[.editorMention] as? MentionBox
        if block.block != .code {
          Marks(rawValue: (attrs[.editorMarks] as? Int) ?? 0).look(into: &look)
          if attrs[.editorHref] != nil { Links.look(into: &look) }
          if mention != nil { Mentions.look(into: &look) }
        }
        text.addAttributes(attributes(for: look, mentionId: mention.map { ObjectIdentifier($0).hashValue }), range: part)
      }
      if block.block != .code {
        for address in Links.bareAddresses(text, in: content) {
          text.addAttributes([.foregroundColor: style.accentColor, .underlineStyle: NSUnderlineStyle.single.rawValue], range: address)
        }
      }
    }
  }

  private func attributes(for look: CharLook, mentionId: Int?) -> [NSAttributedString.Key: Any] {
    let size = CGFloat(style.fontSize)
    var font: UIFont
    if look.mono {
      let monoSize = size * CGFloat(style.codeScale)
      font = UIFont(name: "Menlo", size: monoSize) ?? UIFont.monospacedSystemFont(ofSize: monoSize, weight: .regular)
    } else {
      font = UIFont.systemFont(ofSize: size, weight: look.semibold ? .semibold : .regular)
    }
    var traits = font.fontDescriptor.symbolicTraits
    if look.bold { traits.insert(.traitBold) }
    if look.italic { traits.insert(.traitItalic) }
    if let descriptor = font.fontDescriptor.withSymbolicTraits(traits) {
      font = UIFont(descriptor: descriptor, size: font.pointSize)
    }
    let color: UIColor
    switch look.color {
    case .text: color = style.textColor
    case .muted: color = style.mutedColor
    case .accent: color = style.accentColor
    }
    var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    if look.underline { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    if look.strike { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    let pad = CGFloat(style.fillPad)
    switch look.fill {
    case .mention: attrs[.stoopFill] = FillBox(id: mentionId ?? -3, color: style.mentionFill, pad: pad)
    case .code: attrs[.stoopFill] = FillBox(id: -1, color: style.raised, pad: pad)
    case nil: break
    }
    if look.spoiler { attrs[.stoopSpoiler] = FillBox(id: -2, color: hatched(), pad: pad) }
    return attrs
  }

  func paragraphStyle(_ block: BlockBox) -> NSParagraphStyle {
    let paragraph = NSMutableParagraphStyle()
    let lineHeight = CGFloat(style.lineHeight)
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
    paragraph.lineBreakMode = .byWordWrapping
    let indent = CGFloat(Blocks.indent(block, metrics))
    paragraph.firstLineHeadIndent = indent
    paragraph.headIndent = indent
    if block.block == .code { paragraph.tailIndent = -CGFloat(style.prePadX) }
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
