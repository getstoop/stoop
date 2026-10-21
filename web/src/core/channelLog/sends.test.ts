import { describe, expect, it } from "vitest";
import { withEvent } from "./events";
import { channelItems, threadItems } from "./items";
import { sendFailed, sendStarted, sendSucceeded } from "./sends";
import {
  event,
  id,
  ids,
  message,
  openedOn,
  openedThread,
  rows,
} from "./testing";

const me = { id: "me" };
const draft = message("draft-1", { content: "hello", seq: 0n, author: me });
const made = message(id(10), { content: "hello", seq: 11n, author: me });
const live = () => openedOn(rows(0, 10), { hasOlder: false });

describe("a send", () => {
  it("shows the draft at the bottom while out, not in the map", () => {
    const log = sendStarted(live(), draft);
    expect(ids(channelItems(log))).toEqual([...ids(rows(0, 10)), "draft-1"]);
    expect(log.rows.has("draft-1")).toBe(false);
  });

  it("retires the draft on the answer, with the event arriving after", () => {
    const answered = sendSucceeded(sendStarted(live(), draft), "draft-1", made);
    expect(ids(channelItems(answered))).toEqual([...ids(rows(0, 10)), id(10)]);
    expect(answered.pending).toEqual([]);
    const log = withEvent(
      answered,
      event({ case: "messageCreated", value: made }),
    );
    expect(ids(channelItems(log))).toEqual([...ids(rows(0, 10)), id(10)]);
  });

  it("retires the draft when the event arrives before the answer", () => {
    const heard = withEvent(
      sendStarted(live(), draft),
      event({ case: "messageCreated", value: made }),
    );
    expect(ids(channelItems(heard))).toEqual([...ids(rows(0, 10)), id(10)]);
    expect(heard.pending).toEqual([]);
    const log = sendSucceeded(heard, "draft-1", made);
    expect(ids(channelItems(log))).toEqual([...ids(rows(0, 10)), id(10)]);
  });

  it("leaves another reader's like-worded row to its own draft", () => {
    const theirs = message(id(10), {
      content: "hello",
      seq: 11n,
      author: { id: "them" },
    });
    const log = withEvent(
      sendStarted(live(), draft),
      event({ case: "messageCreated", value: theirs }),
    );
    expect(ids(channelItems(log))).toEqual([
      ...ids(rows(0, 10)),
      id(10),
      "draft-1",
    ]);
  });

  it("removes the draft on failure", () => {
    const log = sendFailed(sendStarted(live(), draft), "draft-1");
    expect(ids(channelItems(log))).toEqual(ids(rows(0, 10)));
    expect(sendFailed(log, "draft-1")).toBe(log);
  });

  it("shows a thread's draft in the thread alone", () => {
    const root = id(3);
    const reply = message("draft-2", {
      content: "re",
      seq: 0n,
      author: me,
      threadRootId: root,
      inChannel: false,
    });
    const log = sendStarted(openedThread(live(), root, []), reply);
    expect(ids(threadItems(log, root))).toEqual([root, "draft-2"]);
    expect(ids(channelItems(log))).not.toContain("draft-2");
  });
});
