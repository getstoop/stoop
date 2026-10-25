import ExpoModulesCore
import UIKit

// The paragraph's element for a screen reader: the whole view, read as the
// doc's label; double tap reveals the first covered spoiler. With none
// covered a double tap does nothing, rather than iOS tapping the
// element's middle, which may be a link.
final class ParagraphElement: UIAccessibilityElement {
  var onActivate: (() -> Void)?

  override func accessibilityActivate() -> Bool {
    onActivate?()
    return true
  }
}

// A link or channel pill's element: its words, over its rect on each line
// (the path, in screen space, worked out when asked: the view may have
// scrolled), so a link that wraps covers its words and not both lines.
final class LinkElement: UIAccessibilityElement {
  var onActivate: (() -> Void)?
  weak var view: UIView?
  var rects: [CGRect] = []

  override func accessibilityActivate() -> Bool {
    onActivate?()
    return true
  }

  override var accessibilityPath: UIBezierPath? {
    get {
      guard let view = view else { return nil }
      let path = UIBezierPath()
      for rect in rects { path.append(UIBezierPath(rect: rect)) }
      return UIAccessibility.convertToScreenCoordinates(path, in: view)
    }
    set {}
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
  // The layout the accessibility elements were built from.
  private var accessible: RichLayout?
  // A reveal was asked for: once its doc arrives, a screen reader stays
  // on the message and reads the words revealed.
  private var revealing = false

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

  // Laid out again at any other width, however small the difference, so
  // a line is never cut off at a fractional width.
  private func currentLayout() -> RichLayout? {
    guard let doc = doc, bounds.width > 0 else { return nil }
    if let layout = layout, layout.width == bounds.width {
      return layout
    }
    let fresh = RichLayout(doc: doc, width: bounds.width)
    layout = fresh
    return fresh
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let current = currentLayout()
    if current !== accessible {
      rebuildAccessibility()
    }
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    currentLayout()?.draw()
  }

  private func reveal(_ id: Int) {
    guard doc?.revealable ?? false else { return }
    revealing = true
    onReveal(["id": id])
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
      // Covered words are no link either, so in the card they take nothing.
      guard doc?.revealable ?? false else { return nil }
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
    case .reveal(let id): reveal(id)
    case .link(let url): onPressLink(["url": url])
    case nil: break
    }
  }

  // MARK: Accessibility

  // A link element for each link and channel pill, then the paragraph.
  // Touching a point finds the first element there, so the links come
  // first or a touch on one would find the paragraph; swiping meets them
  // before the paragraph too.
  private func rebuildAccessibility() {
    accessible = layout
    guard let doc = doc, let layout = layout else {
      accessibilityElements = nil
      return
    }
    let storage = layout.storage
    let whole = NSRange(location: 0, length: storage.length)

    let paragraph = ParagraphElement(accessibilityContainer: self)
    paragraph.accessibilityLabel = doc.label
    paragraph.accessibilityTraits = .staticText
    paragraph.accessibilityFrameInContainerSpace = bounds
    paragraph.onActivate = { [weak self] in
      var first: Int?
      storage.enumerateAttribute(.stoopCovered, in: whole) { value, _, stop in
        if let id = value as? Int { first = id; stop.pointee = true }
      }
      if let id = first { self?.reveal(id) }
    }
    var elements: [Any] = []

    storage.enumerateAttribute(.stoopLink, in: whole) { value, range, _ in
      guard let link = value as? LinkBox, !link.hidden else { return }
      let rects = layout.rects(forCharacterRange: range)
      guard var frame = rects.first else { return }
      for rect in rects.dropFirst() { frame = frame.union(rect) }
      let element = LinkElement(accessibilityContainer: self)
      element.view = self
      element.rects = rects
      element.accessibilityLabel = storage.attributedSubstring(from: range).string
      element.accessibilityTraits = .link
      element.accessibilityFrameInContainerSpace = frame
      let url = link.url
      element.onActivate = { [weak self] in self?.onPressLink(["url": url]) }
      elements.append(element)
    }
    accessibilityElements = elements + [paragraph]

    if revealing {
      revealing = false
      UIAccessibility.post(notification: .layoutChanged, argument: paragraph)
    }
  }
}
