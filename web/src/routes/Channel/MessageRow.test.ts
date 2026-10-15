import { expect, test, vi } from "vitest";

// The API client reads the page's origin when the module loads.
vi.hoisted(() => {
  vi.stubGlobal("location", { origin: "http://localhost" });
});

import { MessageRow } from "./MessageRow";

// The list re-renders on its own state (a picker, a card, the scroll
// position); a memoised row skips those renders when its props are the same.
test("MessageRow is memoised", () => {
  expect((MessageRow as unknown as { $$typeof: symbol }).$$typeof).toBe(
    Symbol.for("react.memo"),
  );
});
