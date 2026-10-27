import UIKit

// What a line's block draws under the words: a code block's box, a
// quote's bar, a list item's bullet or number (Blocks.runs, Blocks.marker
// say which; this finds where each line was laid out). The boxes behind
// words (inline code, pills, spoilers) are RichLayoutManager's, drawn on
// top. Nothing here is text, so the caret and selection never meet it.
final class EditorLayoutManager: RichLayoutManager {
  var styler: EditorStyler?

  override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
    if let storage = textStorage, let container = textContainers.first, let styler = styler {
      drawBlocks(storage, container, styler.style, origin)
    }
    super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
  }

  private struct Line {
    let block: BlockBox
    let rect: CGRect
    let baseline: CGFloat
  }

  // Every line with its block and where it was laid out. A composer holds
  // a few thousand characters at most, so the whole text is walked.
  private func laidOutLines(_ storage: NSTextStorage) -> [Line] {
    var lines: [Line] = []
    Document.forEachLine(storage.string as NSString) { range, _ in
      guard range.length > 0 else { return }
      let block = Blocks.at(storage, line: range)
      guard block.block != .paragraph else {
        lines.append(Line(block: block, rect: .zero, baseline: 0))
        return
      }
      let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
      var rect = CGRect.null
      var baseline: CGFloat = 0
      enumerateLineFragments(forGlyphRange: glyphs) { fragment, _, _, lineGlyphs, _ in
        if rect.isNull { baseline = fragment.minY + self.location(forGlyphAt: lineGlyphs.location).y }
        rect = rect.union(fragment)
      }
      lines.append(Line(block: block, rect: rect, baseline: baseline))
    }
    return lines
  }

  private func drawBlocks(_ storage: NSTextStorage, _ container: NSTextContainer, _ style: EditorStyleRecord, _ origin: CGPoint) {
    let lines = laidOutLines(storage)
    let blocks = lines.map(\.block)
    let width = container.size.width
    for run in Blocks.runs(blocks) {
      let rect = lines[run.first...run.last].reduce(CGRect.null) { $0.union($1.rect) }
      guard !rect.isNull else { continue }
      switch run.kind {
      case .code:
        let box = CGRect(x: 0, y: rect.minY, width: width, height: rect.height).offsetBy(dx: origin.x, dy: origin.y)
        let path = UIBezierPath(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), cornerRadius: CGFloat(style.radius) + 2)
        style.raised.setFill()
        path.fill()
        style.border.setStroke()
        path.lineWidth = 1
        path.stroke()
      case .quote:
        style.border.setFill()
        UIRectFill(CGRect(x: origin.x, y: rect.minY + origin.y, width: CGFloat(style.quoteBarWidth), height: rect.height))
      default:
        break
      }
    }
    let font = UIFont.monospacedDigitSystemFont(ofSize: CGFloat(style.fontSize), weight: .regular)
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: style.mutedColor]
    for (index, line) in lines.enumerated() {
      guard let marker = Blocks.marker(blocks, at: index) else { continue }
      // Right-aligned in the indent, on the line's baseline.
      let size = (marker as NSString).size(withAttributes: attrs)
      let indent = CGFloat(style.listIndent) * CGFloat(line.block.depth + 1)
      let point = CGPoint(x: indent - 6 - size.width + origin.x, y: line.baseline - font.ascender + origin.y)
      (marker as NSString).draw(at: point, withAttributes: attrs)
    }
  }
}
