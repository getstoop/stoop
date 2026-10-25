package org.getstoop.richtext

import android.content.res.Resources
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

    View(RichTextView::class) {
      Events("onPressLink", "onReveal")
      Prop("doc") { view: RichTextView, doc: RichDoc ->
        view.doc = doc
      }
    }
  }
}
