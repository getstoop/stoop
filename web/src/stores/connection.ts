import { create } from "zustand";
import type { UserPresence } from "../gen/stoop/realtime/v1/realtime_pb";

// Ephemeral connection/UI state lives in zustand; server data lives in
// TanStack Query caches.

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// How long a typing hint stays visible without a refresh.
export const TYPING_TTL_MS = 5000;

interface ConnectionState {
  status: ConnectionStatus;
  userId: string | null;
  // The channel currently on screen, so realtime handlers can tell "new
  // message in the channel I'm reading" from "new message elsewhere".
  activeChannelId: string | null;
  // Users with a live connection who share a space with us (from Ready,
  // kept current by PresenceChanged).
  online: Set<string>;
  // userId → on do not disturb, for everyone online (from Ready.presences,
  // kept current by PresenceChanged). Our own is the signed-in user's
  // (api/presence.ts).
  dnd: Record<string, boolean>;
  // userId → every connection they hold is a mobile app's, for everyone
  // online (the same sources as dnd).
  mobile: Record<string, boolean>;
  // channelId → userId → expiry (ms since epoch) for "is typing…" hints.
  typing: Record<string, Record<string, number>>;
  setStatus: (status: ConnectionStatus) => void;
  setUserId: (userId: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  setOnline: (ids: string[]) => void;
  setPresences: (list: UserPresence[]) => void;
  setPresence: (
    userId: string,
    online: boolean,
    dnd: boolean,
    mobile: boolean,
  ) => void;
  setTyping: (channelId: string, userId: string) => void;
  expireTyping: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "disconnected",
  userId: null,
  activeChannelId: null,
  online: new Set(),
  dnd: {},
  mobile: {},
  typing: {},
  setStatus: (status) => set({ status }),
  setUserId: (userId) => set({ userId }),
  setActiveChannel: (activeChannelId) => set({ activeChannelId }),
  setOnline: (ids) => set({ online: new Set(ids) }),
  setPresences: (list) =>
    set({
      dnd: Object.fromEntries(list.map((p) => [p.userId, p.dnd])),
      mobile: Object.fromEntries(list.map((p) => [p.userId, p.mobile])),
    }),
  setPresence: (userId, online, isDnd, isMobile) =>
    set((s) => {
      const next = new Set(s.online);
      const dnd = { ...s.dnd };
      const mobile = { ...s.mobile };
      if (online) {
        next.add(userId);
        dnd[userId] = isDnd;
        mobile[userId] = isMobile;
      } else {
        next.delete(userId);
        delete dnd[userId];
        delete mobile[userId];
      }
      return { online: next, dnd, mobile };
    }),
  setTyping: (channelId, userId) =>
    set((s) => ({
      typing: {
        ...s.typing,
        [channelId]: {
          ...(s.typing[channelId] ?? {}),
          [userId]: Date.now() + TYPING_TTL_MS,
        },
      },
    })),
  expireTyping: () =>
    set((s) => {
      const now = Date.now();
      const typing: Record<string, Record<string, number>> = {};
      let changed = false;
      for (const [ch, users] of Object.entries(s.typing)) {
        const live = Object.fromEntries(
          Object.entries(users).filter(([, until]) => until > now),
        );
        if (Object.keys(live).length !== Object.keys(users).length)
          changed = true;
        if (Object.keys(live).length > 0) typing[ch] = live;
      }
      return changed ? { typing } : {};
    }),
}));
