import { Node } from "prosemirror-model";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { type RefObject, useLayoutEffect, useRef } from "react";
import type { Format } from "../../api/formatting";
import { formatCommands } from "./commands";
import { fromMarkdown, toMarkdown } from "./markdown";
import { editorPlugins } from "./plugins";
import { schema } from "./schema";

// The composer's editor: the draft is a rich-text document and the
// markers never show. Markdown is what it hands the composer on every
// change and what it loads when the composer sets a value.

export interface RichField {
  format(format: Format): void;
  // Replace the `count` characters before the caret (a picker's query).
  replaceBeforeCaret(count: number, text: string): void;
  focus(): void;
}

function docFrom(markdown: string): Node {
  return Node.fromJSON(schema, fromMarkdown(markdown));
}

export function RichEditor({
  value,
  onChange,
  onCaret,
  onKeyDown,
  onPaste,
  onBlur,
  placeholder = "",
  autoFocus = false,
  fieldRef,
}: {
  value: string;
  // textBefore is the current block's text up to the caret, for pickers.
  onChange: (markdown: string, textBefore: string) => void;
  // The caret moved without an edit: pickers re-read their query.
  onCaret?: (textBefore: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onPaste?: (e: ClipboardEvent) => void;
  onBlur?: () => void;
  placeholder?: string;
  // Focus on mount with the caret at the end.
  autoFocus?: boolean;
  fieldRef: RefObject<RichField | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handlers = useRef({
    onChange,
    onCaret,
    onKeyDown,
    onPaste,
    onBlur,
  });
  handlers.current = { onChange, onCaret, onKeyDown, onPaste, onBlur };
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const emitted = useRef(value);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is made once; props reach it through refs and the effect below
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view: EditorView = new EditorView(host, {
      state: EditorState.create({
        doc: docFrom(value),
        plugins: editorPlugins(() => placeholderRef.current),
      }),
      attributes: () => ({
        class: "rich-editor-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-placeholder": placeholderRef.current,
      }),
      handleKeyDown: (_view, e) => {
        handlers.current.onKeyDown(e);
        return e.defaultPrevented;
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
        view.updateState(view.state.apply(tr));
        if (tr.getMeta("fromProps")) return;
        const { $from } = view.state.selection;
        const textBefore = $from.parent.textBetween(
          0,
          $from.parentOffset,
          undefined,
          "\ufffc",
        );
        if (!tr.docChanged) {
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
        formatCommands[format](view.state, view.dispatch);
        view.focus();
      },
      replaceBeforeCaret: (count, text) => {
        const { from: pos, $from } = view.state.selection;
        if (count > $from.parentOffset) return;
        view.dispatch(view.state.tr.insertText(text, pos - count, pos));
        view.focus();
      },
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

  return <div ref={hostRef} className="rich-editor" />;
}
