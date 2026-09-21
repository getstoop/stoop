import type { Meta, StoryObj } from "@storybook/react-vite";
import { DotsMenu } from "./DotsMenu";

const meta: Meta<typeof DotsMenu> = {
  title: "Components/DotsMenu",
  component: DotsMenu,
};
export default meta;

// The row's actions, out of the way.
export const Default: StoryObj<typeof DotsMenu> = {
  args: {
    label: "Options for casey",
    items: [
      { label: "Make admin", onSelect: () => {} },
      { label: "Change username", onSelect: () => {} },
      { label: "Reset password", onSelect: () => {} },
      { label: "Deactivate", onSelect: () => {}, danger: true },
    ],
  },
};
