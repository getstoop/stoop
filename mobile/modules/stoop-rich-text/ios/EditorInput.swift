import UIKit

// The composer's text view: paste, copy and cut, and the hardware keys,
// handed to the field (RichEditorView) that knows what the text means.
final class EditorTextView: UITextView {
  weak var editor: RichEditorView?

  override func paste(_ sender: Any?) {
    if editor?.paste() != true { super.paste(sender) }
  }

  override func copy(_ sender: Any?) {
    if editor?.copySelection(cut: false) != true { super.copy(sender) }
  }

  override func cut(_ sender: Any?) {
    if editor?.copySelection(cut: true) != true { super.cut(sender) }
  }

  // A backspace at the very start (no character to delete, so no change
  // the delegate would see) can still put a shortcut's markers back.
  override func deleteBackward() {
    if editor?.undoRuleAtStart() == true { return }
    super.deleteBackward()
  }

  // ⌘B, ⌘I, ⌘U, ⌘E (code), ⌘⇧X (strike) and ⌘K (link), as on web; Tab
  // and ⇧Tab in a list take an item a level deeper or up.
  override var keyCommands: [UIKeyCommand]? {
    var commands = [
      UIKeyCommand(input: "b", modifierFlags: .command, action: #selector(bold)),
      UIKeyCommand(input: "i", modifierFlags: .command, action: #selector(italic)),
      UIKeyCommand(input: "u", modifierFlags: .command, action: #selector(underline)),
      UIKeyCommand(input: "e", modifierFlags: .command, action: #selector(code)),
      UIKeyCommand(input: "x", modifierFlags: [.command, .shift], action: #selector(strike)),
      UIKeyCommand(input: "k", modifierFlags: .command, action: #selector(link)),
    ]
    if editor?.inList == true {
      commands.append(UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(indent)))
      commands.append(UIKeyCommand(input: "\t", modifierFlags: .shift, action: #selector(outdent)))
    }
    for command in commands { command.wantsPriorityOverSystemBehavior = true }
    return commands
  }

  @objc private func bold() { editor?.format("bold") }
  @objc private func italic() { editor?.format("italic") }
  @objc private func underline() { editor?.format("underline") }
  @objc private func code() { editor?.format("code") }
  @objc private func strike() { editor?.format("strike") }
  @objc private func link() { editor?.onEditorKey(["key": "link"]) }
  @objc private func indent() { editor?.format("indent") }
  @objc private func outdent() { editor?.format("outdent") }
}

// What a typing shortcut replaced, so a backspace straight after puts it
// back: the range its result now holds, the text it replaced, and (for a
// block marker) the block the line had.
struct TypedRule {
  let range: NSRange
  let original: NSAttributedString
  let block: BlockBox?
}

extension RichEditorView {
  var inList: Bool {
    ((meaning(at: textView.selectedRange.location)[.editorBlock] as? BlockBox)?.block.isList) ?? false
  }

  // MARK: Format as you type

  // Web's input rules (RichEditor/plugins.ts): a marker pair typed around
  // words styles them, "[words](https://address)" links them once its ")"
  // is typed, and at a line's start "> ", "- " or "* ", "1. " or "1) ",
  // and "```" make the line a quote, a list item or a code block. Never in
  // a code block, and never while a word is being composed.
  static let markRules: [(NSRegularExpression, EditorMarks)] = {
    func rule(_ open: String, _ mark: EditorMarks) -> (NSRegularExpression, EditorMarks) {
      let d = NSRegularExpression.escapedPattern(for: open)
      let c = NSRegularExpression.escapedPattern(for: String(open.first!))
      let pattern = "(?:^|\\s)(\(d)([^\\s\(c)](?:[^\(c)]*[^\\s\(c)])?)\(d))$"
      return (try! NSRegularExpression(pattern: pattern), mark)
    }
    return [
      rule("**", .bold), rule("__", .underline), rule("~~", .strike), rule("||", .spoiler), rule("`", .code),
      // A lone "*", not the second star of "**".
      (try! NSRegularExpression(pattern: "(?:^|[^*])(\\*([^\\s*](?:[^*]*[^\\s*])?)\\*)$"), .italic),
    ]
  }()

  static let linkRule = try! NSRegularExpression(pattern: "\\[([^\\[\\]]+)\\]\\((https?://[^\\s()]+)\\)$")

  // After a character was typed: the shortcut it completes, if any.
  func applyTypedRules(caret: Int) {
    guard textView.markedTextRange == nil, caret <= storage.length else { return }
    let string = storage.string as NSString
    let line = string.lineRange(for: NSRange(location: caret, length: 0))
    let block = (meaning(at: caret)[.editorBlock] as? BlockBox) ?? .paragraph
    guard block.block != .code else { return }
    let before = EditorDocument.textBefore(storage, at: caret) as NSString
    let start = caret - before.length
    let whole = NSRange(location: 0, length: before.length)

    if block.block == .paragraph, applyBlockRule(before as String, line: line, caret: caret) { return }

    if let match = RichEditorView.linkRule.firstMatch(in: before as String, range: whole) {
      let words = NSRange(location: start + match.range(at: 1).location, length: match.range(at: 1).length)
      let href = before.substring(with: match.range(at: 2))
      let all = NSRange(location: start + match.range.location, length: match.range.length)
      let original = storage.attributedSubstring(from: all)
      let linked = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: words))
      linked.removeAttribute(.editorMention, range: NSRange(location: 0, length: linked.length))
      linked.addAttribute(.editorHref, value: href, range: NSRange(location: 0, length: linked.length))
      ruleEdit(all, with: linked, original: original, block: nil)
      return
    }
    for (pattern, mark) in RichEditorView.markRules {
      guard let match = pattern.firstMatch(in: before as String, range: whole) else { continue }
      let marked = NSRange(location: start + match.range(at: 1).location, length: match.range(at: 1).length)
      let words = NSRange(location: start + match.range(at: 2).location, length: match.range(at: 2).length)
      let original = storage.attributedSubstring(from: marked)
      let styled = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: words))
      styled.enumerateAttribute(.editorMarks, in: NSRange(location: 0, length: styled.length)) { value, run, _ in
        var marks = EditorMarks(rawValue: (value as? Int) ?? 0)
        marks.insert(mark)
        styled.addAttribute(.editorMarks, value: marks.rawValue, range: run)
      }
      ruleEdit(marked, with: styled, original: original, block: nil)
      // What is typed next isn't in the mark.
      var meaning = self.meaning(at: textView.selectedRange.location)
      var marks = EditorMarks(rawValue: (meaning[.editorMarks] as? Int) ?? 0)
      marks.remove(mark)
      meaning[.editorMarks] = marks.isEmpty ? nil : marks.rawValue
      textView.typingAttributes = styler.look(for: meaning)
      return
    }
  }

  private func applyBlockRule(_ before: String, line: NSRange, caret: Int) -> Bool {
    let kind: EditorBlock
    if before == "> " {
      kind = .quote
    } else if before == "- " || before == "* " {
      kind = .bullet
    } else if before.range(of: "^\\d{1,9}[.)] $", options: .regularExpression) != nil {
      kind = .ordered
    } else if before == "```" {
      kind = .code
    } else {
      return false
    }
    let marker = NSRange(location: line.location, length: (before as NSString).length)
    let original = storage.attributedSubstring(from: marker)
    let made = BlockBox(kind, group: kind == .code ? 2_000_000 + caret : 0)
    ruleEdit(marker, with: NSAttributedString(), original: original, block: .paragraph)
    let string = storage.string as NSString
    let now = string.lineRange(for: NSRange(location: line.location, length: 0))
    setBlocks([(now, made)])
    return true
  }

  private func ruleEdit(_ range: NSRange, with text: NSAttributedString, original: NSAttributedString, block: BlockBox?) {
    textView.inputDelegate?.textWillChange(textView)
    storage.beginEditing()
    storage.replaceCharacters(in: range, with: text)
    storage.endEditing()
    textView.inputDelegate?.textDidChange(textView)
    let result = NSRange(location: range.location, length: text.length)
    textView.selectedRange = NSRange(location: NSMaxRange(result), length: 0)
    // The text changed outside the text view's undo, which would replay
    // typing at places that have moved.
    textView.undoManager?.removeAllActions()
    lastRule = TypedRule(range: result, original: original, block: block)
  }

  // A backspace straight after a shortcut puts the markers back as typed.
  func undoRule(_ range: NSRange, _ text: String) -> Bool {
    guard let rule = lastRule else { return false }
    lastRule = nil
    guard text.isEmpty, range.length == 1, textView.selectedRange.length == 0,
      textView.selectedRange.location == NSMaxRange(rule.range), NSMaxRange(rule.range) <= storage.length
    else { return false }
    let string = storage.string as NSString
    let line = string.lineRange(for: NSRange(location: rule.range.location, length: 0))
    textView.inputDelegate?.textWillChange(textView)
    storage.beginEditing()
    storage.replaceCharacters(in: rule.range, with: rule.original)
    if let block = rule.block {
      let restored = NSRange(location: line.location, length: max(line.length, rule.original.length))
      storage.addAttribute(.editorBlock, value: block, range: NSIntersectionRange(restored, NSRange(location: 0, length: storage.length)))
      styler.restyle(storage, lines: restored)
    }
    storage.endEditing()
    textView.inputDelegate?.textDidChange(textView)
    textView.selectedRange = NSRange(location: rule.range.location + rule.original.length, length: 0)
    textView.undoManager?.removeAllActions()
    textViewDidChange(textView)
    textViewDidChangeSelection(textView)
    return true
  }

  func undoRuleAtStart() -> Bool {
    guard let rule = lastRule, rule.range.location == 0, rule.range.length == 0,
      textView.selectedRange == NSRange(location: 0, length: 0)
    else { return false }
    return undoRule(NSRange(location: 0, length: 1), "")
  }

  // MARK: Paste, copy

  // Paste: plain text read as Markdown (by JS, which hands back lines:
  // insertLines), so a message's source pastes back formatted; in a code
  // block, literal (the text view's own paste). An address pasted over
  // selected words on one line links them.
  func paste() -> Bool {
    guard var text = UIPasteboard.general.string, !text.isEmpty else { return false }
    let selected = textView.selectedRange
    if (meaning(at: selected.location)[.editorBlock] as? BlockBox)?.block == .code { return false }
    text = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let address = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if selected.length > 0, RichEditorView.readable(address) {
      let string = storage.string as NSString
      let words = string.substring(with: selected)
      if !words.contains("\n"), words.range(of: "https?://", options: [.regularExpression, .caseInsensitive]) == nil {
        linkRange = selected
        linkWords = words
        setLink(words, address)
        return true
      }
    }
    pasteRange = selected
    onEditorPaste(["text": text])
    return true
  }

  // An address the message format reads back whole: http(s), no space or
  // "<", every ")" closing a "(" (core readableAddress).
  static func readable(_ href: String) -> Bool {
    guard href.range(of: "^https?://[^\\s<]+$", options: [.regularExpression, .caseInsensitive]) != nil else { return false }
    var depth = 0
    for character in href {
      if character == "(" { depth += 1 }
      if character == ")" {
        depth -= 1
        if depth < 0 { return false }
      }
    }
    return depth == 0
  }

  // The pasted lines in place of what was selected: the first joins the
  // line pasted into (which keeps its block), the rest keep theirs, and
  // the words after the paste end the last.
  func insertLines(_ lines: [EditorLineRecord]) {
    guard let range = pasteRange, NSMaxRange(range) <= storage.length else { return }
    pasteRange = nil
    let built = NSMutableAttributedString(attributedString: EditorDocument.attributed(lines))
    let here = meaning(at: range.location)
    // Into an empty line (or over all of one), the first pasted line keeps
    // its own block, as web puts a pasted block in an empty one.
    let string = storage.string as NSString
    let line = string.lineRange(for: NSRange(location: range.location, length: 0))
    var content = line
    if content.length > 0, string.character(at: NSMaxRange(content) - 1) == 10 { content.length -= 1 }
    let emptyLine = content.length == 0 || (range.location == content.location && NSMaxRange(range) >= NSMaxRange(content))
    if !emptyLine, let block = here[.editorBlock] {
      let first = (built.string as NSString).lineRange(for: NSRange(location: 0, length: 0))
      if first.length > 0 { built.addAttribute(.editorBlock, value: block, range: first) }
    }
    if lines.count == 1, let marks = here[.editorMarks] as? Int {
      // One line pasted into marked words takes their marks as well.
      built.enumerateAttribute(.editorMarks, in: NSRange(location: 0, length: built.length)) { value, run, _ in
        built.addAttribute(.editorMarks, value: ((value as? Int) ?? 0) | marks, range: run)
      }
    }
    textView.inputDelegate?.textWillChange(textView)
    storage.beginEditing()
    storage.replaceCharacters(in: range, with: built)
    storage.endEditing()
    textView.inputDelegate?.textDidChange(textView)
    textView.selectedRange = NSRange(location: range.location + built.length, length: 0)
    textView.undoManager?.removeAllActions()
    textViewDidChange(textView)
    textViewDidChangeSelection(textView)
  }

  // Copy and Cut: the selection's lines to JS, which puts their Markdown
  // on the clipboard (mentions as their words); Cut then takes them out.
  func copySelection(cut: Bool) -> Bool {
    let selected = textView.selectedRange
    guard selected.length > 0 else { return false }
    let piece = storage.attributedSubstring(from: selected)
    onEditorCopy(["lines": EditorDocument.lines(piece, trailing: nil)])
    if cut { replace(selected, with: "") }
    return true
  }
}
