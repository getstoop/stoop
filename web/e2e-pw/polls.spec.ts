import type { Page } from "@playwright/test";
import {
  acceptDialog,
  COMPOSER,
  channelLink,
  expect,
  focus,
  moreAction,
  rowByText,
  seed,
  sendMessage,
  signIn,
  test,
} from "./lib";

// Polls (STOOP-547): one is made from the composer's plus menu, a vote
// from someone else reaches its author live, and closing records a row
// that goes to the poll. Posting and closing mark the channel unread for
// the others; deleting the poll takes both rows away for everyone.
test("a poll from the composer, voted on, closed and deleted", async ({
  browser,
}) => {
  const { tokens, channels } = await seed({ channels: ["general", "random"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await channelLink(A, "general").click();
  // Bea waits in #random, where a poll in #general shows as unread.
  await channelLink(B, "random").click();
  await expect(B.locator(COMPOSER)).toBeVisible();

  const QUESTION = "What are we playing on Friday?";
  const card = (page: Page) => page.locator(".poll-row", { hasText: QUESTION });
  const closing = (page: Page) =>
    page.locator(".system-row", { hasText: "closed the poll" });
  const option = (page: Page, name: RegExp) =>
    card(page).getByRole("radio", { name });

  // Ada has words in the composer; making a poll leaves them alone.
  await A.locator(COMPOSER).click();
  await A.locator(COMPOSER).pressSequentially("half a thought");
  await moreAction(A, "Create a poll");
  const form = A.getByRole("dialog", { name: "Create a poll" });
  await expect(form).toBeVisible();
  await expect(
    form.getByRole("textbox", { name: "Question" }),
    "the question has focus as the form opens",
  ).toBeFocused();
  const post = form.getByRole("button", { name: "Post poll" });
  await expect(post, "Post is off on an empty form").toBeDisabled();

  await form.getByRole("textbox", { name: "Question" }).fill(QUESTION);
  await form.getByRole("textbox", { name: "Option 1" }).fill("Co-op campaign");
  await form.getByRole("textbox", { name: "Option 2" }).fill("Racing league");
  // Enter in a filled last option adds the next one.
  await form.getByRole("textbox", { name: "Option 2" }).press("Enter");
  await expect(form.getByRole("textbox", { name: "Option 3" })).toBeFocused();
  await form.getByRole("textbox", { name: "Option 3" }).fill("racing LEAGUE");
  await expect(
    form.getByText("This option is already in the list."),
    "a duplicate, ignoring case, is said under it",
  ).toBeVisible();
  await expect(post, "…and Post is off").toBeDisabled();
  await form.getByRole("textbox", { name: "Option 3" }).fill("Card night");
  await expect(post).toBeEnabled();
  await post.click();

  await expect(form, "the form closes once it is posted").toHaveCount(0);
  await expect(card(A), "the poll is in Ada's list").toBeVisible();
  await expect(
    A.locator(COMPOSER),
    "the composer's words are as they were",
  ).toHaveText("half a thought");
  await expect(A.locator(COMPOSER), "…and have focus").toBeFocused();

  await expect(
    channelLink(B, "general"),
    "the poll marks #general unread for Bea",
  ).toHaveClass(/unread/);

  // Bea votes; Ada sees it live, and then the vote moved.
  await focus(B);
  await channelLink(B, "general").click();
  await option(B, /^Racing league/).click();
  await expect(option(B, /^Racing league, 1 vote, your vote/)).toBeVisible();
  await expect(
    option(A, /^Racing league, 1 vote/),
    "Ada sees Bea's vote live",
  ).toBeVisible();
  await option(B, /^Card night/).click();
  await expect(option(A, /^Card night, 1 vote/)).toBeVisible();
  await expect(
    option(A, /^Racing league, 0 votes/),
    "a moved vote leaves the old option",
  ).toBeVisible();

  // Bea has read #general; she goes to #random, and Ada closes the poll.
  // A message in #random after it is the sign she has had the closing
  // row too, as one socket delivers both in order.
  await channelLink(B, "random").click();
  await expect(B.locator(COMPOSER)).toBeVisible();
  await expect(channelLink(B, "general")).not.toHaveClass(/unread/);
  await card(A).locator(".poll-close").click();
  await A.locator(".poll-confirm .primary").click();
  await expect(closing(A), "the closing row is in Ada's list").toBeVisible();
  await expect(closing(A)).toContainText("Winner: Card night");
  await sendMessage(tokens.ada, channels.random, "after the close");
  await expect(rowByText(B, "after the close")).toBeVisible();
  await expect(
    channelLink(B, "general"),
    "closing marks #general unread for Bea",
  ).toHaveClass(/unread/);

  // View on the closing row goes to the poll.
  await channelLink(B, "general").click();
  await expect(closing(B)).toBeVisible();
  await expect(card(B)).toContainText("Closed");
  await closing(B).getByRole("button", { name: "View poll" }).click();
  await expect(
    B.locator(".poll-row.flash", { hasText: QUESTION }),
    "View lands on the poll",
  ).toBeVisible();

  // Ada deletes the poll: it and its closing row go, for both.
  await card(A).hover();
  await card(A).getByRole("button", { name: "Delete poll" }).click();
  await acceptDialog(A);
  await expect(card(A)).toHaveCount(0);
  await expect(closing(A), "the closing row goes with it").toHaveCount(0);
  await expect(card(B), "…for Bea too, live").toHaveCount(0);
  await expect(closing(B)).toHaveCount(0);
});

// A poll of several choices takes more than one vote from each person;
// the form belongs to the channel it was opened in and closes when the
// page moves to another; a thread's composer offers no poll.
test("several choices, a form left behind, and no poll in a thread", async ({
  browser,
}) => {
  const { tokens, channels } = await seed({ channels: ["general", "random"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await channelLink(B, "general").click();

  // Ada opens the form in #random, then goes back to #general: the form
  // closes rather than posting into the channel now shown.
  await channelLink(A, "general").click();
  await channelLink(A, "random").click();
  await expect(A.locator(".channel-title")).toHaveText("random");
  await moreAction(A, "Create a poll");
  const form = A.getByRole("dialog", { name: "Create a poll" });
  await form.getByRole("textbox", { name: "Question" }).fill("Left behind?");
  await A.goBack();
  await expect(A.locator(".channel-title")).toHaveText("general");
  await expect(form, "leaving the channel closes its form").toHaveCount(0);

  // A poll of several choices in #general.
  const QUESTION = "Which nights work?";
  await moreAction(A, "Create a poll");
  await form.getByRole("textbox", { name: "Question" }).fill(QUESTION);
  await form.getByRole("button", { name: "Several options" }).click();
  await form.getByRole("textbox", { name: "Option 1" }).fill("Friday");
  await form.getByRole("textbox", { name: "Option 2" }).fill("Saturday");
  await form.getByRole("button", { name: "Post poll" }).click();
  await expect(form).toHaveCount(0);

  const card = (page: Page) => page.locator(".poll-row", { hasText: QUESTION });
  const box = (page: Page, name: RegExp) =>
    card(page).getByRole("checkbox", { name });
  await expect(card(B), "the poll reaches Bea").toBeVisible();
  // Both choose Friday; Ada also chooses Saturday.
  await box(A, /^Friday/).click();
  await expect(box(A, /^Friday, 1 vote, your vote/)).toBeVisible();
  await box(A, /^Saturday/).click();
  await expect(box(A, /^Saturday, 1 vote, your vote/)).toBeVisible();
  await box(B, /^Friday/).click();
  await expect(box(B, /^Friday, 2 votes, your vote/)).toBeVisible();
  await expect(
    box(A, /^Friday, 2 votes, your vote/),
    "Ada sees Bea's vote live, beside her own two",
  ).toBeVisible();
  await expect(box(B, /^Saturday, 1 vote$/)).toBeVisible();
  // Ada takes one of hers back; the other stays.
  await box(A, /^Saturday/).click();
  await expect(box(B, /^Saturday, 0 votes$/)).toBeVisible();
  await expect(box(A, /^Friday, 2 votes, your vote/)).toBeVisible();

  // A thread: its composer has no plus, so no poll; the channel's still
  // has.
  await sendMessage(tokens.ada, channels.general, "thread root");
  const root = rowByText(A, "thread root");
  await root.hover();
  await root.locator('.message-action[aria-label="Reply in thread"]').click();
  const panel = A.locator(".side-panel");
  await expect(panel.locator(COMPOSER)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "More actions", exact: true }),
    "no poll in a thread",
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Attach files" }),
    "the paperclip stays",
  ).toBeVisible();
  await expect(
    A.locator(".channel-view").getByRole("button", {
      name: "More actions",
      exact: true,
    }),
  ).toBeVisible();
});
