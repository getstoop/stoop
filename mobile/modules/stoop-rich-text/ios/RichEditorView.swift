import ExpoModulesCore
import UIKit

// The composer's field: a UITextView whose text carries its meaning
// (EditorDocument and the features beside it) and is drawn formatted
// (EditorStyler, EditorDecorations). Typing never waits on JS: the view
// tells JS what the text now is (onEditorChange, as lines, which core
// turns into Markdown), and JS asks it to do things (the functions in
// StoopRichTextModule). This file is the wiring: what the text view
// reports comes in, each feature decides, and the edit is made here.
final class RichEditorView: ExpoView, UITextViewDelegate, NSTextStorageDelegate {
  let onEditorChange = EventDispatcher()
  let onEditorSelection = EventDispatcher()
  let onEditorHeight = EventDispatcher()
  let onEditorFocus = EventDispatcher()
  let onEditorBlur = EventDispatcher()
  let onEditorPaste = EventDispatcher()
  let onEditorCopy = EventDispatcher()
  let onEditorKey = EventDispatcher()

  let styler = EditorStyler()
  let storage = NSTextStorage()
  let layout = EditorLayoutManager()
  let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
  let textView: EditorTextView
  private let placeholderLabel = UILabel()

  var autoFocus = false
  private var focusedOnce = false
  private var lastHeight: CGFloat = 0
  private var loadedRevision = -1
  // Marks toggled at the caret, for what is typed next, and the caret
  // they were toggled at: moved away from, they are forgotten.
  private var caretMarks: (marks: Marks, at: Int)?
  // A typing shortcut just applied, the caret a character was just typed
  // at, where a paste lands once JS has read it, and what the link dialog
  // opened with.
  private var lastRule: TypedRule?
  private var typedAt: Int?
  private var pasteRange: NSRange?
  private var openLink: (draft: Links.Draft, length: Int)?
  // Every code block the field makes or takes in gets the next number, so
  // two never share a group by accident.
  private var codeGroups = 0

  required init(appContext: AppContext? = nil) {
    layout.styler = styler
    container.widthTracksTextView = true
    container.lineFragmentPadding = 0
    layout.usesFontLeading = false
    layout.addTextContainer(container)
    storage.addLayoutManager(layout)
    textView = EditorTextView(frame: .zero, textContainer: container)
    super.init(appContext: appContext)
    textView.editor = self

    storage.delegate = self
    textView.delegate = self
    textView.backgroundColor = .clear
    textView.textContainerInset = UIEdgeInsets(top: 11, left: 10, bottom: 8, right: 10)
    textView.font = styler.bodyFont
    textView.typingAttributes = styler.typing(block: .paragraph, marks: [], href: nil)
    textView.allowsEditingTextAttributes = false
    // A drag would hand the system the text's own attributes (blocks,
    // pills), which it can't carry; copy and paste carry Markdown instead.
    textView.textDragInteraction?.isEnabled = false
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
    refreshTyping()
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

  // The document prop: loaded once per revision, so a re-render with the
  // same one leaves what has been typed since alone.
  func setDocument(_ document: EditorDocumentRecord) {
    guard document.revision != loadedRevision else { return }
    loadedRevision = document.revision
    load(document.lines.map(\.line))
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

  // MARK: Edits the field makes itself

  private var string: NSString { storage.string as NSString }
  private var selection: NSRange { textView.selectedRange }

  // A change made outside typing: the keyboard is told, the storage is
  // edited as one, a holder left standing beside words comes out, every
  // line is settled and styled again, the caret goes where `body` says
  // (or stays, moved with the text), and the text view's undo (which
  // would replay typing over text that has moved) is cleared when
  // characters changed.
  private func edit(_ body: () -> Int?) {
    let before = storage.string
    textView.inputDelegate?.textWillChange(textView)
    storage.beginEditing()
    let wanted = body()
    var caret = wanted ?? selection.location
    var length = wanted == nil ? selection.length : 0
    while let stray = Blocks.holderFix(storage) {
      storage.replaceCharacters(in: stray, with: "")
      if stray.location < caret {
        caret -= 1
      } else if stray.location < caret + length {
        length -= 1
      }
    }
    restyleAll()
    storage.endEditing()
    textView.inputDelegate?.textDidChange(textView)
    if storage.string != before { clearUndo() }
    let at = max(0, min(caret, storage.length))
    textView.selectedRange = NSRange(location: at, length: min(length, storage.length - at))
    changed()
  }

  private func restyleAll() {
    let whole = NSRange(location: 0, length: storage.length)
    Document.settle(storage, edited: whole)
    styler.restyle(storage, lines: whole)
  }

  // Whether the text view reported the last replace as a change.
  private var reported = false

  // Through the text input, as if typed: the keyboard and undo see it.
  // Reported as a change once, whether or not the text view says so.
  private func replace(_ range: NSRange, with text: String) {
    guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
      let end = textView.position(from: start, offset: range.length),
      let textRange = textView.textRange(from: start, to: end)
    else { return }
    reported = false
    textView.replace(textRange, withText: text)
    if !reported { textViewDidChange(textView) }
  }

  private func clearUndo() {
    // Once UIKit has closed the undo group of the keystroke this may be
    // inside.
    DispatchQueue.main.async { [weak self] in self?.textView.undoManager?.removeAllActions() }
  }

  private func nextCodeGroup() -> Int {
    codeGroups += 1
    return 1_000_000 + codeGroups
  }

  // Lines from JS (a load, a paste): each code block gets a group of the
  // field's own, the same for the lines of one block.
  private func regrouper() -> (Int) -> Int {
    var fresh: [Int: Int] = [:]
    return { group in
      if let own = fresh[group] { return own }
      let own = self.nextCodeGroup()
      fresh[group] = own
      return own
    }
  }

  // MARK: Typing

  func textStorage(
    _ textStorage: NSTextStorage, didProcessEditing editedMask: NSTextStorage.EditActions,
    range editedRange: NSRange, changeInLength delta: Int
  ) {
    guard editedMask.contains(.editedCharacters) else { return }
    let touched = Document.settle(textStorage, edited: NSIntersectionRange(editedRange, NSRange(location: 0, length: textStorage.length)))
    styler.restyle(textStorage, lines: touched)
  }

  // Before the keyboard changes the text: what the features refuse or do
  // instead. Lines end in "\n" only; a pill is one unit; a block's
  // holder goes as words are typed beside it; Return and Backspace at a
  // block's edge change the block, not the text.
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    let caret = selection
    if let rule = lastRule {
      lastRule = nil
      if InputRules.undoes(rule, backspaceOver: range, caret: caret) {
        edit { InputRules.undo(storage, rule) }
        return false
      }
    }
    // A suggestion or correction for a pill's words (they look like a word
    // to the keyboard) would rewrite the pill: it is let go. So is one
    // over a whole pill (a prediction for "@priya").
    if range.length > 0, !text.isEmpty {
      if let pill = Mentions.pill(storage, around: range.location), range.location > pill.location { return false }
      if Mentions.isWholePill(storage, range) { return false }
    }
    let whole = Mentions.whole(storage, range)
    if whole != range {
      replace(whole, with: text)
      return false
    }
    if text.contains(where: { $0 == "\r" || $0 == "\r\n" || $0 == "\u{2028}" || $0 == "\u{2029}" }) {
      let plain = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        .replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: "\u{2029}", with: "\n")
      replace(range, with: plain)
      return false
    }
    let line = Document.line(string, at: range.location)
    if text == "\n", range.length == 0, caret.length == 0 {
      if let lines = Blocks.returnKey(storage, caret: caret.location) {
        setBlocks(lines)
        return false
      }
      // In a block, the newline carries the block, and a holder follows
      // it on a new last line.
      if let newline = Blocks.newline(storage, caret: caret.location) {
        replace(range, with: newline.string)
        return false
      }
    }
    if text.isEmpty, range.length == 1, caret.length == 0, NSMaxRange(range) == caret.location,
      let action = Blocks.backspaceKey(storage, caret: caret.location) {
      switch action {
      case let .plain(lines): setBlocks(lines)
      case let .join(joined): replace(joined, with: "")
      }
      return false
    }
    // Words typed or pasted beside a line's holder take its place.
    if Blocks.isHolder(storage, line: line), !text.isEmpty, range.length == 0, range.location == line.location + 1 {
      replace(NSRange(location: line.location, length: 1), with: text)
      return false
    }
    // The last line of a block emptied keeps its block: the holder stands
    // in for the words.
    if text.isEmpty, Blocks.emptiesLastBlockLine(storage, deleting: range) {
      replace(range, with: Blocks.holder)
      return false
    }
    // One character typed: after it lands, the shortcut it completes.
    typedAt = range.length == 0 && (text as NSString).length == 1 ? range.location + 1 : nil
    return true
  }

  func textViewDidChange(_ textView: UITextView) {
    reported = true
    // A holder left beside typed or dictated words comes out; not while a
    // word is still being composed, whose marked range the edit would
    // move from under the keyboard.
    if textView.markedTextRange == nil, Blocks.holderFix(storage) != nil {
      typedAt = nil
      edit { nil }
      return
    }
    if let caret = typedAt {
      typedAt = nil
      if applyRules(caret: caret) { return }
    }
    changed()
  }

  // After any change to the text. The typing attributes follow it: a
  // block changed under a caret that stayed put would otherwise leave
  // the old ones, and the next character typed would carry them.
  private func changed() {
    refreshTyping()
    plainKeyboard(Blocks.at(storage, lineAt: selection.location).block == .code)
    updatePlaceholder()
    layout.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: storage.length))
    emitChange()
    reportHeight()
  }

  // Whether a shortcut was applied (and the change reported).
  private func applyRules(caret: Int) -> Bool {
    guard textView.markedTextRange == nil else { return false }
    var applied: InputRules.Applied?
    edit {
      applied = InputRules.apply(storage, caret: caret, codeGroup: nextCodeGroup)
      return applied?.caret
    }
    guard let applied = applied else { return false }
    lastRule = applied.rule
    if let off = applied.markOff {
      // What is typed next isn't in the mark.
      caretMarks = (Marks.typing(storage, at: applied.caret).subtracting(off), applied.caret)
      refreshTyping()
      onEditorSelection(selectionPayload())
    }
    return true
  }

  // A backspace with nothing before the caret: the first line made plain,
  // or a shortcut's markers put back.
  func backspaceAtStart() -> Bool {
    guard selection == NSRange(location: 0, length: 0) else { return false }
    if let rule = lastRule {
      lastRule = nil
      if InputRules.undoes(rule, backspaceOver: NSRange(location: 0, length: 0), caret: selection) {
        edit { InputRules.undo(storage, rule) }
        return true
      }
    }
    guard case let .plain(lines)? = Blocks.backspaceKey(storage, caret: 0) else { return false }
    setBlocks(lines)
    return true
  }

  // MARK: Selection

  private var snapping = false
  // The selection as it last settled, for the way an edge is moving.
  private var settled = NSRange(location: 0, length: 0)

  func textViewDidChangeSelection(_ textView: UITextView) {
    if let rule = lastRule, selection != NSRange(location: NSMaxRange(rule.range), length: 0) { lastRule = nil }
    if let marks = caretMarks, selection != NSRange(location: marks.at, length: 0) { caretMarks = nil }
    snapSelection()
    plainKeyboard(Blocks.at(storage, lineAt: selection.location).block == .code)
    refreshTyping()
    onEditorSelection(selectionPayload())
  }

  // A caret or a selection's edge never rests inside a pill, nor before
  // a line's holder.
  private func snapSelection() {
    defer { settled = selection }
    guard !snapping, textView.markedTextRange == nil else { return }
    let selected = selection
    func edge(_ at: Int, was: Int) -> Int {
      let at = Mentions.edge(storage, at: at, was: was)
      if Blocks.isHolderCharacter(string, at: at), Blocks.isHolder(storage, line: Document.line(string, at: at)) { return at + 1 }
      return at
    }
    var start = edge(selected.location, was: settled.location)
    var end = selected.length == 0 ? start : edge(NSMaxRange(selected), was: NSMaxRange(settled))
    if end < start { swap(&start, &end) }
    let snapped = NSRange(location: start, length: end - start)
    guard snapped != selected else { return }
    snapping = true
    textView.selectedRange = snapped
    snapping = false
  }

  // What typing at the caret will carry: the line's block, the marks of
  // the character before (or those toggled here), the link only inside
  // one.
  private func refreshTyping() {
    let at = selection.location
    let block = Blocks.at(storage, lineAt: at)
    let marks = block.block == .code ? [] : (caretMarks?.at == at ? caretMarks!.marks : Marks.typing(storage, at: at))
    textView.typingAttributes = styler.typing(block: block, marks: marks, href: Links.typing(storage, at: at))
  }

  // In a code block the keyboard doesn't correct, capitalise, curl quotes
  // or join dashes, which would change the code.
  private func plainKeyboard(_ code: Bool) {
    let correction: UITextAutocorrectionType = code ? .no : .default
    guard textView.autocorrectionType != correction else { return }
    textView.autocorrectionType = correction
    textView.smartQuotesType = code ? .no : .default
    textView.smartDashesType = code ? .no : .default
    textView.spellCheckingType = code ? .no : .default
    textView.autocapitalizationType = code ? .none : .sentences
    if textView.isFirstResponder { textView.reloadInputViews() }
  }

  var inList: Bool { Blocks.at(storage, lineAt: selection.location).block.isList }

  func textViewDidBeginEditing(_ textView: UITextView) {
    onEditorFocus([:])
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    onEditorBlur([:])
  }

  // MARK: Events

  private func selectionPayload() -> [String: Any] {
    let selected = selection
    let marks = caretMarks?.at == selected.location && selected.length == 0 ? caretMarks?.marks : nil
    return [
      // The document revision the text is from, so JS can drop a change
      // that was on its way when it loaded another.
      "revision": loadedRevision,
      "selection": ["start": selected.location, "end": NSMaxRange(selected)],
      "before": Document.textBefore(storage, at: selected.location),
      "formats": Document.activeFormats(storage, selection: selected, caretMarks: marks),
    ]
  }

  private func emitChange() {
    var payload = selectionPayload()
    payload["lines"] = EditorJSON.json(Document.lines(storage))
    onEditorChange(payload)
  }

  // MARK: Commands from JS

  func format(_ name: String) {
    if let mark = Marks.named(name) {
      toggleMark(mark)
      return
    }
    switch name {
    case "quote": setBlocks(Blocks.toggle(storage, selection: selection, .quote, group: 0))
    case "codeblock": setBlocks(Blocks.toggle(storage, selection: selection, .code, group: nextCodeGroup()))
    case "list": setBlocks(Blocks.toggleList(storage, selection: selection, .bullet))
    case "orderedList": setBlocks(Blocks.toggleList(storage, selection: selection, .ordered))
    case "indent": setBlocks(Blocks.indent(storage, selection: selection, by: 1))
    case "outdent": setBlocks(Blocks.indent(storage, selection: selection, by: -1))
    default: break
    }
  }

  // A mark on or off: over a selection, on everywhere unless all of it
  // has it already; at a caret, for what is typed next, until the caret
  // moves. Not in a code block, which holds no marks.
  private func toggleMark(_ mark: Marks) {
    let selected = selection
    if selected.length == 0 {
      guard Blocks.at(storage, lineAt: selected.location).block != .code else { return }
      let marks = caretMarks?.at == selected.location ? caretMarks!.marks : Marks.typing(storage, at: selected.location)
      caretMarks = (marks.symmetricDifference(mark), selected.location)
      refreshTyping()
      onEditorSelection(selectionPayload())
      return
    }
    guard !Marks.markable(storage, in: selected).isEmpty else { return }
    edit {
      Marks.toggle(storage, mark, in: selected)
      return nil
    }
  }

  private func setBlocks(_ lines: [BlockLine]) {
    guard !lines.isEmpty else { return }
    let caret = selection
    edit {
      Blocks.set(storage, lines)
      // A selection stays; a caret moves with a holder put in or taken
      // out on its line.
      guard caret.length == 0 else { return nil }
      let line = Document.line(string, at: min(caret.location, storage.length))
      if Blocks.isHolder(storage, line: line) { return line.location + 1 }
      return min(caret.location, NSMaxRange(Document.content(string, of: line)))
    }
  }

  // A pick from the mention list: the query before the caret replaced by
  // a pill, then `after` (its space).
  func insertMention(_ count: Int, _ mention: EditorMentionRecord, _ after: String) {
    let caret = selection.location
    let line = Document.line(string, at: caret)
    let from = max(line.location, caret - max(0, count))
    let range = NSRange(location: from, length: caret - from)
    let box = MentionBox(mention.mention)
    edit {
      let attrs = styler.typing(block: Blocks.at(storage, line: line), marks: Marks.typing(storage, at: from), href: nil)
      storage.replaceCharacters(in: range, with: NSAttributedString(string: box.words + after, attributes: attrs))
      Mentions.make(storage, in: NSRange(location: from, length: (box.words as NSString).length), mention.mention)
      return from + (box.words as NSString).length + (after as NSString).length
    }
  }

  // A handle typed in full that JS found has one owner: its words, at
  // `location`, become the pill, if they are still there as typed.
  func markMention(_ location: Int, _ typed: String, _ mention: EditorMentionRecord) {
    let length = (typed as NSString).length
    guard location >= 0, location + length <= storage.length else { return }
    let range = NSRange(location: location, length: length)
    guard string.substring(with: range) == typed, Blocks.at(storage, lineAt: location).block != .code,
      !Mentions.any(storage, in: range)
    else { return }
    let words = MentionBox(mention.mention).words
    let caret = selection
    edit {
      if words != typed {
        // Typed in other capitals: the pill reads as the handle does.
        let attrs = storage.attributes(at: location, effectiveRange: nil)
        storage.replaceCharacters(in: range, with: NSAttributedString(string: words, attributes: attrs))
      }
      Mentions.make(storage, in: NSRange(location: location, length: (words as NSString).length), mention.mention)
      return caret.location + (words as NSString).length - length
    }
  }

  func linkDraft() -> [String: Any]? {
    guard let draft = Links.draft(storage, selection: selection) else { return nil }
    openLink = (draft, storage.length)
    return ["text": draft.text, "href": draft.href, "editing": draft.editing]
  }

  // The dialog opened on words that are still there: if the text changed
  // under it (a reload), Save and Remove do nothing rather than land
  // elsewhere.
  private func takeLinkDraft() -> Links.Draft? {
    defer { openLink = nil }
    guard let (draft, length) = openLink, length == storage.length,
      string.substring(with: draft.range) == draft.text
    else { return nil }
    return draft
  }

  func setLink(_ text: String, _ href: String) {
    guard let draft = takeLinkDraft() else { return }
    edit { NSMaxRange(Links.set(storage, in: draft.range, words: text, href: href)) }
  }

  func removeLink() {
    guard let draft = takeLinkDraft(), draft.editing else { return }
    edit {
      Links.remove(storage, in: draft.range)
      return nil
    }
  }

  func load(_ lines: [EditorLine]) {
    openLink = nil
    pasteRange = nil
    lastRule = nil
    caretMarks = nil
    let regroup = regrouper()
    edit {
      storage.setAttributedString(Document.attributed(lines.map { line in
        var copy = line
        if line.block == "code" { copy.group = regroup(line.group) }
        return copy
      }))
      return storage.length
    }
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
    let caret = selection.location
    let line = Document.line(string, at: caret)
    let from = max(line.location, caret - max(0, count))
    replace(NSRange(location: from, length: caret - from), with: text)
  }

  // Any word still being composed (marked text) is taken as it stands,
  // and the lines returned, for a send.
  func commit() -> [[String: Any]] {
    if textView.markedTextRange != nil { textView.unmarkText() }
    if Blocks.holderFix(storage) != nil { edit { nil } }
    return EditorJSON.json(Document.lines(storage))
  }

  // MARK: Paste, copy

  func paste() -> Bool {
    guard let clipboard = UIPasteboard.general.string,
      let action = Clipboard.paste(storage, selection: selection, clipboard: clipboard)
    else { return false }
    switch action {
    case let .link(words, href, range):
      edit { NSMaxRange(Links.set(storage, in: range, words: words, href: href)) }
    case let .ask(text, range):
      pasteRange = range
      onEditorPaste(["text": text])
    }
    return true
  }

  // The pasted lines, once JS has read the clipboard as Markdown.
  func insertLines(_ lines: [EditorLine]) {
    guard let range = pasteRange, NSMaxRange(range) <= storage.length else { return }
    pasteRange = nil
    let regroup = regrouper()
    edit { Clipboard.insert(storage, lines: lines, at: range, regroup: regroup) }
  }

  func copySelection(cut: Bool) -> Bool {
    let selected = selection
    guard selected.length > 0 else { return false }
    onEditorCopy(["lines": EditorJSON.json(Clipboard.copy(storage, selected))])
    if cut { replace(selected, with: "") }
    return true
  }
}
