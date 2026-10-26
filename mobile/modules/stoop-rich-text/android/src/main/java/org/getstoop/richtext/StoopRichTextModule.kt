package org.getstoop.richtext

import android.content.res.Resources
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

class StoopRichTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StoopRichText")

    // Synchronous, on the JS thread: the paragraph's height at a width, so
    // a row renders at its height the first time. Both in dp; the layout
    // is built in pixels, as the view draws it.
    Function("measure") { doc: RichDoc, width: Double ->
      val density = (appContext.reactContext?.resources ?: Resources.getSystem()).displayMetrics.density
      RichLayout(doc, (width * density).roundToInt(), density).heightDp
    }

    // The first view is the module's default: the timeline's paragraph.
    View(RichTextView::class) {
      Events("onPressLink", "onReveal")
      Prop("doc") { view: RichTextView, doc: RichDoc ->
        view.doc = doc
      }
    }

    // The composer's field (RichField.tsx).
    View(RichEditorView::class) {
      Events("onEditorChange", "onEditorSelection", "onEditorHeight", "onEditorFocus", "onEditorBlur")
      Prop("editorStyle") { view: RichEditorView, style: EditorStyleRecord ->
        view.setStyle(style)
      }
      Prop("placeholder") { view: RichEditorView, text: String ->
        view.setPlaceholder(text)
      }
      Prop("label") { view: RichEditorView, text: String ->
        view.label = text
      }
      Prop("fieldId") { view: RichEditorView, id: String ->
        view.fieldId = id
      }
      Prop("autoFocus") { view: RichEditorView, on: Boolean ->
        view.autoFocus = on
      }
      Prop("document") { view: RichEditorView, document: EditorDocumentRecord ->
        view.setDocument(document)
      }

      AsyncFunction("focus") { view: RichEditorView ->
        view.focus()
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("blur") { view: RichEditorView ->
        view.blur()
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("replaceBeforeCaret") { view: RichEditorView, count: Int, text: String ->
        view.replaceBeforeCaret(count, text)
      }.runOnQueue(Queues.MAIN)
      AsyncFunction("commit") { view: RichEditorView ->
        view.commit()
      }.runOnQueue(Queues.MAIN)
    }
  }
}
