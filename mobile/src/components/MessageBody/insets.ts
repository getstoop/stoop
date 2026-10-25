// How much narrower than the window a message's words are, in each place
// that draws a message. Where our native view draws them (NativeBody, on
// iOS and Android) the words are measured before they are laid
// out (NativeBody), at the window's width less this, so a row renders at
// its height the first time; a wrong inset still lays out right, a frame
// later and with a jump, once onLayout reports the real width.
//
// A new place that draws MessageBody (search, pins, a wider sheet) adds
// its entry here and passes its name as `place`.
export const BODY_INSETS = {
  // MessageRow in a channel or a thread: the row's 8 margin and 8 padding
  // on each side, then the 36 avatar and its 10 gap (or a continued row's
  // indent of the same width).
  row: 2 * (8 + 8) + 36 + 10,
  // MessageRow as the message menu's card: the menu's 16 padding and the
  // card's 12 on each side, then the avatar and its gap.
  menuCard: 2 * (16 + 12) + 36 + 10,
} as const;

export type BodyPlace = keyof typeof BODY_INSETS;
