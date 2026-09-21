import type { Meta, StoryObj } from "@storybook/react-vite";
import { IdentityKind } from "../gen/stoop/access/v1/access_pb";
import { Avatar } from "./Avatar";

const meta: Meta<typeof Avatar> = {
  title: "Components/Avatar",
  component: Avatar,
};
export default meta;

export const Sizes: StoryObj = {
  render: () => (
    <div className="kit-row">
      <Avatar name="Ada" size="small" />
      <Avatar name="Bea Casey" size="medium" />
      <Avatar name="Casey" size="large" />
      <Avatar name="Casey" />
    </div>
  ),
};

export const Bot: StoryObj<typeof Avatar> = {
  args: { name: "Relay", kind: IdentityKind.BOT, size: "medium" },
};
