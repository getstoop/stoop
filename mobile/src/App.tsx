import Welcome from "./screens/Welcome";
import { ThemeProvider } from "./theme";

// No server is added yet, so the app is the welcome screen. Adding one,
// signing in and the tabs come next (the mockups' order).
export default function App() {
  return (
    <ThemeProvider>
      <Welcome />
    </ThemeProvider>
  );
}
