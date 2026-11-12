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
// - A server is sent one call at a time, and after it only the newest
//   that waited, so two quick changes can't land out of order.

// Do not disturb as a server's account has it.
export type AccountDnd = Pick<User, "dnd" | "dndUntil">;

export type DndDeps = {
  // SetDoNotDisturb on one server: the account as the server then has it.
  send: (server: SavedServer, on: boolean, until: Date | undefined) => Promise<AccountDnd | undefined>;
  // The account as one server has it now (GetMe).
  account: (server: SavedServer) => Promise<AccountDnd | undefined>;
  save: (next: DndSwitch) => void;
  now: () => number;
  // Runs done after ms; the returned function calls it off.
  wait: (ms: number, done: () => void) => () => void;
};

export type DndStore = {
  // The switch as it reads now: off until the saved one is read, and
  // once its end has passed. The same object until it changes.
  current: () => DndSwitch;
  // Told when the person moves the switch, when the saved one is read
  // as on, and when its end passes.
  subscribe: (listener: () => void) => () => void;
  // The saved switch, read as the app starts. Too late once the person
  // has moved the switch: theirs stands.
  loaded: (saved: DndSwitch) => void;
  // The person moved the switch or picked a duration.
  set: (next: DndSwitch, servers: SavedServer[]) => void;
  // The app came back to the front, where no timer ran: an end that
  // passed meanwhile is told now.
  woke: () => void;
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

type Call = { server: SavedServer; run: () => Promise<AccountDnd | undefined>; reads: boolean };

export function dndStore({ send, account, save, now, wait }: DndDeps): DndStore {
  let saved = DND_OFF;
  // The person has moved the switch since the app started.
  let moved = false;
  let stopWaiting = () => {};
  const listeners = new Set<() => void>();
  // The servers whose sockets have said Ready, by ID.
  const reached = new Map<string, SavedServer>();
  const accounts = new Map<string, AccountDnd>();
  // By server: the last thing that spoke of its account, a call going
  // out or the server's own event. An answer lands only while its call
  // is still that, so a slow one never writes over later news.
  const latest = new Map<string, number>();
  let calls = 0;
  // By server: whether a call is out, and the one to make when it settles.
  const out = new Set<string>();
  const next = new Map<string, Call>();

  const current = () => switchAt(saved, now());
  const notify = () => {
    for (const listener of listeners) listener();
  };

  // Tells the listeners when the switch's end passes. A timer that
  // fires early waits out the rest.
  const watchEnd = () => {
    stopWaiting();
    stopWaiting = () => {};
    const held = current();
    if (!held.on || held.until === null) return;
    stopWaiting = wait(Math.max(0, held.until - now()), () => {
      if (current().on) watchEnd();
      else notify();
    });
  };

  const make = (call: Call) => {
    const { id } = call.server;
    const mine = ++calls;
    latest.set(id, mine);
    out.add(id);
    call
      .run()
      .then((answer) => {
        if (answer && latest.get(id) === mine) accounts.set(id, answer);
      })
      // The server stays as it was, and so does what is known of it.
      .catch(() => {})
      .then(() => {
        out.delete(id);
        const waiting = next.get(id);
        next.delete(id);
        if (waiting) make(waiting);
      });
  };

  // One call at a time to a server. Behind one that is out, only the
  // newest waits, except that a read never takes the place of a change:
  // the change's answer says what the read would.
  const ask = (call: Call) => {
    const { id } = call.server;
    if (!out.has(id)) make(call);
    else if (!call.reads || !next.has(id)) next.set(id, call);
  };

  const tell = (server: SavedServer, to: DndSwitch) => {
    const until = to.on && to.until !== null ? new Date(to.until) : undefined;
    ask({ server, run: () => send(server, to.on, until), reads: false });
  };

  return {
    current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loaded: (read) => {
      if (moved) return;
      saved = read;
      const held = current();
      if (!held.on) return;
      watchEnd();
      notify();
      // Any that connected before the read came back were only asked.
      for (const server of reached.values()) tell(server, held);
    },
    set: (to, servers) => {
      // Off by the clock already: its end passed, and each server ends
      // its own, so turning it off tells none.
      const nothingToSay = !to.on && !current().on;
      moved = true;
      saved = to;
      save(to);
      watchEnd();
      notify();
      if (nothingToSay) return;
      for (const server of servers) tell(server, to);
    },
    woke: () => {
      watchEnd();
      notify();
    },
    connected: (server) => {
      reached.set(server.id, server);
      const held = current();
      if (held.on) tell(server, held);
      // Off says nothing to the server: only what it has is read.
      else ask({ server, run: () => account(server), reads: true });
    },
    accountChanged: (serverId, changed) => {
      latest.set(serverId, ++calls);
      accounts.set(serverId, changed);
    },
    forget: (serverId) => {
      latest.set(serverId, ++calls);
      reached.delete(serverId);
      accounts.delete(serverId);
      // What waited was the old session's to say.
      next.delete(serverId);
    },
    holds: (serverId) => current().on || dndActive(accounts.get(serverId), new Date(now())),
  };
}
