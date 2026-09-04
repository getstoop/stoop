import { MessageBody } from "./MessageBody";

// A greeting is prose, not a mention: @names in it render as plain
// text rather than lighting up like a mention.
const NO_MENTIONS = new Set<string>();

// A space's welcome text, rendered through the message renderer so it
// takes exactly the Markdown a message takes and nothing more.
export function WelcomeText({ text }: { text: string }) {
  return (
    <div className="welcome-text">
      <MessageBody
        content={text}
        usernames={NO_MENTIONS}
        mentionsEveryone={false}
        mentionsHere={false}
      />
    </div>
  );
}
