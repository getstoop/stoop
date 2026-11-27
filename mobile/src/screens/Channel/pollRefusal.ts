import { errorText } from "../../api/errors";

// What a refusal of either poll form (PollForm, TimePollForm) says, as
// web's forms word it: "Couldn't post the poll." and the server's words
// as a sentence, or "Try again." when it gave none.
export function pollRefusal(err: unknown): string {
  const said = errorText(err).trim();
  if (!said) return "Couldn't post the poll. Try again.";
  const sentence = said[0].toUpperCase() + said.slice(1);
  return `Couldn't post the poll. ${sentence}${/[.!?]$/.test(sentence) ? "" : "."}`;
}
