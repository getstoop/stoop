import { Node } from "prosemirror-model";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { Format } from "../../api/formatting";
import type { MentionRef } from "../../api/mentions";
import { activeFormats, formatCommands } from "./commands";
import { LinkDialog } from "./LinkDialog";
import {
  type LinkDraft,
  type LinkRange,
  linkAround,
  linkAtPos,
  linkDraft,
  saveLink,
} from "./links";
import { fromMarkdown, toMarkdown } from "./markdown";
import {
  caretInCode,
  type MentionContext,
  mentionsKey,
  NO_MENTIONS,
} from "./mentions";
import { editorPlugins } from "./plugins";
import { schema } from "./schema";

// The composer's editor: the draft is a rich-text document and the
// markers never show. Markdown is what it hands the composer on every
// change and what it loads when the composer sets a value.

export interface RichField {
  format(format: Format): void;
  // Replace the `count` characters before the caret (a picker's query).
  replaceBeforeCaret(count: number, text: string): void;
  // The same, with a mention and a space after it.
  mentionBeforeCaret(count: number, mention: MentionRef): void;
  // Whether the caret is in code, where mentions don't work.
  caretInCode(): boolean;
  focus(): void;
}

function docFrom(markdown: string): Node {
  return Node.fromJSON(schema, fromMarkdown(markdown));
}

export function RichEditor({
  value,
  onChange,
  onCaret,
  onFormats,
  onKeyDown,
  onPaste,
  onBlur,
  placeholder = "",
  mentions,
  autoFocus = false,
  fieldRef,
}: {
  value: string;
  // textBefore is the current block's text up to the caret, for pickers.
  onChange: (markdown: string, textBefore: string) => void;
  // The caret moved without an edit: pickers re-read their query.
  onCaret?: (textBefore: string) => void;
  // The formats in effect at the caret, for the toolbar to show.
  onFormats?: (active: Format[]) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onPaste?: (e: ClipboardEvent) => void;
  onBlur?: () => void;
  placeholder?: string;
  // The members a typed @handle is drawn as a mention for.
  mentions?: MentionContext;
  // Focus on mount with the caret at the end.
  autoFocus?: boolean;
  fieldRef: RefObject<RichField | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handlers = useRef({
    onChange,
    onCaret,
    onFormats,
    onKeyDown,
    onPaste,
    onBlur,
  });
  handlers.current = {
    onChange,
    onCaret,
    onFormats,
    onKeyDown,
    onPaste,
    onBlur,
  };
  const formatsKey = useRef("");
  const [linkForm, setLinkForm] = useState<{
    draft: LinkDraft;
    editing: boolean;
  } | null>(null);
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const mentionsRef = useRef(mentions);
  mentionsRef.current = mentions;
  const emitted = useRef(value);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is made once; props reach it through refs and the effect below
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const openLink = (link: LinkRange | null) => {
      const draft = linkDraft(view.state, link);
      if (!draft) return;
      setLinkForm({ draft, editing: !!link });
    };
    const view: EditorView = new EditorView(host, {
      state: EditorState.create({
        doc: docFrom(value),
        plugins: editorPlugins(
          () => placeholderRef.current,
          () => mentionsRef.current ?? NO_MENTIONS,
        ),
      }),
      attributes: () => ({
        class: "rich-editor-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-placeholder": placeholderRef.current,
      }),
      handleKeyDown: (_view, e) => {
        handlers.current.onKeyDown(e);
        const mod = e.metaKey || e.ctrlKey;
        if (!e.defaultPrevented && mod && !e.shiftKey && !e.altKey) {
          if (e.key.toLowerCase() === "k") {
            e.preventDefault();
            openLink(linkAround(view.state));
          }
        }
        return e.defaultPrevented;
      },
      // A double click on a link opens it in the link form.
      handleDoubleClick: (_view, pos) => {
        const link = linkAtPos(view.state, pos);
        if (!link) return false;
        openLink(link);
        return true;
      },
      handlePaste: (_view, e) => {
        handlers.current.onPaste?.(e);
        return e.defaultPrevented;
      },
      handleDOMEvents: {
        blur: () => {
          handlers.current.onBlur?.();
          return false;
        },
      },
      dispatchTransaction: (tr) => {
        const { state, transactions } = view.state.applyTransaction(tr);
        view.updateState(state);
        // The mentions plugin may append a change of its own, even to a
        // transaction that changed nothing: that is an edit too.
        const appended = transactions.slice(1).some((t) => t.docChanged);
        const active = activeFormats(view.state);
        if (active.join() !== formatsKey.current) {
          formatsKey.current = active.join();
          handlers.current.onFormats?.(active);
        }
        if (tr.getMeta("fromProps") && !appended) return;
        const { $from } = view.state.selection;
        const textBefore = $from.parent.textBetween(
          0,
          $from.parentOffset,
          undefined,
          "\ufffc",
        );
        if (!tr.docChanged && !appended) {
          if (tr.selectionSet) handlers.current.onCaret?.(textBefore);
          return;
        }
        const markdown = toMarkdown(view.state.doc.toJSON());
        emitted.current = markdown;
        handlers.current.onChange(markdown, textBefore);
      },
    });
    viewRef.current = view;
    if (autoFocus) {
      view.dispatch(
        view.state.tr.setSelection(Selection.atEnd(view.state.doc)),
      );
      view.focus();
    }
    fieldRef.current = {
      format: (format) => {
        // In a link the button opens it to edit; elsewhere, to add one.
        if (format === "link") {
          openLink(linkAround(view.state));
          return;
        }
        formatCommands[format](view.state, view.dispatch);
        view.focus();
      },
      replaceBeforeCaret: (count, text) => {
        const { from: pos, $from } = view.state.selection;
        if (count > $from.parentOffset) return;
        view.dispatch(view.state.tr.insertText(text, pos - count, pos));
        view.focus();
      },
      mentionBeforeCaret: (count, mention) => {
        const { from: pos, $from } = view.state.selection;
        if (count > $from.parentOffset) return;
        // The pill takes the formatting of what it replaces: one picked
        // inside a spoiler stays hidden.
        const marks = view.state.storedMarks ?? $from.marks();
        const node = schema.nodes.mention.create({ ...mention }, null, marks);
        view.dispatch(
          view.state.tr
            .replaceWith(pos - count, pos, node)
            .insertText(" ", pos - count + node.nodeSize),
        );
        view.focus();
      },
      caretInCode: () => caretInCode(view.state),
      focus: () => view.focus(),
    };
    return () => {
      view.destroy();
      viewRef.current = null;
      fieldRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || value === emitted.current) return;
    emitted.current = value;
    const { doc } = view.state;
    view.dispatch(
      view.state.tr
        .replaceWith(0, doc.content.size, docFrom(value).content)
        .setMeta("fromProps", true)
        .setMeta("addToHistory", false),
    );
  }, [value]);

  // A new placeholder (another channel) reaches the attribute and the
  // empty-line hint on the view's next update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placeholder is read through its ref; a change is what triggers the update
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr);
  }, [placeholder]);

  // Members arriving or changing redraw the mentions already typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mentions is read through its ref; a change is what triggers the update
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta(mentionsKey, true));
  }, [mentions]);

  const closeLinkForm = () => {
    setLinkForm(null);
    viewRef.current?.focus();
  };

  return (
    <>
      <div ref={hostRef} className="rich-editor" />
      {linkForm && (
        <LinkDialog
          text={linkForm.draft.text}
          href={linkForm.draft.href}
          editing={linkForm.editing}
          onSave={(text, href) => {
            const view = viewRef.current;
            if (view) {
              view.dispatch(saveLink(view.state, linkForm.draft, text, href));
            }
            closeLinkForm();
          }}
          onRemove={() => {
            const view = viewRef.current;
            const { from, to } = linkForm.draft;
            if (view) {
              view.dispatch(
                view.state.tr.removeMark(from, to, schema.marks.link),
              );
            }
            closeLinkForm();
          }}
          onCancel={closeLinkForm}
        />
      )}
    </>
  );
}
