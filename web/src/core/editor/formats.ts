// The formats a composer's toolbar applies, web's and the phone's alike
// (web: components/FormatToolbar, api/formatting; phone:
// screens/Channel/FormatRow).
export type Format =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "spoiler"
  | "link"
  | "quote"
  | "list"
  | "orderedList"
  | "codeblock";
