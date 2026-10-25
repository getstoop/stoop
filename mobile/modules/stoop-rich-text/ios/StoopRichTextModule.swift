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

    View(RichTextView.self) {
      Events("onPressLink", "onReveal")
      Prop("doc") { (view: RichTextView, doc: RichDoc) in
        view.doc = doc
      }
    }
  }
}
