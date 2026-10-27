import ExpoModulesCore
import Foundation

// The document as it crosses the bridge: the records JS hands over (a
// load, a paste) and the JSON it reads back (each change, a copy),
// core/editor/lines.ts EditorLine either way.

struct EditorMentionRecord: Record {
  @Field var kind: String = "person"
  @Field var id: String = ""
  @Field var handle: String = ""

  var mention: EditorMention { EditorMention(kind: kind, id: id, handle: handle) }
}

struct EditorRunRecord: Record {
  @Field var text: String?
  @Field var marks: [String] = []
  @Field var href: String?
  @Field var mention: EditorMentionRecord?

  var run: EditorRun {
    if let mention = mention { return EditorRun(mention: mention.mention, marks: marks) }
    return EditorRun(text: text ?? "", marks: marks, href: href)
  }
}

struct EditorLineRecord: Record {
  @Field var block: String = "paragraph"
  @Field var depth: Int = 0
  @Field var group: Int = 0
  @Field var lang: String?
  @Field var runs: [EditorRunRecord] = []

  var line: EditorLine { EditorLine(block: block, depth: depth, group: group, lang: lang, runs: runs.map(\.run)) }
}

// The text JS puts in the field from outside (a draft, an edit, a
// refused send): loaded when its revision changes.
struct EditorDocumentRecord: Record {
  @Field var revision: Int = 0
  @Field var lines: [EditorLineRecord] = []
}

enum EditorJSON {
  static func json(_ lines: [EditorLine]) -> [[String: Any]] {
    lines.map { line in
      var out: [String: Any] = [
        "block": line.block, "depth": line.depth, "group": line.group,
        "runs": line.runs.map { run -> [String: Any] in
          var json: [String: Any] = ["marks": run.marks]
          if let mention = run.mention {
            json["mention"] = ["kind": mention.kind, "id": mention.id, "handle": mention.handle]
          } else {
            json["text"] = run.text ?? ""
            if let href = run.href { json["href"] = href }
          }
          return json
        },
      ]
      if let lang = line.lang { out["lang"] = lang }
      return out
    }
  }
}
