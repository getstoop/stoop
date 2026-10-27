package org.getstoop.richtext

import android.graphics.Color
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// The document as it crosses the bridge: the records JS hands over (a
// load, a paste) and the JSON it reads back (each change, a copy),
// core/editor/lines.ts EditorLine either way.

class EditorMentionRecord : Record {
  @Field val kind: String = "person"
  @Field val id: String = ""
  @Field val handle: String = ""

  val mention get() = EditorMention(kind, id, handle)
}

class EditorRunRecord : Record {
  @Field val text: String? = null
  @Field val marks: List<String> = emptyList()
  @Field val href: String? = null
  @Field val mention: EditorMentionRecord? = null

  val run get() = mention?.let { EditorRun.mention(it.mention, marks) } ?: EditorRun.text(text ?: "", marks, href)
}

class EditorLineRecord : Record {
  @Field val block: String = "paragraph"
  @Field val depth: Int = 0
  @Field val group: Int = 0
  @Field val lang: String? = null
  @Field val runs: List<EditorRunRecord> = emptyList()

  val line get() = EditorLine(block, depth, group, lang, runs.map { it.run })
}

// The text JS puts in the field from outside (a draft, an edit, a
// refused send): loaded when its revision changes.
class EditorDocumentRecord : Record {
  @Field val revision: Int = 0
  @Field val lines: List<EditorLineRecord> = emptyList()
}

// The composer's look, from the theme (RichField.tsx), as on iOS
// (EditorStyler.swift). Sizes in dp.
class EditorStyleRecord : Record {
  @Field val textColor: Color? = null
  @Field val mutedColor: Color? = null
  @Field val accentColor: Color? = null
  @Field val mentionFill: Color? = null
  @Field val raised: Color? = null
  @Field val border: Color? = null
  @Field val hatch: Color? = null
  @Field val placeholderColor: Color? = null
  @Field val fontSize: Double = 17.0
  @Field val lineHeight: Double = 23.0
  @Field val codeScale: Double = 0.9
  @Field val quoteBarWidth: Double = 3.0
  @Field val quotePadX: Double = 12.0
  @Field val listIndent: Double = 24.0
  @Field val prePadX: Double = 12.0
  @Field val radius: Double = 4.0
  @Field val fillPad: Double = 2.0
}

internal object EditorJSON {
  fun json(lines: List<EditorLine>): List<Map<String, Any>> = lines.map { line ->
    val out = mutableMapOf<String, Any>(
      "block" to line.block, "depth" to line.depth, "group" to line.group,
      "runs" to line.runs.map { run ->
        val json = mutableMapOf<String, Any>("marks" to run.marks)
        val mention = run.mention
        if (mention != null) {
          json["mention"] = mapOf("kind" to mention.kind, "id" to mention.id, "handle" to mention.handle)
        } else {
          json["text"] = run.text ?: ""
          run.href?.let { json["href"] = it }
        }
        json
      },
    )
    line.lang?.let { out["lang"] = it }
    out
  }
}
