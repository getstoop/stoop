import { Fragment, type ReactNode, useMemo, useState } from "react";
import { splitEmoji } from "../api/emojiText";
import {
  type Block,
  type Inline,
  type ListItem,
  parseMarkdown,
} from "../api/markdown";
import {
  currentHandle,
  EVERYONE_CLASS,
  groupMentionClass,
  type MentionGroups,
  type MentionMembers,
  type MentionRef,
  mentionClass,
  NO_GROUPS,
  splitEveryone,
} from "../api/mentions";
import type { Group } from "../gen/stoop/chat/v1/group_pb";

// Renders a message's Markdown as React nodes. A mention token is a pill
// for the person or group it names, read by ID; text runs still go
// through splitEveryone for @channel and @here. `highlight` (a search's
// terms) marks matching words in those runs.
export function MessageBody({
  content,
  members,
  mentionsEntireChannel,
  mentionsHere,
  myUserId,
  highlight,
  onMention,
  groups = NO_GROUPS,
  onGroup,
}: {
  content: string;
  // The people who can read the channel, by user ID.
  members: MentionMembers;
  mentionsEntireChannel: boolean;
  mentionsHere: boolean;
  myUserId?: string;
  highlight?: RegExp | null;
  // Opens a mentioned member's card. Not inside a link or a spoiler,
  // whose click is their own.
  onMention?: (userId: string, anchor: DOMRect) => void;
  // The groups mentions name here, by ID: none in a private channel or
  // a DM.
  groups?: MentionGroups;
  // Opens a mentioned group's card, under the same rule as onMention.
  onGroup?: (group: Group, anchor: DOMRect) => void;
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  const text = (s: string): ReactNode =>
    splitEveryone(s, mentionsEntireChannel, mentionsHere).map((part, i) =>
      part.everyone ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
        <span key={i} className={myUserId ? EVERYONE_CLASS : "mention"}>
          {part.text}
        </span>
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
        <Fragment key={i}>
          {splitEmoji(part.text).map((run, j) =>
            run.emoji ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
              <span key={j} className="emoji">
                {run.text}
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
              <Fragment key={j}>{marked(run.text, highlight)}</Fragment>
            ),
          )}
        </Fragment>
      ),
    );

  // Someone or something this channel can't find reads as its saved
  // handle, as plain text.
  const mention = (
    ref: MentionRef,
    key: number,
    inControl: boolean,
  ): ReactNode => {
    const handle = currentHandle(ref, members, groups);
    if (handle === null) {
      return <Fragment key={key}>{text(`@${ref.handle}`)}</Fragment>;
    }
    const group = ref.kind === "group" ? groups.get(ref.id) : undefined;
    const className = group
      ? groupMentionClass(group, myUserId)
      : mentionClass(members.get(ref.id), myUserId);
    const open = (anchor: DOMRect) => {
      if (group) onGroup?.(group, anchor);
      else onMention?.(ref.id, anchor);
    };
    const clickable = !inControl && (group ? !!onGroup : !!onMention);
    return clickable ? (
      <button
        key={key}
        type="button"
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          open(event.currentTarget.getBoundingClientRect());
        }}
      >
        @{handle}
      </button>
    ) : (
      <span key={key} className={className}>
        @{handle}
      </span>
    );
  };

  const inline = (nodes: Inline[], inControl = false): ReactNode =>
    nodes.map((n, i) => {
      const key = i;
      switch (n.type) {
        case "text":
          return <Fragment key={key}>{text(n.text)}</Fragment>;
        case "mention":
          return mention(n.mention, key, inControl);
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
              // Words can say anything; the address is one hover away.
              title={n.label ? n.href : undefined}
            >
              {n.label ? inline(n.label, true) : n.href}
            </a>
          );
        case "bold":
          return <strong key={key}>{inline(n.children, inControl)}</strong>;
        case "italic":
          return <em key={key}>{inline(n.children, inControl)}</em>;
        case "underline":
          return <u key={key}>{inline(n.children, inControl)}</u>;
        case "strike":
          return <s key={key}>{inline(n.children, inControl)}</s>;
        case "spoiler":
          return <Spoiler key={key}>{inline(n.children, true)}</Spoiler>;
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

  return <>{blocks.map(block)}</>;
}

// A text run with search hits wrapped in <mark>.
function marked(s: string, pattern: RegExp | null | undefined): ReactNode {
  if (!pattern) return s;
  const out: ReactNode[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  for (const m of s.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    out.push(
      <mark key={at} className="search-hit">
        {m[0]}
      </mark>,
    );
    last = at + m[0].length;
  }
  if (last === 0) return s;
  if (last < s.length) out.push(s.slice(last));
  return out;
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
