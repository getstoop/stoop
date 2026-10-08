import type { Locator, Page } from "@playwright/test";
import {
  acceptDialog,
  channelLink,
  expect,
  gotoShared,
  live,
  seed,
  signIn,
  test,
} from "./lib";

// Threads (STOOP-431): starting one from a message, replies that stay out
// of the channel, the summary under the root following live for someone
// else, the side panel staying open across a channel change, a ?t=&m=
// link, and a root deleted while it has replies.
test("threads", async ({ browser }) => {
  const { space, channels, tokens } = await seed({
    channels: ["general", "random"],
  });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  // The channel and the panel each have a timeline and a composer.
  const channelRows = (p: Page) => p.locator(".channel-view .message");
  const panel = (p: Page) => p.locator(".side-panel");
  const panelRows = (p: Page) => panel(p).locator(".message");
  const summary = (p: Page) => p.locator(".channel-view .thread-summary");
  const sayIn = async (p: Page, where: string, text: string) => {
    await p.locator(`${where} .composer textarea`).fill(text);
    await p.keyboard.press("Enter");
  };
  const act = async (row: Locator, label: string) => {
    await row.hover();
    await row.locator(`.message-action[aria-label="${label}"]`).click();
  };

  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await A.locator(".channel-view .composer textarea").waitFor();
  await B.locator(".channel-view .composer textarea").waitFor();

  await sayIn(A, ".channel-view", "who is bringing chairs on saturday?");
  const root = (p: Page) =>
    channelRows(p).filter({ hasText: "bringing chairs" });
  await expect(root(B), "B has the message").toHaveCount(1);

  // B starts a thread from the message's toolbar.
  await act(root(B), "Reply in thread");
  await expect(panel(B), "the panel opens").toBeVisible();
  await expect(
    panel(B).locator(".side-panel-subtitle"),
    "and says which channel it came from",
  ).toHaveText("#general");
  await expect(
    panelRows(B).first(),
    "with the message at the top",
  ).toContainText("bringing chairs");

  await sayIn(B, ".side-panel", "I have four folding ones");
  await expect(
    panelRows(B).filter({ hasText: "four folding" }),
    "the reply lands in the thread",
  ).toHaveCount(1);
  await expect(
    channelRows(A).filter({ hasText: "four folding" }),
    "and not in the channel",
  ).toHaveCount(0);
  await expect(
    summary(A),
    "A sees the summary appear under the message, live",
  ).toContainText("1 reply");

  // A opens it from the summary and answers; B's thread and summary follow.
  await summary(A).click();
  await expect(
    panelRows(A).filter({ hasText: "four folding" }),
    "the summary opens the thread",
  ).toHaveCount(1);
  await sayIn(A, ".side-panel", "great, I'll bring the cooler");
  await expect(
    panelRows(B).filter({ hasText: "the cooler" }),
    "B's open thread gets A's reply live",
  ).toHaveCount(1);
  await expect(summary(B), "and B's summary counts it").toContainText(
    "2 replies",
  );
  await expect(
    channelRows(B),
    "the channel still holds one message",
  ).toHaveCount(1);

  // The panel belongs to the app, not the channel: it stays open while B
  // looks at another one.
  await channelLink(B, "random").click();
  await expect(B.locator(".channel-title")).toHaveText("random");
  await expect(panel(B), "the panel stays open").toBeVisible();
  await expect(
    panel(B).locator(".side-panel-subtitle"),
    "still on the #general thread",
  ).toHaveText("#general");
  await expect(panelRows(B).filter({ hasText: "the cooler" })).toHaveCount(1);
  await panel(B).locator(".side-panel-close").click();
  await expect(panel(B), "Close closes it").toHaveCount(0);

  // A link to one reply opens the thread on that reply, and the params
  // leave the URL once the panel has them.
  const rootId = (await root(A).getAttribute("id"))?.replace("msg-", "");
  const replyId = (
    await panelRows(A).filter({ hasText: "four folding" }).getAttribute("id")
  )?.replace("thread-msg-", "");
  expect(rootId, "the root's row carries its id").toBeTruthy();
  expect(replyId, "the reply's row carries its id").toBeTruthy();
  await gotoShared(
    B,
    `/s/${space.id}/c/${channels.general}?t=${rootId}&m=${replyId}`,
  );
  await live(B);
  await expect(panel(B), "the link opens the thread").toBeVisible();
  await expect(
    panel(B).locator(".message.flash .message-content"),
    "on the reply it named",
  ).toContainText("four folding");
  await expect
    .poll(() => new URL(B.url()).search, {
      message: "and the params are dropped from the URL",
    })
    .toBe("");

  // A deletes the message while it has replies: it stays as a placeholder
  // that still opens the thread, and the thread takes no new replies.
  await act(root(A), "Delete");
  await acceptDialog(A);
  const placeholder = (p: Page) => p.locator(".channel-view .deleted-root");
  await expect(
    placeholder(B),
    "B's channel shows a placeholder where it was",
  ).toContainText("Original message deleted");
  await expect(
    placeholder(B).locator(".thread-summary"),
    "still with its replies",
  ).toContainText("2 replies");
  await expect(
    panel(B).locator(".side-panel-note"),
    "B's open thread says why it is closed",
  ).toContainText("was deleted");
  await expect(
    panel(B).locator(".composer"),
    "and has no message box",
  ).toHaveCount(0);

  // Once its last reply goes, the placeholder goes too.
  await act(panelRows(B).filter({ hasText: "four folding" }), "Delete");
  await acceptDialog(B);
  await expect(summary(B), "one reply left").toContainText("1 reply");
  await act(panelRows(A).filter({ hasText: "the cooler" }), "Delete");
  await acceptDialog(A);
  await expect(
    placeholder(B),
    "the placeholder leaves with the last reply",
  ).toHaveCount(0);
  await expect(placeholder(A), "for A too").toHaveCount(0);
});
