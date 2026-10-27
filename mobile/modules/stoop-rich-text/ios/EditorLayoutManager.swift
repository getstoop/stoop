import UIKit

// The composer's layout: what RichLayoutManager draws behind words
// (inline code, pills, spoilers), and under it what a line's block draws:
// a code block's box, a quote's bar, a list item's bullet or number. The
// blocks are in the text as paragraph attributes (BlockBox); nothing here
// is text, so the caret and selection never meet it.
final class EditorLayoutManager: RichLayoutManager {
  var styler: EditorStyler?

  override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
    if let storage = textStorage, let container = textContainers.first, let styler = styler {
      drawBlocks(storage, container, styler.style, origin)
    }
    super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
  }

  private struct Line {
    let range: NSRange
    let block: BlockBox
    var rect: CGRect
    var firstFragment: CGRect
    var baseline: CGFloat
  }

  // Every line with its block and where it was laid out. A composer holds
  // a few thousand characters at most, so the whole text is walked.
  private func laidOutLines(_ storage: NSTextStorage) -> [Line] {
    let string = storage.string as NSString
    var lines: [Line] = []
    var location = 0
    while location < string.length {
      let range = string.lineRange(for: NSRange(location: location, length: 0))
      location = NSMaxRange(range)
      let block = (storage.attribute(.editorBlock, at: range.location, effectiveRange: nil) as? BlockBox) ?? .paragraph
      guard block.block != .paragraph else {
        lines.append(Line(range: range, block: block, rect: .zero, firstFragment: .zero, baseline: 0))
        continue
      }
      let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
      var rect = CGRect.null
      var first = CGRect.null
      var baseline: CGFloat = 0
      enumerateLineFragments(forGlyphRange: glyphs) { fragment, _, _, lineGlyphs, _ in
        if first.isNull {
          first = fragment
          baseline = fragment.minY + self.location(forGlyphAt: lineGlyphs.location).y
        }
        rect = rect.union(fragment)
      }
      lines.append(Line(range: range, block: block, rect: rect, firstFragment: first, baseline: baseline))
    }
    // A last line ending in "\n" has an empty line after it, laid out as
    // the extra fragment, in the typing attributes' block.
    if string.length == 0 || string.character(at: string.length - 1) == 10, !extraLineFragmentRect.isEmpty,
      let block = (extraLineFragmentTextContainer as? EditorTextContainer)?.trailingBlock, block.block != .paragraph {
      let rect = extraLineFragmentRect
      let font = UIFont.systemFont(ofSize: 17)
      lines.append(Line(
        range: NSRange(location: string.length, length: 0), block: block, rect: rect, firstFragment: rect,
        baseline: rect.minY + (rect.height + font.capHeight) / 2))
    }
    return lines
  }

  private func drawBlocks(_ storage: NSTextStorage, _ container: NSTextContainer, _ style: EditorStyleRecord, _ origin: CGPoint) {
    let lines = laidOutLines(storage)
    let width = container.size.width
    var index = 0
    while index < lines.count {
      let line = lines[index]
      switch line.block.block {
      case .code:
        // One box for the lines of one code block.
        var end = index + 1
        var rect = line.rect
        while end < lines.count, lines[end].block.block == .code, lines[end].block.group == line.block.group {
          rect = rect.union(lines[end].rect)
          end += 1
        }
        let box = CGRect(x: 0, y: rect.minY, width: width, height: rect.height).offsetBy(dx: origin.x, dy: origin.y)
        let path = UIBezierPath(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), cornerRadius: CGFloat(style.radius) + 2)
        style.raised.setFill()
        path.fill()
        style.border.setStroke()
        path.lineWidth = 1
        path.stroke()
        index = end
        continue
      case .quote:
        var end = index + 1
        var rect = line.rect
        while end < lines.count, lines[end].block.block == .quote {
          rect = rect.union(lines[end].rect)
          end += 1
        }
        style.border.setFill()
        UIRectFill(CGRect(x: origin.x, y: rect.minY + origin.y, width: CGFloat(style.quoteBarWidth), height: rect.height))
        index = end
        continue
      case .bullet, .ordered:
        drawMarker(lines, index, style, origin)
      case .paragraph:
        break
      }
      index += 1
    }
  }

  // A bullet by level (•, ◦, ▪), or the item's number counted among the
  // items before it at its level, right-aligned in the indent.
  private func drawMarker(_ lines: [Line], _ index: Int, _ style: EditorStyleRecord, _ origin: CGPoint) {
    let line = lines[index]
    let marker: String
    if line.block.block == .ordered {
      var number = 1
      var back = index - 1
      while back >= 0, lines[back].block.block.isList, lines[back].block.depth >= line.block.depth {
        if lines[back].block.depth == line.block.depth {
          guard lines[back].block.block == .ordered else { break }
          number += 1
        }
        back -= 1
      }
      marker = "\(number)."
    } else {
      marker = ["•", "◦", "▪", "•"][min(line.block.depth, 3)]
    }
    let font = UIFont.monospacedDigitSystemFont(ofSize: CGFloat(style.fontSize), weight: .regular)
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: style.mutedColor]
    let size = (marker as NSString).size(withAttributes: attrs)
    let indent = CGFloat(style.listIndent) * CGFloat(line.block.depth + 1)
    let x = indent - 6 - size.width
    let y = line.baseline - font.ascender
    (marker as NSString).draw(at: CGPoint(x: x + origin.x, y: y + origin.y), withAttributes: attrs)
  }
}

// Remembers the block of an empty last line, which has no character to
// carry it, so the layout can draw its bullet or bar.
final class EditorTextContainer: NSTextContainer {
  var trailingBlock: BlockBox?
}
