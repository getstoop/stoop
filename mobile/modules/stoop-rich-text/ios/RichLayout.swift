import ExpoModulesCore
import UIKit

// One styled run of a message's words, built in JS from our parser's tree
// (MessageBody/native.ts). Never Markdown: the marks are already resolved.
struct RichRun: Record {
  @Field var text: String = ""
  @Field var size: Double = 15
  @Field var weight: Double = 400
  @Field var italic: Bool = false
  @Field var mono: Bool = false
  @Field var underline: Bool = false
  @Field var strike: Bool = false
  @Field var color: UIColor?
  // A tappable link: a URL, or "channel:<id>" for a channel pill. Runs of
  // one link share linkId. A hidden link takes taps but is no link element
  // (its words hide a covered spoiler).
  @Field var link: String?
  @Field var linkId: Int?
  @Field var linkHidden: Bool = false
  // A rounded, padded fill behind the run: a pill or inline code, padded
  // fillPad at each end. Runs of one pill share fillId.
  @Field var fill: UIColor?
  @Field var fillId: Int?
  @Field var fillPad: Double = 4
  // A drawn mark in place of the run's words ("person" or "group"), in
  // the run's colour and at its size: what ends a mention's pill.
  @Field var glyph: String?
  // Under a spoiler: its id (while covered, the outermost covered one's,
  // so a tap anywhere on the cover reveals it), whether it is covered,
  // and its fill.
  @Field var spoiler: Int?
  @Field var covered: Bool = false
  @Field var spoilerFill: UIColor?
}

struct RichDoc: Record {
  @Field var runs: [RichRun] = []
  @Field var lineHeight: Double = 21.75
  @Field var bodySize: Double = 15
  @Field(.required) var textColor: UIColor?
  @Field var spoilerPad: Double = 4
  @Field var radius: Double = 4
  // The paragraph as a screen reader says it (covered spoilers as
  // "spoiler, double tap to reveal").
  @Field var label: String = ""
  // False in the message menu's card: covered spoilers take no tap and the
  // paragraph offers no reveal.
  @Field var revealable: Bool = true
}

// The mark that ends a mention's pill, as web's (messages.css
// .mention::after, drawn from Icons.tsx): 0.85 of the text's size, 3pt
// after the handle, sitting a little under the baseline, stroked in the
// pill's colour.
enum MentionGlyph {
  private static let images = NSCache<NSString, UIImage>()

  static func attachment(_ kind: String, size: CGFloat, color: UIColor) -> NSTextAttachment {
    let side = size * 0.85
    let gap: CGFloat = 3
    let attachment = NSTextAttachment()
    attachment.image = image(kind, side: side, gap: gap, color: color)
    attachment.bounds = CGRect(x: 0, y: -size * 0.08, width: gap + side, height: side)
    return attachment
  }

  private static func image(_ kind: String, side: CGFloat, gap: CGFloat, color: UIColor) -> UIImage {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    let key = "\(kind) \(side) \(red) \(green) \(blue) \(alpha)" as NSString
    if let held = images.object(forKey: key) { return held }
    let made = UIGraphicsImageRenderer(size: CGSize(width: gap + side, height: side)).image { context in
      let canvas = context.cgContext
      canvas.translateBy(x: gap, y: 0)
      canvas.scaleBy(x: side / 24, y: side / 24)
      let path = kind == "group" ? group() : person()
      path.lineWidth = 2.5
      path.lineCapStyle = .round
      path.lineJoinStyle = .round
      color.setStroke()
      path.stroke()
    }
    images.setObject(made, forKey: key)
    return made
  }

  // In web's 24-unit box, from the same shapes. Angles run clockwise
  // from the x axis, as the view's coordinates do.
  private static func person() -> UIBezierPath {
    let path = UIBezierPath(arcCenter: CGPoint(x: 12, y: 8), radius: 4, startAngle: 0, endAngle: 2 * .pi, clockwise: true)
    path.move(to: CGPoint(x: 4, y: 21))
    path.addLine(to: CGPoint(x: 4, y: 20))
    path.addArc(withCenter: CGPoint(x: 10, y: 20), radius: 6, startAngle: .pi, endAngle: 1.5 * .pi, clockwise: true)
    path.addLine(to: CGPoint(x: 14, y: 14))
    path.addArc(withCenter: CGPoint(x: 14, y: 20), radius: 6, startAngle: 1.5 * .pi, endAngle: 2 * .pi, clockwise: true)
    path.addLine(to: CGPoint(x: 20, y: 21))
    return path
  }

  private static func group() -> UIBezierPath {
    let lean = 75.5 * CGFloat.pi / 180
    let path = UIBezierPath(arcCenter: CGPoint(x: 9, y: 7), radius: 4, startAngle: 0, endAngle: 2 * .pi, clockwise: true)
    path.move(to: CGPoint(x: 16, y: 21))
    path.addLine(to: CGPoint(x: 16, y: 19))
    path.addArc(withCenter: CGPoint(x: 12, y: 19), radius: 4, startAngle: 0, endAngle: 1.5 * .pi, clockwise: false)
    path.addLine(to: CGPoint(x: 6, y: 15))
    path.addArc(withCenter: CGPoint(x: 6, y: 19), radius: 4, startAngle: 1.5 * .pi, endAngle: .pi, clockwise: false)
    path.addLine(to: CGPoint(x: 2, y: 21))
    path.move(to: CGPoint(x: 22, y: 21))
    path.addLine(to: CGPoint(x: 22, y: 19))
    path.addArc(withCenter: CGPoint(x: 18, y: 19), radius: 4, startAngle: 0, endAngle: -lean, clockwise: false)
    path.move(to: CGPoint(x: 16, y: 3.13))
    path.addArc(withCenter: CGPoint(x: 15, y: 7), radius: 4, startAngle: -lean, endAngle: lean, clockwise: true)
    return path
  }
}

// A rounded box drawn behind a range, `pad` wider at each end: equal by
// value, so the storage keeps one attribute run across the JS runs of one
// pill.
final class FillBox: NSObject {
  let id: Int
  let color: UIColor
  let pad: CGFloat
  init(id: Int, color: UIColor, pad: CGFloat) {
    self.id = id
    self.color = color
    self.pad = pad
  }
  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? FillBox else { return false }
    return other.id == id && other.color == color && other.pad == pad
  }
  override var hash: Int { id }
}

final class LinkBox: NSObject {
  let id: Int
  let url: String
  let hidden: Bool
  init(id: Int, url: String, hidden: Bool) {
    self.id = id
    self.url = url
    self.hidden = hidden
  }
  // Every field: Foundation uniques attribute dictionaries by equality,
  // across strings, so a box equal by id alone came back as another
  // message's link (its URL and hidden flag) in the same styling.
  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? LinkBox else { return false }
    return other.id == id && other.url == url && other.hidden == hidden
  }
  override var hash: Int { id }
}

extension NSAttributedString.Key {
  static let stoopFill = NSAttributedString.Key("StoopFill")
  static let stoopSpoiler = NSAttributedString.Key("StoopSpoiler")
  static let stoopCovered = NSAttributedString.Key("StoopCovered")
  static let stoopLink = NSAttributedString.Key("StoopLink")
}

// Draws the rounded boxes: spoiler fills first, pills and code on top,
// each the run font's content height (ascender to descender, as CSS draws
// an inline background) and its pad wider on each end. The padding's room
// is kerning on the character before a box (or, at a line's start, the
// container's indent) and on its last character.
class RichLayoutManager: NSLayoutManager {
  var radius: CGFloat = 4

  override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
    super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
    guard let storage = textStorage, let container = textContainers.first else { return }
    let chars = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
    for key in [NSAttributedString.Key.stoopSpoiler, .stoopFill] {
      storage.enumerateAttribute(key, in: chars) { value, range, _ in
        guard let box = value as? FillBox else { return }
        box.color.setFill()
        for rect in boxRects(forCharacterRange: range, pad: box.pad, in: container) {
          UIBezierPath(roundedRect: rect.offsetBy(dx: origin.x, dy: origin.y), cornerRadius: radius).fill()
        }
      }
    }
  }

  // One rect per line the range is on.
  func boxRects(forCharacterRange range: NSRange, pad: CGFloat, in container: NSTextContainer) -> [CGRect] {
    guard let storage = textStorage else { return [] }
    let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
    var rects: [CGRect] = []
    enumerateLineFragments(forGlyphRange: glyphs) { fragment, _, _, lineGlyphs, _ in
      let part = NSIntersectionRange(glyphs, lineGlyphs)
      guard part.length > 0 else { return }
      var bounds = self.boundingRect(forGlyphRange: part, in: container)
      let charIndex = self.characterIndexForGlyph(at: part.location)
      let font = storage.attribute(.font, at: charIndex, effectiveRange: nil) as? UIFont ?? UIFont.systemFont(ofSize: 15)
      // location(forGlyphAt:) already carries the baseline offset.
      let baseline = fragment.minY + self.location(forGlyphAt: part.location).y
      // The box starts pad before its first glyph when it starts on this
      // line; its last character's kerning is already inside the bounds.
      if part.location == glyphs.location { bounds.origin.x -= pad; bounds.size.width += pad }
      bounds.origin.y = baseline - font.ascender
      bounds.size.height = font.ascender - font.descender
      rects.append(bounds)
    }
    return rects
  }
}

// Indents a line that starts with a box by the box's padding, as a browser
// lays out an inline box's padding, so the box starts at the margin rather
// than hanging into it. A box carried over from the line before starts
// flush, as a browser slices one.
final class RichTextContainer: NSTextContainer {
  override var isSimpleRectangularTextContainer: Bool { false }

  override func lineFragmentRect(
    forProposedRect proposedRect: CGRect,
    at characterIndex: Int,
    writingDirection baseWritingDirection: NSWritingDirection,
    remaining remainingRect: UnsafeMutablePointer<CGRect>?
  ) -> CGRect {
    var rect = super.lineFragmentRect(
      forProposedRect: proposedRect, at: characterIndex,
      writingDirection: baseWritingDirection, remaining: remainingRect)
    if let storage = layoutManager?.textStorage {
      let indent = startingPad(storage, at: characterIndex)
      rect.origin.x += indent
      rect.size.width -= indent
    }
    return rect
  }

  // The widest pad of the boxes that start at a character.
  private func startingPad(_ storage: NSTextStorage, at index: Int) -> CGFloat {
    guard index < storage.length else { return 0 }
    var pad: CGFloat = 0
    for key in [NSAttributedString.Key.stoopSpoiler, .stoopFill] {
      guard let box = storage.attribute(key, at: index, effectiveRange: nil) as? FillBox else { continue }
      let before = index == 0 ? nil : storage.attribute(key, at: index - 1, effectiveRange: nil) as? FillBox
      if before != box { pad = max(pad, box.pad) }
    }
    return pad
  }
}

// The paragraph laid out at a width: the same code measures (the module's
// measure function, on the JS thread) and draws (RichTextView).
final class RichLayout {
  let storage: NSTextStorage
  let manager: RichLayoutManager
  let container: RichTextContainer
  let width: CGFloat
  // How far outside a glyph a tap still counts: past the widest box's pad.
  private let slop: CGFloat

  init(doc: RichDoc, width: CGFloat) {
    self.width = width
    slop = CGFloat(doc.runs.reduce(doc.spoilerPad) { max($0, $1.fillPad) }) + 2
    storage = NSTextStorage(attributedString: RichLayout.attributed(doc))
    manager = RichLayoutManager()
    manager.radius = CGFloat(doc.radius)
    manager.usesFontLeading = false
    container = RichTextContainer(size: CGSize(width: max(1, width), height: .greatestFiniteMagnitude))
    container.lineFragmentPadding = 0
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)
    manager.ensureLayout(for: container)
  }

  var height: CGFloat {
    ceil(manager.usedRect(for: container).height)
  }

  func draw() {
    let glyphs = manager.glyphRange(for: container)
    manager.drawBackground(forGlyphRange: glyphs, at: .zero)
    manager.drawGlyphs(forGlyphRange: glyphs, at: .zero)
  }

  // The character under a point in the view, if a glyph (or a box's
  // padding) is there.
  func characterIndex(at point: CGPoint) -> Int? {
    var fraction: CGFloat = 0
    let glyph = manager.glyphIndex(for: point, in: container, fractionOfDistanceThroughGlyph: &fraction)
    guard glyph < manager.numberOfGlyphs else { return nil }
    let rect = manager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container)
    guard rect.insetBy(dx: -slop, dy: -2).contains(point) else { return nil }
    return manager.characterIndexForGlyph(at: glyph)
  }

  // Rects, in view space, for a character range: one per line.
  func rects(forCharacterRange range: NSRange) -> [CGRect] {
    manager.boxRects(forCharacterRange: range, pad: 0, in: container)
  }

  static func font(_ run: RichRun) -> UIFont {
    let size = CGFloat(run.size)
    var font: UIFont
    if run.mono {
      font = UIFont(name: "Menlo", size: size) ?? UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
      if run.weight >= 600, let bold = font.fontDescriptor.withSymbolicTraits(.traitBold) {
        font = UIFont(descriptor: bold, size: size)
      }
    } else {
      let weight: UIFont.Weight = run.weight >= 700 ? .bold : run.weight >= 600 ? .semibold : .regular
      font = UIFont.systemFont(ofSize: size, weight: weight)
    }
    if run.italic, let italic = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic)) {
      font = UIFont(descriptor: italic, size: size)
    }
    return font
  }

  static func attributed(_ doc: RichDoc) -> NSAttributedString {
    let out = NSMutableAttributedString()
    let lineHeight = CGFloat(doc.lineHeight)
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
    paragraph.lineBreakMode = .byWordWrapping
    // As React Native does: the line's extra height split above and below
    // the body font, one offset for the whole paragraph.
    let body = UIFont.systemFont(ofSize: CGFloat(doc.bodySize))
    let baselineOffset = max(0, (lineHeight - body.lineHeight) / 2)

    for run in doc.runs {
      var attrs: [NSAttributedString.Key: Any] = [
        .font: font(run),
        .paragraphStyle: paragraph,
        .baselineOffset: baselineOffset,
      ]
      if let color = run.covered ? UIColor.clear : (run.color ?? doc.textColor) {
        attrs[.foregroundColor] = color
      }
      if run.underline { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
      if run.strike { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
      if let fill = run.fill, let id = run.fillId {
        attrs[.stoopFill] = FillBox(id: id, color: fill, pad: CGFloat(run.fillPad))
      }
      if let id = run.spoiler, let fill = run.spoilerFill {
        attrs[.stoopSpoiler] = FillBox(id: id, color: fill, pad: CGFloat(doc.spoilerPad))
        if run.covered { attrs[.stoopCovered] = id }
      }
      if let link = run.link, let id = run.linkId {
        attrs[.stoopLink] = LinkBox(id: id, url: link, hidden: run.linkHidden)
      }
      if let kind = run.glyph {
        // A word joiner first, so the mark never wraps away from the
        // handle it follows.
        out.append(NSAttributedString(string: "\u{2060}", attributes: attrs))
        let color = (attrs[.foregroundColor] as? UIColor) ?? .label
        let mark = NSMutableAttributedString(attachment: MentionGlyph.attachment(kind, size: CGFloat(run.size), color: color))
        mark.addAttributes(attrs, range: NSRange(location: 0, length: mark.length))
        out.append(mark)
        continue
      }
      out.append(NSAttributedString(string: run.text, attributes: attrs))
    }

    // Room for each box's padding: kerning on the character before it
    // (when one is on the same line) and on its last character.
    let whole = NSRange(location: 0, length: out.length)
    let text = out.string as NSString
    for key in [NSAttributedString.Key.stoopSpoiler, .stoopFill] {
      out.enumerateAttribute(key, in: whole) { value, range, _ in
        guard let box = value as? FillBox else { return }
        if range.location > 0, text.character(at: range.location - 1) != 10 {
          let before = text.rangeOfComposedCharacterSequence(at: range.location - 1)
          let kern = (out.attribute(.kern, at: before.location, effectiveRange: nil) as? CGFloat) ?? 0
          out.addAttribute(.kern, value: kern + box.pad, range: before)
        }
        let last = text.rangeOfComposedCharacterSequence(at: NSMaxRange(range) - 1)
        let kern = (out.attribute(.kern, at: last.location, effectiveRange: nil) as? CGFloat) ?? 0
        out.addAttribute(.kern, value: kern + box.pad, range: last)
      }
    }
    return out
  }
}
