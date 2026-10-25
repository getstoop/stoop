import ExpoModulesCore
import UIKit

// The paragraph's element for a screen reader: the whole view, read as the
// doc's label; double tap reveals the first covered spoiler.
final class ParagraphElement: UIAccessibilityElement {
  var onActivate: (() -> Bool)?
  override func accessibilityActivate() -> Bool {
    onActivate?() ?? false
  }
}

// A link or channel pill's element: its words, over its rects.
final class LinkElement: UIAccessibilityElement {
  var onActivate: (() -> Void)?
  override func accessibilityActivate() -> Bool {
    onActivate?()
    return true
  }
}

// A message's paragraph drawn with TextKit (RichLayout). Its height is
// set from JS, which measured the same doc at the same width
// (StoopRichTextModule.measure). Taps on a link or a covered spoiler go
// back to JS. A long press is left to React Native's row, which keeps
// receiving the touch (RCTSurfaceTouchHandler is never prevented by a
// descendant's recognizer); the view's own long press recognizer only
// stops a tap firing after one.
final class RichTextView: ExpoView, UIGestureRecognizerDelegate {
  let onPressLink = EventDispatcher()
  let onReveal = EventDispatcher()

  var doc: RichDoc? {
    didSet {
      layout = nil
      setNeedsDisplay()
      setNeedsLayout()
    }
  }

  private var layout: RichLayout?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isOpaque = false
    contentMode = .redraw
    clipsToBounds = false
    isAccessibilityElement = false

    let hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
    hold.minimumPressDuration = 0.5
    hold.cancelsTouchesInView = false
    hold.delegate = self
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.require(toFail: hold)
    tap.delegate = self
    addGestureRecognizer(hold)
    addGestureRecognizer(tap)
  }

  private func currentLayout() -> RichLayout? {
    guard let doc = doc, bounds.width > 0 else { return nil }
    if let layout = layout, abs(layout.width - bounds.width) < 0.5 {
      return layout
    }
    let fresh = RichLayout(doc: doc, width: bounds.width)
    layout = fresh
    return fresh
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    rebuildAccessibility()
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    currentLayout()?.draw()
  }

  // MARK: Touch

  // What a tap at a point would do: reveal a covered spoiler (innermost
  // first, as a spoiler in a link's words takes the tap), or open a link.
  private enum Target {
    case reveal(Int)
    case link(String)
  }

  private func target(at point: CGPoint) -> Target? {
    guard let layout = currentLayout(), let index = layout.characterIndex(at: point) else { return nil }
    let storage = layout.storage
    if let id = storage.attribute(.stoopCovered, at: index, effectiveRange: nil) as? Int {
      return .reveal(id)
    }
    if let link = storage.attribute(.stoopLink, at: index, effectiveRange: nil) as? LinkBox {
      return .link(link.url)
    }
    return nil
  }

  override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    if recognizer is UITapGestureRecognizer {
      return target(at: recognizer.location(in: self)) != nil
    }
    return true
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }

  // Nothing to do: the row's own long press (React Native) answers it.
  @objc private func held(_ recognizer: UILongPressGestureRecognizer) {}

  @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    switch target(at: recognizer.location(in: self)) {
    case .reveal(let id): onReveal(["id": id])
    case .link(let url): onPressLink(["url": url])
    case nil: break
    }
  }

  // MARK: Accessibility

  private func rebuildAccessibility() {
    guard let doc = doc, let layout = currentLayout() else {
      accessibilityElements = nil
      return
    }
    let paragraph = ParagraphElement(accessibilityContainer: self)
    paragraph.accessibilityLabel = doc.label
    paragraph.accessibilityTraits = .staticText
    paragraph.accessibilityFrameInContainerSpace = bounds
    let storage = layout.storage
    paragraph.onActivate = { [weak self] in
      var first: Int?
      storage.enumerateAttribute(.stoopCovered, in: NSRange(location: 0, length: storage.length)) { value, _, stop in
        if let id = value as? Int { first = id; stop.pointee = true }
      }
      guard let id = first else { return false }
      self?.onReveal(["id": id])
      return true
    }
    var elements: [Any] = [paragraph]

    storage.enumerateAttribute(.stoopLink, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
      guard let link = value as? LinkBox, !link.hidden else { return }
      let rects = layout.rects(forCharacterRange: range)
      guard var frame = rects.first else { return }
      for rect in rects.dropFirst() { frame = frame.union(rect) }
      let element = LinkElement(accessibilityContainer: self)
      element.accessibilityLabel = storage.attributedSubstring(from: range).string
      element.accessibilityTraits = .link
      element.accessibilityFrameInContainerSpace = frame
      let url = link.url
      element.onActivate = { [weak self] in self?.onPressLink(["url": url]) }
      elements.append(element)
    }
    accessibilityElements = elements
  }
}
