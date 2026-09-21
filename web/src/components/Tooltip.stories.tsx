import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "Components/Tooltip",
  component: Tooltip,
};
export default meta;

// What a truncated row hasn't room to say.
export const WithDetail: StoryObj = {
  render: () => (
    <Tooltip
      text="Ravenswood Ave"
      detail="Neighbours between 4th and 7th. Tool library and stoop sales."
      side="right"
    >
      <button type="button" className="chip">
        Hover, or tab to me
      </button>
    </Tooltip>
  ),
};

export const OnAnIconButton: StoryObj = {
  render: () => (
    <Tooltip text="Copy join link" side="bottom">
      <button type="button" className="icon-button" aria-label="Copy join link">
        ⧉
      </button>
    </Tooltip>
  ),
};
