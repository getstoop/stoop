import UIKit

// The composer's text view: what the system hands it (paste, copy and
// cut, a hardware key) goes to the field (RichEditorView), which knows
// what the text means.
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
  // the delegate would see) can still put a shortcut's markers back, or
  // make the first line plain.
  override func deleteBackward() {
    if editor?.backspaceAtStart() == true { return }
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
