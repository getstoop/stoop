import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "../../../components/Avatar";
import { MessageSkeleton } from "./MessageSkeleton";

// The placeholder rows at an edge of the channel view. Loading is what a
// reader sees scrolled to the edge while the page is out; Idle is the same
// edge with no page out. Above messages shows how the rows line up with
// real ones, in the list they sit in.

const meta: Meta<typeof MessageSkeleton> = {
  title: "Channel/MessageSkeleton",
  component: MessageSkeleton,
  args: { edge: "older", loading: true },
};
export default meta;

type Story = StoryObj<typeof MessageSkeleton>;

export const Loading: Story = {};

export const Idle: Story = { args: { loading: false } };

// A real row's markup, by hand: MessageRow needs a channel behind it.
const Row = ({
  name,
  time,
  text,
  continued,
}: {
  name: string;
  time: string;
  text: string;
  continued?: boolean;
}) => (
  <div className={`message ${continued ? "continued" : ""}`.trim()}>
    {!continued && (
      <>
        <span className="message-avatar">
          <Avatar name={name} size="medium" />
        </span>
        <div className="message-meta">
          <span className="message-author">{name}</span>
          <span className="message-time">{time}</span>
        </div>
      </>
    )}
    <div className="message-content">{text}</div>
  </div>
);

export const AboveMessages: Story = {
  render: (args) => (
    <div className="message-list" style={{ maxWidth: 720 }}>
      <MessageSkeleton {...args} />
      <div className="day-divider eyebrow">
        <span>Sunday, October 25</span>
      </div>
      <Row
        name="Omar Haddad"
        time="12:07 PM"
        text="Lost and found box in the library is overflowing, claim your stuff"
      />
      <Row
        name="Omar Haddad"
        time="12:08 PM"
        text="It's the blue crate by the door"
        continued
      />
      <Row
        name="Ines Duarte"
        time="12:41 PM"
        text="Anyone seen the grey cat from number 12? Does anyone have a long extension lead I could borrow for an hour?"
      />
    </div>
  ),
};
