import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Composer } from "./Composer";

// The composer in a public channel, its reads answered here instead of by
// a server. What Send would post is shown below it: the content exactly as
// SendMessage carries it, mention tokens and Markdown included. Like a
// channel, the composer sits at the bottom with the newest send above it.

const SPACE = "00000000-0000-4000-8000-0000000000a1";
const CHANNEL = "00000000-0000-4000-8000-0000000000b1";

const member = (id: string, username: string, displayName: string) => ({
  userId: `00000000-0000-4000-8000-00000000000${id}`,
  username,
  displayName,
  role: "SPACE_ROLE_MEMBER",
  kind: "IDENTITY_KIND_PERSON",
});

const ANSWERS: Record<string, unknown> = {
  ListSpaces: {
    spaces: [
      {
        id: SPACE,
        name: "The Stoop",
        myRole: "SPACE_ROLE_OWNER",
        myPermissions: ["PERMISSION_MESSAGES_NOTIFY_ENTIRE_CHANNEL"],
      },
    ],
  },
  ListChannels: {
    channels: [
      {
        id: CHANNEL,
        spaceId: SPACE,
        name: "general",
        kind: "CHANNEL_KIND_TEXT",
      },
    ],
  },
  ListMembers: {
    members: [
      member("1", "casey", "Casey Nolan"),
      member("2", "ada", "Ada Okafor"),
      member("3", "bea", "Bea"),
      { ...member("4", "uptime", "Uptime"), kind: "IDENTITY_KIND_BOT" },
    ],
  },
  ListGroups: {
    groups: [
      {
        id: "00000000-0000-4000-8000-0000000000c1",
        spaceId: SPACE,
        handle: "gardeners",
        name: "Garden crew",
        userIds: ["00000000-0000-4000-8000-000000000002"],
      },
    ],
  },
};

// Answers the composer's calls while mounted; SendMessage's request is
// handed to onSend.
function stubServer(onSend: (request: { content: string }) => void) {
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.slice(url.lastIndexOf("/") + 1);
    if (method === "SendMessage" && init?.body) {
      const body =
        typeof init.body === "string"
          ? init.body
          : new TextDecoder().decode(init.body as Uint8Array);
      onSend(JSON.parse(body));
    }
    return new Response(JSON.stringify(ANSWERS[method] ?? {}), {
      headers: { "Content-Type": "application/json" },
    });
  };
  return () => {
    window.fetch = realFetch;
  };
}

function ComposerWithSent() {
  const [sent, setSent] = useState<{ id: number; content: string }[]>([]);
  // Installed during the first render, before the composer's queries run.
  const [restore] = useState(() =>
    stubServer(({ content }) =>
      setSent((list) => [...list, { id: list.length, content }]),
    ),
  );
  useEffect(() => restore, [restore]);
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <div className="kit-channel">
        <div className="kit-channel-sent">
          <h3>Sent to the server</h3>
          {sent.length === 0 ? (
            <p className="muted">
              Nothing yet. Type a message and press Enter.
            </p>
          ) : (
            sent.map(({ id, content }) => (
              <pre key={id} className="kit-mono kit-sent">
                {content}
              </pre>
            ))
          )}
        </div>
        <Composer
          channelId={CHANNEL}
          channelName="general"
          spaceId={SPACE}
          replyTo={null}
          onCancelReply={() => {}}
          onEditLast={() => {}}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof Composer> = {
  title: "Channel/Composer",
  component: Composer,
};
export default meta;

export const InAChannel: StoryObj = {
  parameters: { layout: "fullscreen" },
  render: () => <ComposerWithSent />,
};
