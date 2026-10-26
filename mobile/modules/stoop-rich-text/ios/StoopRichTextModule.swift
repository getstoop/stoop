import ExpoModulesCore
import UIKit

public class StoopRichTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StoopRichText")

    // Synchronous, on the JS thread: the paragraph's height at a width, so
    // a row renders at its height the first time.
    Function("measure") { (doc: RichDoc, width: Double) -> Double in
      Double(RichLayout(doc: doc, width: CGFloat(width)).height)
    }

    // The first view is the module's default: the timeline's paragraph.
    View(RichTextView.self) {
      Events("onPressLink", "onReveal")
      Prop("doc") { (view: RichTextView, doc: RichDoc) in
        view.doc = doc
      }
    }

    // The composer's field (RichField.tsx).
    View(RichEditorView.self) {
      Events("onEditorChange", "onEditorSelection", "onEditorHeight", "onEditorFocus", "onEditorBlur")
      Prop("editorStyle") { (view: RichEditorView, style: EditorStyleRecord) in
        view.setStyle(style)
      }
      Prop("placeholder") { (view: RichEditorView, text: String) in
        view.placeholder = text
      }
      Prop("label") { (view: RichEditorView, text: String) in
        view.label = text
      }
      Prop("fieldId") { (view: RichEditorView, id: String) in
        view.fieldId = id
      }
      Prop("autoFocus") { (view: RichEditorView, on: Bool) in
        view.autoFocus = on
      }
      Prop("document") { (view: RichEditorView, document: EditorDocumentRecord) in
        view.setDocument(document)
      }

      AsyncFunction("focus") { (view: RichEditorView) in
        view.focus()
      }.runOnQueue(.main)
      AsyncFunction("blur") { (view: RichEditorView) in
        view.blur()
      }.runOnQueue(.main)
      AsyncFunction("replaceBeforeCaret") { (view: RichEditorView, count: Int, text: String) in
        view.replaceBeforeCaret(count, text)
      }.runOnQueue(.main)
      AsyncFunction("format") { (view: RichEditorView, name: String) in
        view.format(name)
      }.runOnQueue(.main)
      AsyncFunction("commit") { (view: RichEditorView) -> [[String: Any]] in
        view.commit()
      }.runOnQueue(.main)
    }
  }
}
