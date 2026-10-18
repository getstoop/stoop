import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AttachmentSchema,
  MessageSchema,
} from "../../gen/stoop/chat/v1/message_pb";
import { PinnedMessageSchema } from "../../gen/stoop/chat/v1/pin_pb";
import { PinRow } from "./PinRow";

vi.mock("../../api/clients", () => ({ chatClient: {}, authClient: {} }));

const pin = create(PinnedMessageSchema, {
  message: create(MessageSchema, {
    id: "m1",
    channelId: "general",
    content: "see https://example.com and ||the ending||",
    attachments: [
      create(AttachmentSchema, {
        fileId: "f1",
        name: "photo.png",
        contentType: "image/png",
      }),
      create(AttachmentSchema, {
        fileId: "f2",
        name: "notes.pdf",
        contentType: "application/pdf",
      }),
    ],
  }),
});

const render = () =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PinRow, {
        pin,
        members: new Map(),
        groups: new Map(),
        channels: new Map(),
        canUnpin: true,
        onOpen: () => {},
        onUnpin: () => {},
      }),
    ),
  );

// The open button's children, by matching each <button> to its close.
function buttonContents(html: string): string[] {
  const out: string[] = [];
  const tag = /<(\/?)button\b[^>]*>/g;
  const open: number[] = [];
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (m[1]) {
      const start = open.pop();
      if (start !== undefined && open.length === 0)
        out.push(html.slice(start, m.index));
    } else {
      open.push(m.index + m[0].length);
    }
  }
  return out;
}

describe("PinRow", () => {
  it("renders the links and file controls it holds", () => {
    const html = render();
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("photo.png");
    expect(html).toContain("notes.pdf");
  });

  it("puts no link or button inside a button", () => {
    for (const inner of buttonContents(render())) {
      expect(inner).not.toMatch(/<(a|button)\b/);
    }
  });
});
