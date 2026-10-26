import { richText } from "../../../modules/stoop-rich-text";
import type { ParagraphProps } from "./context";
import NativeParagraph from "./NativeParagraph";
import TextParagraph from "./TextParagraph";

// One paragraph of a message: drawn by our native view where the module
// is there (iOS and Android), for web's rounded, padded pills; with
// React Native's Text anywhere else, its pills flat.
export default function Paragraph(props: ParagraphProps) {
  return richText ? <NativeParagraph native={richText} {...props} /> : <TextParagraph {...props} />;
}
