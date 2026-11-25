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

const channel: CommandPlace = { thread: false, canPost: true };
const thread: CommandPlace = { thread: true, canPost: true };
const closed: CommandPlace = { thread: false, canPost: false };

const names = (draft: string, place = channel) => {
  const query = commandQueryAt(draft);
  return query ? matchingCommands(query, place).map((c) => c.name) : [];
};

describe("commandsOffered", () => {
  it("offers /poll where the poll button shows", () => {
    expect(commandsOffered(channel).map((c) => c.name)).toEqual(["poll"]);
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
    expect(names("/")).toEqual(["poll"]);
  });

  it("filters by the letters typed", () => {
    expect(names("/p")).toEqual(["poll"]);
    expect(names("/poll")).toEqual(["poll"]);
    expect(names("/x")).toEqual([]);
    expect(names("/polls")).toEqual([]);
  });

  it("after a space keeps only the command so named", () => {
    expect(names("/poll Pizza?")).toEqual(["poll"]);
    expect(names("/po Pizza?")).toEqual([]);
  });

  it("lists nothing in a thread", () => {
    expect(names("/", thread)).toEqual([]);
    expect(names("/poll Pizza?", thread)).toEqual([]);
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
});
