import { Fragment, type ReactNode, useState } from "react";
import {
  type Block,
  type Inline,
  type ListItem,
  parseMarkdown,
} from "../api/markdown";
import { EVERYONE, HERE, splitMentions } from "../api/mentions";

// Renders a message's Markdown as React nodes. Text runs still go through
// splitMentions so @handles highlight inside formatting.
export function MessageBody({
  content,
  usernames,
  mentionsEveryone,
  mentionsHere,
  myUsername,
}: {
  content: string;
  usernames: Set<string>;
  mentionsEveryone: boolean;
  mentionsHere: boolean;
  myUsername?: string;
}) {
  const me = myUsername?.toLowerCase();
  const text = (s: string): ReactNode =>
    splitMentions(s, usernames, mentionsEveryone, mentionsHere).map(
      (part, i) =>
        part.mention ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
            key={i}
            className={`mention ${
              me &&
              (
                part.mention === me ||
                  part.mention === EVERYONE ||
                  part.mention === HERE
              )
                ? "me"
                : ""
            }`}
          >
            {part.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <Fragment key={i}>{part.text}</Fragment>
        ),
    );

  const inline = (nodes: Inline[]): ReactNode =>
    nodes.map((n, i) => {
      const key = i;
      switch (n.type) {
        case "text":
          return <Fragment key={key}>{text(n.text)}</Fragment>;
        case "code":
          return (
            <code key={key} className="md-code">
              {n.text}
            </code>
          );
        case "link":
          return (
            <a
              key={key}
              className="md-link"
              href={n.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {n.href}
            </a>
          );
        case "bold":
          return <strong key={key}>{inline(n.children)}</strong>;
        case "italic":
          return <em key={key}>{inline(n.children)}</em>;
        case "underline":
          return <u key={key}>{inline(n.children)}</u>;
        case "strike":
          return <s key={key}>{inline(n.children)}</s>;
        case "spoiler":
          return <Spoiler key={key}>{inline(n.children)}</Spoiler>;
        default:
          return null;
      }
    });

  const lines = (ls: Inline[][]): ReactNode =>
    ls.map((l, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: static parse of one string
      <Fragment key={i}>
        {i > 0 && <br />}
        {inline(l)}
      </Fragment>
    ));

  const block = (b: Block, i: number): ReactNode => {
    switch (b.type) {
      case "codeblock":
        return (
          <pre key={i} className="md-pre" data-lang={b.lang || undefined}>
            <code>{b.text}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote key={i} className="md-quote">
            {lines(b.lines)}
          </blockquote>
        );
      case "list":
        return <List key={i} items={b.items} render={inline} />;
      case "lines":
        return (
          <span key={i} className="md-lines">
            {lines(b.lines)}
          </span>
        );
    }
  };

  return <>{parseMarkdown(content).map(block)}</>;
}

// Hidden until asked for. A button, not a div with a click handler: it is
// a real control, so it is reachable by keyboard and announced as one.
function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      type="button"
      className={`md-spoiler ${revealed ? "revealed" : ""}`}
      aria-label={revealed ? undefined : "Show spoiler"}
      aria-expanded={revealed}
      onClick={(e) => {
        if (revealed) return;
        // Revealing shouldn't also open whatever is under the message.
        e.stopPropagation();
        setRevealed(true);
      }}
    >
      {children}
    </button>
  );
}

// The parser hands back a flat list of rows, each with a depth and its own
// marker kind. This turns a run of them into real nested <ul>/<ol>, with
// each sub-list inside the <li> it belongs to. Each level picks its own
// tag, so numbered items can carry bulleted children — and a run that
// switches marker kind mid-level becomes two lists rather than one.
interface ListNode {
  ordered: boolean;
  content: Inline[];
  children: ListNode[];
}

function listTree(items: ListItem[]): ListNode[] {
  const roots: ListNode[] = [];
  // levels[d] is the array a row at depth d joins; the entry after the
  // deepest one holds the children of the row just added.
  const levels: ListNode[][] = [roots];
  const base = items[0]?.depth ?? 0;
  for (const item of items) {
    // Never jump more than one level at a time, so a stray deep indent
    // becomes one level in rather than a staircase.
    const depth = Math.max(0, Math.min(item.depth - base, levels.length - 1));
    levels.length = depth + 1;
    const node: ListNode = {
      ordered: item.ordered,
      content: item.content,
      children: [],
    };
    levels[depth].push(node);
    levels.push(node.children);
  }
  return roots;
}

function List({
  items,
  render,
}: {
  items: ListItem[];
  render: (nodes: Inline[]) => ReactNode;
}) {
  const level = (nodes: ListNode[], key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    let i = 0;
    while (i < nodes.length) {
      // One <ul> or <ol> per run of siblings sharing a marker kind.
      const ordered = nodes[i].ordered;
      const run: ListNode[] = [];
      while (i < nodes.length && nodes[i].ordered === ordered) {
        run.push(nodes[i]);
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={`${key}-${i}`} className="md-list">
          {run.map((n, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static parse tree
            <li key={j} className="md-list-item">
              {render(n.content)}
              {n.children.length > 0
                ? level(n.children, `${key}-${i}-${j}`)
                : null}
            </li>
          ))}
        </Tag>,
      );
    }
    return out;
  };
  return <>{level(listTree(items), "l")}</>;
}
