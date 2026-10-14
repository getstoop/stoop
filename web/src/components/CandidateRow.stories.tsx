import type { Meta, StoryObj } from "@storybook/react-vite";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import { CandidateRow } from "./CandidateRow";

const meta: Meta<typeof CandidateRow> = {
  title: "Components/CandidateRow",
  component: CandidateRow,
};
export default meta;

const person = (username: string, displayName: string) =>
  ({ id: username, username, displayName }) as MessageAuthor;

export const Picker: StoryObj = {
  render: () => (
    <div className="candidate-list">
      <CandidateRow
        person={person("ada", "Ada Okafor")}
        picked
        disabled={false}
        onToggle={() => {}}
      />
      <CandidateRow
        person={person("bea", "")}
        picked={false}
        disabled={false}
        onToggle={() => {}}
      />
      <CandidateRow
        person={person("casey", "Casey Nolan")}
        picked={false}
        disabled
        onToggle={() => {}}
      />
    </div>
  ),
};
