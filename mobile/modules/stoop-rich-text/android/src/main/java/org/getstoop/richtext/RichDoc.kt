package org.getstoop.richtext

import android.graphics.Color
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// One styled run of a message's words, built in JS from our parser's tree
// (MessageBody/native.ts), as on iOS (RichLayout.swift RichRun). Never
// Markdown: the marks are already resolved. The optional fields are
// nullable because JS leaves them undefined, which arrives as null.
class RichRun : Record {
  @Field val text: String = ""
  @Field val size: Double = 15.0
  @Field val weight: Double? = null
  @Field val italic: Boolean? = null
  @Field val mono: Boolean? = null
  @Field val underline: Boolean? = null
  @Field val strike: Boolean? = null
  @Field val color: Color? = null

  // A tappable link: a URL, or "channel:<id>" for a channel pill. Runs of
  // one link share linkId. A hidden link takes taps but is no link element
  // (its words hide a covered spoiler).
  @Field val link: String? = null
  @Field val linkId: Int? = null
  @Field val linkHidden: Boolean? = null

  // A rounded, padded fill behind the run: a pill or inline code, padded
  // fillPad at each end. Runs of one pill share fillId.
  @Field val fill: Color? = null
  @Field val fillId: Int? = null
  @Field val fillPad: Double? = null

  // Under a spoiler: its id (while covered, the outermost covered one's,
  // so a tap anywhere on the cover reveals it), whether it is covered,
  // and its fill.
  @Field val spoiler: Int? = null
  @Field val covered: Boolean? = null
  @Field val spoilerFill: Color? = null
}

class RichDoc : Record {
  @Field val runs: List<RichRun> = emptyList()
  @Field val lineHeight: Double = 21.75
  @Field val bodySize: Double = 15.0
  @Field val textColor: Color? = null
  @Field val spoilerPad: Double = 4.0
  @Field val radius: Double = 4.0

  // The paragraph as a screen reader says it (covered spoilers as
  // "spoiler, double tap to reveal").
  @Field val label: String = ""

  // Whether a covered spoiler can be revealed here: not in the message
  // menu's card, which taps nothing.
  @Field val revealable: Boolean = true
}
