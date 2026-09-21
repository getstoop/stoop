import { Code, ConnectError } from "@connectrpc/connect";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { confirm, notice, prompt } from "../stores/dialogs";
import { DialogHost } from "./DialogHost";

const meta: Meta = {
  title: "Components/DialogHost",
  decorators: [
    (Story) => (
      <>
        <Story />
        <DialogHost />
      </>
    ),
  ],
};
export default meta;

const opener = (label: string, open: () => unknown): StoryObj => ({
  render: () => (
    <button type="button" className="chip" onClick={open}>
      {label}
    </button>
  ),
});

export const Confirm = opener("Confirm", () =>
  confirm({
    title: "Delete #general?",
    body: "All its messages go with it.",
    action: "Delete",
    danger: true,
  }),
);

export const Prompt = opener("Prompt", () =>
  prompt({ title: "New channel", label: "Channel name", action: "Create" }),
);

export const PromptMatch = opener("Prompt (match)", () =>
  prompt({
    title: "Delete this space",
    body: "Type the space name to confirm.",
    label: "Space name",
    match: "The Porch",
    action: "Delete space",
    danger: true,
  }),
);

// A refusal stays in the dialog, under the field, with the answer kept.
export const PromptRefused = opener("Prompt (refused)", () =>
  prompt({
    title: "New channel",
    label: "Channel name",
    initial: "General Chat",
    action: "Create",
    submit: async () => {
      throw new ConnectError(
        "a channel name takes lowercase letters a-z, numbers, - and _",
        Code.InvalidArgument,
      );
    },
  }),
);

export const Notice = opener("Notice", () =>
  notice({ title: "Couldn't join", body: "invite not found" }),
);
