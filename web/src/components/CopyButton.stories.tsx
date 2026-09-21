import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyButton } from "./CopyButton";

const meta: Meta<typeof CopyButton> = {
  title: "Components/CopyButton",
  component: CopyButton,
};
export default meta;

export const Default: StoryObj<typeof CopyButton> = {
  args: { text: "https://stoop.example/join/4fQ9xK2mBz" },
};
