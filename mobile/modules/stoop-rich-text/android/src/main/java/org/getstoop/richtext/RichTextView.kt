package org.getstoop.richtext

import android.content.Context
import android.graphics.Canvas
import android.graphics.Rect
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.core.view.ViewCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

// A message's paragraph drawn from a StaticLayout (RichLayout). Its height
// is set from JS, which measured the same doc at the same width
// (StoopRichTextModule.measure). Taps on a link or a covered spoiler go
// back to JS. A long press is left to React Native's row: its touch
// handler sees every event at the root, whatever this view does with them,
// and this view only declines to call a press held that long a tap.
class RichTextView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onPressLink by EventDispatcher()
  private val onReveal by EventDispatcher()

  var doc: RichDoc? = null
    set(value) {
      field = value
      layout = null
      accessibility.invalidateRoot()
      invalidate()
      if (revealing) {
        revealing = false
        // After the doc with the words revealed: a screen reader stays on
        // the message and reads it again.
        post { accessibility.refocusParagraph() }
      }
    }

  private var layout: RichLayout? = null
  private val accessibility = RichAccessibility(this)
  // A reveal was asked for; its doc is on the way.
  private var revealing = false

  // The touch that went down on a link or a covered spoiler.
  private var pressed: Target? = null
  private var downX = 0f
  private var downY = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

  init {
    setWillNotDraw(false)
    clipChildren = false
    ViewCompat.setAccessibilityDelegate(this, accessibility)
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  // Laid out again at any other width, so a line is never cut off.
  internal fun currentLayout(): RichLayout? {
    val doc = doc ?: return null
    if (width <= 0) return null
    layout?.let { if (it.width == width) return it }
    return RichLayout(doc, width, resources.displayMetrics.density).also { layout = it }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    accessibility.invalidateRoot()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    currentLayout()?.draw(canvas)
  }

  // False in the message menu's card: covered spoilers stay covered and
  // take no touch.
  internal val revealable: Boolean
    get() = doc?.revealable ?: false

  internal fun reveal(id: Int) {
    if (!revealable) return
    revealing = true
    onReveal(mapOf("id" to id))
  }

  internal fun pressLink(url: String) {
    onPressLink(mapOf("url" to url))
  }

  // Touch

  // What a tap at a point would do: reveal a covered spoiler (innermost
  // first, as a spoiler in a link's words takes the tap), or open a link.
  internal sealed class Target {
    data class Reveal(val id: Int) : Target()
    data class Link(val url: String) : Target()
  }

  private fun target(x: Float, y: Float): Target? {
    val layout = currentLayout() ?: return null
    val index = layout.characterAt(x, y) ?: return null
    layout.text.getSpans(index, index + 1, CoveredMark::class.java).firstOrNull()?.let {
      // Covered words are no link either, so in the card they take nothing.
      return if (revealable) Target.Reveal(it.id) else null
    }
    layout.text.getSpans(index, index + 1, LinkMark::class.java).firstOrNull()?.let { return Target.Link(it.url) }
    return null
  }

  // A tap starts only over a link or a covered spoiler; anything else is
  // not this view's, and falls through to the row. A press that moves or
  // is held as long as a long press is no tap.
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        pressed = target(event.x, event.y) ?: return false
        downX = event.x
        downY = event.y
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (abs(event.x - downX) > touchSlop || abs(event.y - downY) > touchSlop) pressed = null
        return true
      }
      MotionEvent.ACTION_UP -> {
        val tapped = pressed
        pressed = null
        val held = event.eventTime - event.downTime >= LONG_PRESS_MS
        if (tapped != null && !held && target(event.x, event.y) == tapped) {
          when (tapped) {
            is Target.Reveal -> reveal(tapped.id)
            is Target.Link -> pressLink(tapped.url)
          }
          performClick()
        }
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        pressed = null
        return true
      }
    }
    return pressed != null
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }

  // Accessibility

  override fun dispatchHoverEvent(event: MotionEvent): Boolean =
    accessibility.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    accessibility.dispatchKeyEvent(event) || super.dispatchKeyEvent(event)

  override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: Rect?) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    accessibility.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
  }

  companion object {
    // React Native's Pressable opens the row's menu after 500ms; iOS's
    // guard waits as long.
    private const val LONG_PRESS_MS = 500L
  }
}
