import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { sweepDrafts } from "./api/drafts";
import { initTheme } from "./api/theme";
import { router } from "./router";
import "./themes.css";
import "./styles/index.css";

initTheme();
// Expired drafts go at page start; otherwise one would only expire if
// its channel were opened again.
sweepDrafts();

const queryClient = new QueryClient();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing #root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
