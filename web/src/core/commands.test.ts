import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  type CommandPlace,
  commandQueryAt,
  commandsOffered,
  matchingCommands,
  parseCommand,
  pickedText,
} from "./commands";

const BOTH = ["poll", "remind"] as const;
const channel: CommandPlace = { thread: false, canPost: true, opens: BOTH };
const thread: CommandPlace = { thread: true, canPost: true, opens: BOTH };
const closed: CommandPlace = { thread: false, canPost: false, opens: BOTH };
// An app with a form for /poll alone.
const pollOnly: CommandPlace = {
  thread: false,
  canPost: true,
  opens: ["poll"],
};

const names = (draft: string, place = channel) => {
  const query = commandQueryAt(draft);
  return query ? matchingCommands(query, place).map((c) => c.name) : [];
};

describe("commandsOffered", () => {
  it("offers /poll and /remind where the poll button shows", () => {
    expect(commandsOffered(channel).map((c) => c.name)).toEqual([
      "poll",
      "remind",
    ]);
    expect(commandsOffered(channel)[1]).toMatchObject({
      hint: "[what]",
      description: "Set a reminder here",
    });
  });

  it("offers only what the app has a form for, and reads only that", () => {
    expect(commandsOffered(pollOnly).map((c) => c.name)).toEqual(["poll"]);
    const query = commandQueryAt("/");
    expect(
      query && matchingCommands(query, pollOnly).map((c) => c.name),
    ).toEqual(["poll"]);
    expect(parseCommand("/remind Call the venue", pollOnly)).toBeNull();
    expect(
      commandsOffered({ thread: false, canPost: true, opens: [] }),
    ).toEqual([]);
  });

  it("offers nothing in a thread or where posting is closed", () => {
    expect(commandsOffered(thread)).toEqual([]);
    expect(commandsOffered(closed)).toEqual([]);
  });

  it("gives every command a hint and a description", () => {
    for (const command of COMMANDS) {
      expect(command.name).toMatch(/^[a-z]+$/);
      expect(command.hint).not.toBe("");
      expect(command.description).not.toBe("");
    }
  });
});

describe("commandQueryAt", () => {
  it("opens on a lone slash", () => {
    expect(commandQueryAt("/")).toEqual({ query: "", spaced: false });
  });

  it("takes the letters after the slash, in lower case", () => {
    expect(commandQueryAt("/po")).toEqual({ query: "po", spaced: false });
    expect(commandQueryAt("/PoLL")).toEqual({ query: "poll", spaced: false });
  });

  it("stays on a name once a space follows it", () => {
    expect(commandQueryAt("/poll ")).toEqual({ query: "poll", spaced: true });
    expect(commandQueryAt("/poll Pizza?")).toEqual({
      query: "poll",
      spaced: true,
    });
  });

  it("is shut for anything but a slash and letters at the start", () => {
    for (const draft of [
      "",
      "poll",
      " /poll",
      "hi /poll",
      "/po1",
      "/usr/local",
      "/ poll",
      "`/poll`",
      "> /poll",
      "- /poll",
      "**/poll**",
    ]) {
      expect(commandQueryAt(draft), draft).toBeNull();
    }
  });
});

describe("matchingCommands", () => {
  it("lists every command for a lone slash", () => {
    expect(names("/")).toEqual(["poll", "remind"]);
  });

  it("filters by the letters typed", () => {
    expect(names("/p")).toEqual(["poll"]);
    expect(names("/poll")).toEqual(["poll"]);
    expect(names("/x")).toEqual([]);
    expect(names("/polls")).toEqual([]);
    expect(names("/re")).toEqual(["remind"]);
    expect(names("/reminders")).toEqual([]);
  });

  it("after a space keeps only the command so named", () => {
    expect(names("/poll Pizza?")).toEqual(["poll"]);
    expect(names("/po Pizza?")).toEqual([]);
    expect(names("/remind Order the pizza")).toEqual(["remind"]);
  });

  it("lists nothing in a thread", () => {
    expect(names("/", thread)).toEqual([]);
    expect(names("/poll Pizza?", thread)).toEqual([]);
    expect(names("/remind Pizza", thread)).toEqual([]);
  });
});

describe("parseCommand", () => {
  const parsed = (content: string, place = channel) => {
    const found = parseCommand(content, place);
    return found && { name: found.command.name, text: found.text };
  };

  it("finds a known command alone or before a space", () => {
    expect(parsed("/poll")).toEqual({ name: "poll", text: "" });
    expect(parsed("/poll Pizza or tacos?")).toEqual({
      name: "poll",
      text: "Pizza or tacos?",
    });
    expect(parsed("/POLL Pizza?")).toEqual({ name: "poll", text: "Pizza?" });
  });

  it("carries the rest as plain words", () => {
    expect(parsed("/poll **Pizza** or *tacos*?")).toEqual({
      name: "poll",
      text: "Pizza or tacos?",
    });
    expect(
      parsed(
        "/poll Ask <@u:00000000-0000-4000-8000-000000000001:ana> about [it](https://a.example)",
      ),
    ).toEqual({ name: "poll", text: "Ask @ana about it" });
    expect(parsed("/poll one\ntwo")).toEqual({ name: "poll", text: "one two" });
  });

  it("makes tabs and control characters one space", () => {
    expect(parsed("/poll Pizza\tor\u0007 \u00a0tacos?\t")).toEqual({
      name: "poll",
      text: "Pizza or tacos?",
    });
  });

  it("is a message for anything else", () => {
    for (const content of [
      "/shrug",
      "/polls",
      "/pollster now",
      "/usr/local",
      "/poll/x",
      "`/poll Pizza?`",
      "\\/poll",
      "> /poll Pizza?",
      "say /poll",
      "",
    ]) {
      expect(parseCommand(content, channel), content).toBeNull();
    }
  });

  it("is a message in a thread", () => {
    expect(parseCommand("/poll Pizza?", thread)).toBeNull();
    expect(parseCommand("/remind Pizza", thread)).toBeNull();
  });

  it("reads /remind and its words", () => {
    expect(parsed("/remind")).toEqual({ name: "remind", text: "" });
    expect(parsed("/remind Order the **pizza** before seven")).toEqual({
      name: "remind",
      text: "Order the pizza before seven",
    });
    expect(parseCommand("/reminder at six", channel)).toBeNull();
  });
});

describe("pickedText", () => {
  const [poll] = COMMANDS;

  it("is empty for a name still being typed", () => {
    expect(pickedText("/", poll)).toBe("");
    expect(pickedText("/po", poll)).toBe("");
    expect(pickedText("/poll", poll)).toBe("");
  });

  it("carries the words after the name", () => {
    expect(pickedText("/poll What are we playing?", poll)).toBe(
      "What are we playing?",
    );
  });

  it("carries the words only to the command named", () => {
    const remind = COMMANDS.find((command) => command.name === "remind");
    if (!remind) throw new Error("no /remind");
    expect(pickedText("/remind Call the venue", remind)).toBe("Call the venue");
    expect(pickedText("/poll Call the venue", remind)).toBe("");
  });
});
