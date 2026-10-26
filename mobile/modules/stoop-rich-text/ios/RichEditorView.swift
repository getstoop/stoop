import ExpoModulesCore
import UIKit

// The composer's field: a UITextView that holds the draft as text with its
// meaning (EditorModel) and draws it formatted (EditorStyler,
// EditorLayoutManager). Typing never waits on JS: the view tells JS what
// the text now is (onEditorChange, as lines, which core turns into
// Markdown), and JS asks it to do things (the functions in
// StoopRichTextModule). TextKit 1, so the blocks and boxes are drawn by
// the same layout manager as the timeline's.
final class RichEditorView: ExpoView, UITextViewDelegate, NSTextStorageDelegate {
  let onEditorChange = EventDispatcher()
  let onEditorSelection = EventDispatcher()
  let onEditorHeight = EventDispatcher()
  let onEditorFocus = EventDispatcher()
  let onEditorBlur = EventDispatcher()

  let styler = EditorStyler()
  let storage = NSTextStorage()
  let layout = EditorLayoutManager()
  let container = EditorTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
  let textView: UITextView
  private let placeholderLabel = UILabel()

  var autoFocus = false
  private var focusedOnce = false
  private var lastHeight: CGFloat = 0
  // The block of an empty last line, which no character holds: one the
  // text was loaded with (or a command set), until the line has words.
  var explicitTrailing: BlockBox?
  private var loadedRevision = -1

  required init(appContext: AppContext? = nil) {
    layout.styler = styler
    container.widthTracksTextView = true
    container.lineFragmentPadding = 0
    layout.usesFontLeading = false
    layout.addTextContainer(container)
    storage.addLayoutManager(layout)
    textView = UITextView(frame: .zero, textContainer: container)
    super.init(appContext: appContext)

    storage.delegate = self
    textView.delegate = self
    textView.backgroundColor = .clear
    textView.textContainerInset = UIEdgeInsets(top: 11, left: 10, bottom: 8, right: 10)
    textView.font = styler.bodyFont
    textView.typingAttributes = styler.look(for: [.editorBlock: BlockBox.paragraph])
    textView.allowsEditingTextAttributes = false
    textView.isScrollEnabled = true
    textView.alwaysBounceVertical = false
    addSubview(textView)

    placeholderLabel.numberOfLines = 1
    placeholderLabel.isAccessibilityElement = false
    addSubview(placeholderLabel)
  }

  // MARK: Props

  func setStyle(_ style: EditorStyleRecord) {
    styler.style = style
    textView.tintColor = style.accentColor
    placeholderLabel.textColor = style.placeholderColor
    placeholderLabel.font = styler.bodyFont
    restyleAll()
    textView.typingAttributes = styler.look(for: meaning(at: textView.selectedRange.location))
  }

  var placeholder: String = "" {
    didSet {
      placeholderLabel.text = placeholder
      setNeedsLayout()
    }
  }

  var label: String = "" {
    didSet { textView.accessibilityLabel = label }
  }

  var fieldId: String = "" {
    didSet { textView.accessibilityIdentifier = fieldId }
  }

  // MARK: Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
    let inset = textView.textContainerInset
    placeholderLabel.frame = CGRect(
      x: inset.left, y: inset.top, width: max(0, bounds.width - inset.left - inset.right),
      height: CGFloat(styler.style.lineHeight))
    updatePlaceholder()
    reportHeight()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, autoFocus, !focusedOnce {
      focusedOnce = true
      DispatchQueue.main.async { [weak self] in self?.textView.becomeFirstResponder() }
    }
  }

  private func reportHeight() {
    guard bounds.width > 0 else { return }
    let height = ceil(textView.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
    if abs(height - lastHeight) >= 0.5 {
      lastHeight = height
      onEditorHeight(["height": height])
    }
  }

  private func updatePlaceholder() {
    placeholderLabel.isHidden = storage.length > 0 || textView.markedTextRange != nil
  }

  // MARK: Meaning at the caret

  // The block of an empty last line: one set explicitly, else the block of
  // the line before it (a Return carried it over).
  func trailingBlock() -> BlockBox? {
    let string = storage.string as NSString
    guard string.length == 0 || string.character(at: string.length - 1) == 10 else { return nil }
    if let explicit = explicitTrailing { return explicit }
    guard string.length > 0 else { return nil }
    return storage.attribute(.editorBlock, at: string.length - 1, effectiveRange: nil) as? BlockBox
  }

  // What text typed at a position would mean: its line's block, and the
  // marks and link of the character before it on the line. Never a
  // mention (a pill is one unit), and never a link from its end (typing
  // after a link isn't linked).
  func meaning(at location: Int) -> [NSAttributedString.Key: Any] {
    let string = storage.string as NSString
    let at = min(location, string.length)
    var meaning: [NSAttributedString.Key: Any] = [:]
    let line = string.lineRange(for: NSRange(location: at, length: 0))
    if line.length > 0 {
      meaning[.editorBlock] = storage.attribute(.editorBlock, at: line.location, effectiveRange: nil) ?? BlockBox.paragraph
    } else {
      meaning[.editorBlock] = trailingBlock() ?? BlockBox.paragraph
    }
    if at > line.location {
      let before = storage.attributes(at: at - 1, effectiveRange: nil)
      if let marks = before[.editorMarks] { meaning[.editorMarks] = marks }
      if let href = before[.editorHref] as? String, at < string.length,
        storage.attribute(.editorHref, at: at, effectiveRange: nil) as? String == href {
        meaning[.editorHref] = href
      }
    }
    return meaning
  }

  // MARK: Text changes

  func textStorage(
    _ textStorage: NSTextStorage, didProcessEditing editedMask: NSTextStorage.EditActions,
    range editedRange: NSRange, changeInLength delta: Int
  ) {
    guard editedMask.contains(.editedCharacters) else { return }
    let string = textStorage.string as NSString
    let lines = string.lineRange(for: NSIntersectionRange(editedRange, NSRange(location: 0, length: string.length)))
    EditorDocument.dropBrokenMentions(textStorage, in: lines)
    styler.restyle(textStorage, lines: editedRange)
  }

  // Lines end in "\n" only: a pasted "\r", or a line or paragraph
  // separator, is put in as one, so both platforms read the same lines.
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    guard text.contains(where: { $0 == "\r" || $0 == "\r\n" || $0 == "\u{2028}" || $0 == "\u{2029}" }) else { return true }
    let plain = text.replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .replacingOccurrences(of: "\u{2028}", with: "\n")
      .replacingOccurrences(of: "\u{2029}", with: "\n")
    guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let textRange = textView.textRange(from: start, to: end)
    else { return true }
    textView.replace(textRange, withText: plain)
    return false
  }

  func textViewDidChange(_ textView: UITextView) {
    let string = storage.string as NSString
    if string.length > 0, string.character(at: string.length - 1) != 10 { explicitTrailing = nil }
    updatePlaceholder()
    emitChange()
    reportHeight()
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    textView.typingAttributes = styler.look(for: meaning(at: textView.selectedRange.location))
    container.trailingBlock = trailingBlock()
    onEditorSelection(selectionPayload())
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onEditorFocus([:])
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    onEditorBlur([:])
  }

  private func selectionPayload() -> [String: Any] {
    let selected = textView.selectedRange
    return [
      // The document revision the text is from, so JS can drop a change
      // that was on its way when it loaded another.
      "revision": loadedRevision,
      "selection": ["start": selected.location, "end": NSMaxRange(selected)],
      "before": EditorDocument.textBefore(storage, at: selected.location),
      "formats": activeFormats(),
    ]
  }

  // MARK: Formats

  // The formats in effect, as web's toolbar names them (api/formatting
  // Format): at a caret, what typing would carry; over a selection, what
  // all of its words have. And the caret's line's block.
  func activeFormats() -> [String] {
    var formats: [String] = []
    let selected = textView.selectedRange
    let block = (meaning(at: selected.location)[.editorBlock] as? BlockBox) ?? .paragraph
    // A selection is "in a code block" only when none of it can take a
    // mark; one that runs out of a code block into words can.
    let inCode = selected.length == 0 ? block.block == .code : markable(selected).isEmpty
    if !inCode {
      let marks: EditorMarks
      if selected.length == 0 {
        marks = EditorMarks(rawValue: (textView.typingAttributes[.editorMarks] as? Int) ?? 0)
      } else {
        marks = commonMarks(in: selected)
      }
      formats += marks.names
    }
    switch block.block {
    case .quote: formats.append("quote")
    case .bullet: formats.append("list")
    case .ordered: formats.append("orderedList")
    case .code: if inCode { formats.append("codeblock") }
    case .paragraph: break
    }
    return formats
  }

  // The words of a range a mark can go on: not newlines, not code blocks.
  private func markable(_ range: NSRange) -> [NSRange] {
    let string = storage.string as NSString
    var out: [NSRange] = []
    var location = range.location
    while location < NSMaxRange(range) {
      let line = string.lineRange(for: NSRange(location: location, length: 0))
      var content = line
      if content.length > 0, string.character(at: NSMaxRange(content) - 1) == 10 { content.length -= 1 }
      let part = NSIntersectionRange(content, range)
      let block = (storage.attribute(.editorBlock, at: line.location, effectiveRange: nil) as? BlockBox) ?? .paragraph
      if part.length > 0, block.block != .code { out.append(part) }
      if NSMaxRange(line) <= location { break }
      location = NSMaxRange(line)
    }
    return out
  }

  private func commonMarks(in range: NSRange) -> EditorMarks {
    var common: EditorMarks?
    for part in markable(range) {
      storage.enumerateAttribute(.editorMarks, in: part) { value, _, _ in
        let marks = EditorMarks(rawValue: (value as? Int) ?? 0)
        common = common.map { $0.intersection(marks) } ?? marks
      }
    }
    return common ?? []
  }

  // A mark on or off: over a selection, on everywhere unless all of it
  // has it already (web's rule); at a caret, for what is typed next, until
  // the caret moves. Not in a code block, which holds no marks.
  func toggle(_ mark: EditorMarks) {
    let selected = textView.selectedRange
    if selected.length == 0 {
      var meaning = self.meaning(at: selected.location)
      guard (meaning[.editorBlock] as? BlockBox)?.block != .code else { return }
      var marks = EditorMarks(rawValue: (textView.typingAttributes[.editorMarks] as? Int) ?? 0)
      marks.formSymmetricDifference(mark)
      meaning[.editorMarks] = marks.isEmpty ? nil : marks.rawValue
      if let href = textView.typingAttributes[.editorHref] { meaning[.editorHref] = href }
      textView.typingAttributes = styler.look(for: meaning)
      onEditorSelection(selectionPayload())
      return
    }
    let parts = markable(selected)
    guard !parts.isEmpty else { return }
    let on = !commonMarks(in: selected).contains(mark)
    storage.beginEditing()
    for part in parts {
      storage.enumerateAttribute(.editorMarks, in: part) { value, run, _ in
        var marks = EditorMarks(rawValue: (value as? Int) ?? 0)
        if on { marks.insert(mark) } else { marks.remove(mark) }
        if marks.isEmpty {
          storage.removeAttribute(.editorMarks, range: run)
        } else {
          storage.addAttribute(.editorMarks, value: marks.rawValue, range: run)
        }
      }
      styler.restyle(storage, lines: part)
    }
    storage.endEditing()
    textView.selectedRange = selected
    emitChange()
  }

  func format(_ name: String) {
    if let mark = EditorMarks.named.first(where: { $0.0 == name })?.1 {
      toggle(mark)
    }
  }

  func linesJSON() -> [[String: Any]] {
    EditorDocument.lines(storage, trailing: trailingBlock())
  }

  func emitChange() {
    container.trailingBlock = trailingBlock()
    layout.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: storage.length))
    var payload = selectionPayload()
    payload["lines"] = linesJSON()
    onEditorChange(payload)
  }

  private func restyleAll() {
    storage.beginEditing()
    styler.restyle(storage, lines: NSRange(location: 0, length: storage.length))
    storage.endEditing()
    layout.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: storage.length))
  }

  // MARK: Commands from JS


  // The document prop: loaded once per revision, so a re-render with the
  // same one leaves what has been typed since alone.
  func setDocument(_ document: EditorDocumentRecord) {
    guard document.revision != loadedRevision else { return }
    loadedRevision = document.revision
    load(document.lines)
  }

  func load(_ lines: [EditorLineRecord]) {
    let text = EditorDocument.attributed(lines)
    // The keyboard is told, so its capitals and suggestions start afresh.
    textView.inputDelegate?.textWillChange(textView)
    defer { textView.inputDelegate?.textDidChange(textView) }
    storage.beginEditing()
    storage.setAttributedString(text)
    styler.restyle(storage, lines: NSRange(location: 0, length: storage.length))
    storage.endEditing()
    if let last = lines.last, last.runs.isEmpty, lines.count > 0 {
      explicitTrailing = BlockBox(
        EditorBlock(rawValue: last.block) ?? .paragraph, depth: last.depth, group: last.group, lang: last.lang)
    } else {
      explicitTrailing = nil
    }
    textView.selectedRange = NSRange(location: storage.length, length: 0)
    // The text view's undo would replay typing over text that is no longer
    // there.
    textView.undoManager?.removeAllActions()
    textViewDidChangeSelection(textView)
    updatePlaceholder()
    reportHeight()
  }

  func focus() {
    textView.becomeFirstResponder()
  }

  func blur() {
    textView.resignFirstResponder()
  }

  // The `count` characters before the caret (a mention query) replaced by
  // text, as if typed there.
  func replaceBeforeCaret(_ count: Int, _ text: String) {
    let caret = textView.selectedRange.location
    let string = storage.string as NSString
    let line = string.lineRange(for: NSRange(location: caret, length: 0))
    let from = max(line.location, caret - max(0, count))
    guard let start = textView.position(from: textView.beginningOfDocument, offset: from),
      let end = textView.position(from: textView.beginningOfDocument, offset: caret),
      let range = textView.textRange(from: start, to: end)
    else { return }
    textView.typingAttributes = styler.look(for: meaning(at: from))
    textView.replace(range, withText: text)
    textViewDidChange(textView)
  }

  // Any word still being composed (marked text) is taken as it stands,
  // and the lines returned, for a send.
  func commit() -> [[String: Any]] {
    if textView.markedTextRange != nil { textView.unmarkText() }
    return linesJSON()
  }
}
