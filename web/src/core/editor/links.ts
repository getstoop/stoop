import { readableAddress } from "./markdown";

// What's wrong with the form, field by field, as the message format would
// read it back: an address it links, and words that hold no address of
// their own.
export function checkLink(
  text: string,
  href: string,
): { text?: string; href?: string } {
  const errors: { text?: string; href?: string } = {};
  const address = href.trim();
  if (!/^https?:\/\/\S+$/i.test(address)) {
    errors.href = "Enter an address starting with http:// or https://";
  } else if (!readableAddress(address)) {
    errors.href = "The address can't hold a < or an unpaired bracket";
  }
  if (text.trim() !== href.trim() && /https?:\/\//i.test(text)) {
    errors.text = "Link text can't contain an address";
  }
  return errors;
}
