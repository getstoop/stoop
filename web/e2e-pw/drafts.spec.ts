import {
  acceptDialog,
  COMPOSER,
  channelLink,
  expect,
  live,
  pastGate,
  reload,
  rowByText,
  seed,
  signIn,
  test,
} from "./lib";

// Drafts (docs/proposals/drafts.md): the words typed in a channel are
// there again after switching away and back and after a reload, gone once
// the field is emptied or the message sent, back with their quote when a
// reply had been started, kept through a refused send and a thread panel
// closing, emptied in an idle tab when another tab sends them, and deleted
// by logging out.
test("drafts stay in their conversation", async ({ browser }) => {
  const { suffix, tokens, channels, password } = await seed({
    channels: ["general", "random"],
  });
  const A = await (await browser.newContext()).newPage();
  const composer = A.locator(COMPOSER);
  const panelComposer = A.locator(`.side-panel ${COMPOSER}`);
  const replyBar = A.locator(".channel-view .reply-bar");
  // Switching saves the draft of the channel left and shows the one of
  // the channel opened.
  const open = async (channel: "general" | "random") => {
    await channelLink(A, channel).click();
    await expect(A).toHaveURL(new RegExp(`/c/${channels[channel]}$`));
  };
  const clearField = async () => {
    await composer.click();
    await A.keyboard.press("ControlOrMeta+a");
    await A.keyboard.press("Backspace");
    await expect(composer).toHaveText("");
  };
  const act = async (text: string, label: string) => {
    const row = rowByText(A, text);
    await row.hover();
    await row.locator(`.message-action[aria-label="${label}"]`).click();
  };

  await signIn(A, tokens.ada);
  await open("general");
  await composer.pressSequentially("half a thought");
  await open("random");
  await expect(composer, "another channel shows its own box").toHaveText("");
  await open("general");
  await expect(composer, "the words are back on return").toHaveText(
    "half a thought",
  );

  await reload(A);
  await expect(composer, "a reload keeps the draft").toHaveText(
    "half a thought",
  );

  // Emptying the field is how a draft is discarded.
  await clearField();
  await open("random");
  await open("general");
  await expect(composer, "an emptied field leaves no draft").toHaveText("");

  await composer.pressSequentially("sent, not kept");
  await A.keyboard.press("Enter");
  await expect(rowByText(A, "sent, not kept")).toHaveCount(1);
  await open("random");
  await open("general");
  await expect(composer, "a sent message leaves no draft").toHaveText("");

  // A send the server never gets: the words come back with the reason,
  // and are still the draft after leaving and returning.
  await A.route("**/SendMessage", (route) => route.abort());
  await composer.pressSequentially("never left");
  await A.keyboard.press("Enter");
  await expect(
    A.locator(".composer .attachment-error"),
    "a refused send says why",
  ).toBeVisible();
  await expect(composer, "and puts the words back").toHaveText("never left");
  await A.unroute("**/SendMessage");
  await open("random");
  await open("general");
  await expect(composer, "the refused words are the draft").toHaveText(
    "never left",
  );
  await clearField();

  // A reply started comes back with its quote.
  await act("sent, not kept", "Reply");
  await expect(replyBar).toContainText("sent, not kept");
  await composer.pressSequentially("and a reply");
  await open("random");
  await expect(replyBar, "the quote stays with its channel").toHaveCount(0);
  await open("general");
  await expect(replyBar, "the quote is back").toContainText("sent, not kept");
  await expect(composer, "with the words").toHaveText("and a reply");

  // A thread's draft survives its panel closing.
  await act("sent, not kept", "Reply in thread");
  await panelComposer.pressSequentially("a thread thought");
  await A.locator(".side-panel-close").click();
  await expect(A.locator(".side-panel")).toHaveCount(0);
  await act("sent, not kept", "Reply in thread");
  await expect(panelComposer, "the thread's words are back").toHaveText(
    "a thread thought",
  );
  await A.locator(".side-panel-close").click();
  await expect(A.locator(".side-panel")).toHaveCount(0);
  await expect(composer, "the channel's draft is untouched").toHaveText(
    "and a reply",
  );

  // A second tab shows the same draft; sending it there empties the field
  // here, so the words can't go twice.
  const B = await A.context().newPage();
  await B.goto(A.url());
  await pastGate(B);
  await live(B);
  const composerB = B.locator(COMPOSER);
  await expect(composerB, "the other tab shows the draft").toHaveText(
    "and a reply",
  );
  await expect(
    B.locator(".channel-view .reply-bar"),
    "with its quote",
  ).toContainText("sent, not kept");
  await composerB.click();
  await B.keyboard.press("Enter");
  await expect(rowByText(B, "and a reply")).toHaveCount(1);
  await expect(composer, "the idle tab's field empties").toHaveText("");
  await expect(replyBar, "and its quote goes").toHaveCount(0);
  await B.close();

  // Logging out deletes the drafts on this device.
  await composer.pressSequentially("left behind");
  await open("random");
  await open("general");
  await expect(composer).toHaveText("left behind");
  await A.locator(".space-pill.avatar").click();
  await A.locator(".logout-link").click();
  await acceptDialog(A);
  await expect(A).toHaveURL(/\/login$/);
  expect(
    await A.evaluate(() =>
      Object.keys(localStorage).filter((itemKey) =>
        itemKey.startsWith("stoop.draft."),
      ),
    ),
    "logging out deleted every draft",
  ).toEqual([]);
  await A.locator('input[autocomplete="username"]').fill(`ada${suffix}`);
  await A.locator('input[type="password"]').fill(password);
  await A.locator('button[type="submit"]').click();
  await expect(A).toHaveURL(/\/s\//);
  await open("general");
  await expect(composer, "and nothing comes back").toHaveText("");
});
