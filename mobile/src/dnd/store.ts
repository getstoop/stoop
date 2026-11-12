import { dndActive } from "@stoop/core/doNotDisturb";
import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import type { SavedServer } from "../api/servers";
import { DND_OFF, type DndSwitch, switchAt } from "./switch";

// Do not disturb for the whole app: the phone's switch and what each
// server's account says, held outside React so a notification can ask
// as it arrives. The switch follows the desktop app's
// (docs/architecture/desktop.md → Do not disturb):
//
// - Moving it tells every saved server, on with its end or off.
// - A server that connects while it is on is told on, with the same end.
// - Nothing but the person turning it off ever tells a server off:
//   starting the app, connecting and an end passing all say nothing, or
//   they would clear do not disturb set from another device. Each server
//   ends its own.
// - A call that fails leaves that server as it was; its next connect
//   tries again while the switch is on.

// Do not disturb as a server's account has it.
export type AccountDnd = Pick<User, "dnd" | "dndUntil">;

export type DndDeps = {
  // SetDoNotDisturb on one server: the account as the server then has it.
  send: (server: SavedServer, on: boolean, until: Date | undefined) => Promise<AccountDnd | undefined>;
  // The account as one server has it now (GetMe).
  account: (server: SavedServer) => Promise<AccountDnd | undefined>;
  save: (next: DndSwitch) => void;
  now: () => number;
};

export type DndStore = {
  // The switch as it reads now: off until the saved one is read, and
  // once its end has passed (which tells no listener: useDndSwitch
  // draws again then). The same object until it changes.
  current: () => DndSwitch;
  subscribe: (listener: () => void) => () => void;
  // The saved switch, read as the app starts.
  loaded: (saved: DndSwitch) => void;
  // The person moved the switch or picked a duration.
  set: (next: DndSwitch, servers: SavedServer[]) => void;
  // A server's socket said Ready: the first connect or a later one.
  connected: (server: SavedServer) => void;
  // A server said its account's do not disturb changed, on any device.
  accountChanged: (serverId: string, account: AccountDnd) => void;
  // A server's session is gone.
  forget: (serverId: string) => void;
  // Whether a server's banners are held: the switch is on, or the
  // server's own account says do not disturb and its end hasn't passed.
  holds: (serverId: string) => boolean;
};

export function dndStore({ send, account, save, now }: DndDeps): DndStore {
  let held = DND_OFF;
  const listeners = new Set<() => void>();
  const connected = new Map<string, SavedServer>();
  const accounts = new Map<string, AccountDnd>();
  // By server: the last thing that spoke of its account, a call going
  // out or the server's own event. An answer lands only while its call
  // is still that, so a slow one never writes over later news.
  const latest = new Map<string, number>();
  let calls = 0;

  const current = () => switchAt(held, now());

  const ask = (server: SavedServer, call: Promise<AccountDnd | undefined>) => {
    const mine = ++calls;
    latest.set(server.id, mine);
    call
      .then((answer) => {
        if (answer && latest.get(server.id) === mine) accounts.set(server.id, answer);
      })
      // The server stays as it was, and so does what is known of it.
      .catch(() => {});
  };

  const tell = (server: SavedServer, next: DndSwitch) =>
    ask(server, send(server, next.on, next.on && next.until !== null ? new Date(next.until) : undefined));

  return {
    current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loaded: (saved) => {
      held = saved;
      const next = current();
      if (!next.on) return;
      for (const listener of listeners) listener();
      // Any that connected before the read came back were only asked.
      for (const server of connected.values()) tell(server, next);
    },
    set: (next, servers) => {
      held = next;
      save(next);
      for (const listener of listeners) listener();
      for (const server of servers) tell(server, next);
    },
    connected: (server) => {
      connected.set(server.id, server);
      const next = current();
      if (next.on) tell(server, next);
      // Off says nothing to the server: only what it has is read.
      else ask(server, account(server));
    },
    accountChanged: (serverId, changed) => {
      latest.set(serverId, ++calls);
      accounts.set(serverId, changed);
    },
    forget: (serverId) => {
      latest.set(serverId, ++calls);
      connected.delete(serverId);
      accounts.delete(serverId);
    },
    holds: (serverId) => current().on || dndActive(accounts.get(serverId), new Date(now())),
  };
}
