// process.env as Metro inlines it. Expo writes the same reference into a
// gitignored expo-env.d.ts on `expo start`; this one is here for a type
// check run before that.
/// <reference types="expo/types" />

// React Native's field focus registry, which it doesn't type
// (screens/Channel/fieldFocus.ts).
declare module "react-native/Libraries/Components/TextInput/TextInputState" {
  const TextInputState: {
    currentlyFocusedInput(): unknown;
    focusInput(field: unknown): void;
    blurInput(field: unknown): void;
    blurTextInput(field: unknown): void;
    registerInput(field: unknown): void;
    unregisterInput(field: unknown): void;
  };
  export default TextInputState;
}
