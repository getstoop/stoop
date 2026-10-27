// React Native puts the keyboard away (a tap on the timeline, a drag,
// Keyboard.dismiss) by blurring the field its focus registry holds as
// focused, with a command only its own text inputs answer. The composer's
// native field (RichField) joins that registry while it is focused, and
// answers the blur through here, so it is put away as a TextInput is.
// TextInputState has no public types (React Native only exports part of
// it, as TextInput.State); its deep path resolves at run time.
import TextInputState from "react-native/Libraries/Components/TextInput/TextInputState";

const blurs = new Map<object, () => void>();
let patched = false;

function patch() {
  if (patched) return;
  patched = true;
  const blurTextInput = TextInputState.blurTextInput;
  TextInputState.blurTextInput = (field: unknown) => {
    const blur = field ? blurs.get(field as object) : undefined;
    if (!blur) {
      blurTextInput(field);
      return;
    }
    if (TextInputState.currentlyFocusedInput() === field) {
      TextInputState.blurInput(field);
      blur();
    }
  };
}

// A field, known by `key`, that `blur` puts away. Returns its unregister.
export function registerField(key: object, blur: () => void): () => void {
  patch();
  blurs.set(key, blur);
  TextInputState.registerInput(key);
  return () => {
    TextInputState.blurInput(key);
    TextInputState.unregisterInput(key);
    blurs.delete(key);
  };
}

export const fieldFocused = (key: object) => TextInputState.focusInput(key);
export const fieldBlurred = (key: object) => TextInputState.blurInput(key);
