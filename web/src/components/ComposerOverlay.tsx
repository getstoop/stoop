import {
  Fragment,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import {
  parseStyledMarkdown,
  type StyledBlock,
  type StyledInline,
  type StyledListItem,
} from "../api/markdown";

// The live-styling layer under a composer's textarea: it reproduces the
// draft character for character — every marker (**, *, __, ~~, ||, ``,
// ```, >, "- ") stays visible in a dimmed span, and the content between
// markers is styled (strong/em/u/s/code/quote/spoiler). A spoiler is not
// blurred here: you are the one writing it. The textarea on top has transparent
// text, so the user reads this layer while typing into the textarea.
//
// Blocks are rendered as inline spans with the source's newlines emitted
// verbatim (the overlay is white-space: pre-wrap), so the glyphs line up
// with the textarea line for line. Mentions and links stay plain text —
// the textarea remains the accessible input.

// A zero-width character so a trailing "\n" (last empty line) keeps its
// height. It is only ever appended after a trailing newline, so the overlay's
// text content still equals the draft whenever the draft doesn't end in one.
const ZWSP = "\u200b";

export function ComposerOverlay({
  value,
  textareaRef,
}: {
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Keep the overlay scrolled with the textarea (which scrolls internally
  // once past its max-height). Two paths, both needed: the textarea scrolls
  // without any re-render when the user wheels/drags it or moves the caret
  // with the keyboard, so a scroll listener is the primary sync — it also
  // fires for the browser's own scroll-to-caret after a keystroke, which
  // happens *after* React's layout effect. The layout effect covers the
  // re-render case (e.g. the draft being cleared).
  useEffect(() => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    const sync = () => {
      ov.scrollTop = ta.scrollTop;
    };
    ta.addEventListener("scroll", sync, { passive: true });
    return () => ta.removeEventListener("scroll", sync);
  }, [textareaRef]);
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    if (ta && ov) ov.scrollTop = ta.scrollTop;
  });

  const blocks = value ? parseStyledMarkdown(value) : [];

  return (
    <div ref={overlayRef} className="composer-overlay" aria-hidden="true">
      {value ? (
        <>
          {blocks.map((b, i) => (
            <Fragment
              // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
              key={i}
            >
              {i > 0 ? "\n" : null}
              {block(b)}
            </Fragment>
          ))}
          {value.endsWith("\n") ? ZWSP : null}
        </>
      ) : null}
    </div>
  );
}

// One block, inline: the source's own newlines are part of the output.
function block(block: StyledBlock): ReactNode {
  switch (block.type) {
    case "lines":
      return (
        <span>
          {block.lines.map((l, i) => (
            <Fragment
              // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
              key={i}
            >
              {inline(l)}
              {i < block.lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </span>
      );
    case "quote":
      return (
        <span className="ov-quote">
          {block.lines.map((q, i) => (
            <Fragment
              // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
              key={i}
            >
              <span className="md-marker">{q.open.text}</span>
              {inline(q.line)}
              {i < block.lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </span>
      );
    case "list":
      return (
        <span className="ov-list">
          {block.items.map((it, i) => (
            <Fragment
              // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
              key={i}
            >
              {listItem(it)}
              {i < block.items.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </span>
      );
    case "codeblock":
      return codeblock(block);
  }
}

function listItem(item: StyledListItem): ReactNode {
  return (
    <>
      <span className="md-marker">{item.open.text}</span>
      {inline(item.content)}
    </>
  );
}

function codeblock(
  block: Extract<StyledBlock, { type: "codeblock" }>,
): ReactNode {
  if (block.sameLine) {
    return (
      <span className="ov-codeblock">
        <span className="md-marker">{block.open.text}</span>
        <span>{block.text}</span>
        <span className="md-marker">{block.close.text}</span>
      </span>
    );
  }
  // A multi-line fence: the open fence line, the body lines verbatim (a
  // newline before each, as in the source), and the closing fence when the
  // fence is closed; an unclosed fence just ends after its last line.
  return (
    <span className="ov-codeblock">
      <span className="md-marker">{block.open.text}</span>
      {block.body.map((l, i) => (
        <Fragment
          // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
          key={i}
        >
          <span>{"\n"}</span>
          <span>{l}</span>
        </Fragment>
      ))}
      {block.close.text ? (
        <>
          <span>{"\n"}</span>
          <span className="md-marker">{block.close.text}</span>
        </>
      ) : null}
    </span>
  );
}

// The inline tree, with markers kept as dimmed spans.
function inline(nodes: StyledInline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return (
          <Fragment
            // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
            key={i}
          >
            {n.text}
          </Fragment>
        );
      case "code":
        return (
          <Fragment
            // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
            key={i}
          >
            <code className="ov-code">
              <span className="md-marker">{n.open.text}</span>
              {n.text}
              <span className="md-marker">{n.close.text}</span>
            </code>
          </Fragment>
        );
      case "link":
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
            key={i}
            className="ov-link"
          >
            {n.href}
          </span>
        );
      default:
        return (
          <Style
            // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
            key={i}
            node={n}
          />
        );
    }
  });
}

function Style({
  node,
}: {
  node: Extract<
    StyledInline,
    { type: "bold" | "italic" | "underline" | "strike" | "spoiler" }
  >;
}): ReactNode {
  const mark = (
    <>
      <span className="md-marker">{node.open.text}</span>
      {inline(node.children)}
      <span className="md-marker">{node.close.text}</span>
    </>
  );
  switch (node.type) {
    case "bold":
      return <strong>{mark}</strong>;
    case "italic":
      return <em>{mark}</em>;
    case "underline":
      return <u>{mark}</u>;
    case "strike":
      return <s>{mark}</s>;
    case "spoiler":
      return <span className="ov-spoiler">{mark}</span>;
  }
}
