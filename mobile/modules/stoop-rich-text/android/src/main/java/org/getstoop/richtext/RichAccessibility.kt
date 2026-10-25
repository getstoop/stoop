package org.getstoop.richtext

import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import android.view.accessibility.AccessibilityManager
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper

// The paragraph's nodes for a screen reader: a link node for each link and
// channel pill, then the paragraph. Touching a point finds a link before
// the paragraph, and swiping meets the links first, as on iOS. Each link
// covers its words on each line; covered spoiler words are in no node: the
// paragraph reads the doc's label, which says "spoiler, double tap to
// reveal" in their place, and a link whose words hide one is no node.
internal class RichAccessibility(private val view: RichTextView) : ExploreByTouchHelper(view) {
  private class Node(val id: Int, val url: String, val label: String, val rects: List<RectF>)

  private fun nodes(): List<Node> {
    val layout = view.currentLayout() ?: return emptyList()
    return layout.links
      .filter { !it.hidden }
      .map { Node(it.id + 1, it.url, it.label.toString(), layout.lineRects(it.start, it.end)) }
      // Words with no width on any line (only spaces at a wrap) are no
      // node: there is nothing to touch.
      .filter { it.rects.isNotEmpty() }
  }

  override fun getVirtualViewAt(x: Float, y: Float): Int {
    if (view.currentLayout() == null) return INVALID_ID
    nodes().firstOrNull { node -> node.rects.any { it.contains(x, y) } }?.let { return it.id }
    return PARAGRAPH
  }

  override fun getVisibleVirtualViews(ids: MutableList<Int>) {
    if (view.currentLayout() == null) return
    nodes().forEach { ids.add(it.id) }
    ids.add(PARAGRAPH)
  }

  override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
    val layout = view.currentLayout()
    if (id == PARAGRAPH || layout == null) {
      node.contentDescription = view.doc?.label?.ifEmpty { null } ?: " "
      node.className = "android.widget.TextView"
      node.setBoundsInParent(Rect(0, 0, view.width, view.height))
      node.isFocusable = true
      node.isScreenReaderFocusable = true
      // Double tap reveals the first covered spoiler; with none covered
      // the paragraph is no control.
      if (view.revealable && layout?.firstCovered() != null) {
        node.isClickable = true
        node.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_CLICK)
      }
      return
    }
    val link = nodes().firstOrNull { it.id == id }
    if (link == null) {
      // Gone since it was listed (a re-render): an empty node, as the
      // helper must be given bounds and words.
      node.contentDescription = " "
      node.setBoundsInParent(Rect(0, 0, 1, 1))
      return
    }
    val bounds = RectF(link.rects.first())
    link.rects.drop(1).forEach { bounds.union(it) }
    val rect = Rect()
    bounds.roundOut(rect)
    node.contentDescription = link.label
    node.className = "android.widget.Button"
    node.roleDescription = "link"
    node.setBoundsInParent(rect)
    node.isFocusable = true
    node.isScreenReaderFocusable = true
    node.isClickable = true
    node.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_CLICK)
  }

  override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
    if (action != AccessibilityNodeInfoCompat.ACTION_CLICK) return false
    if (id == PARAGRAPH) {
      // Nothing covered: nothing happens, rather than a tap on whatever
      // the paragraph's middle holds.
      if (!view.revealable) return false
      view.currentLayout()?.firstCovered()?.let { view.reveal(it) }
      return true
    }
    val link = nodes().firstOrNull { it.id == id } ?: return false
    view.pressLink(link.url)
    return true
  }

  // After a reveal: focus moved back onto the paragraph, so a screen
  // reader stays on the message and reads its words again.
  fun refocusParagraph() {
    val manager = view.context.getSystemService(AccessibilityManager::class.java) ?: return
    if (!manager.isEnabled || !manager.isTouchExplorationEnabled) return
    val provider = getAccessibilityNodeProvider(view) ?: return
    provider.performAction(PARAGRAPH, AccessibilityNodeInfoCompat.ACTION_CLEAR_ACCESSIBILITY_FOCUS, null)
    provider.performAction(PARAGRAPH, AccessibilityNodeInfoCompat.ACTION_ACCESSIBILITY_FOCUS, null)
  }

  companion object {
    const val PARAGRAPH = 0
  }
}
