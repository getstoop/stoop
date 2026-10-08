import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { openSidePanel, useSidePanelStore } from "../../stores/sidePanel";
import { SidePanel } from ".";
import type { PanelRegistry } from "./registry";
import { SidePanelFrame } from "./SidePanelFrame";
import { SidePanelUnavailable } from "./SidePanelUnavailable";

// Placeholder content until the thread view lands (STOOP-429): enough to
// judge the frame, the header, scrolling and the footer.
function Example({ params }: { params: Record<string, string> }) {
  const lines = Number(params.lines ?? "4");
  return (
    <SidePanelFrame
      title={params.title ?? "Example"}
      subtitle={params.from ?? "#garden"}
      footer={
        <div className="kit-panel-footer">
          <input
            type="text"
            placeholder="A footer stays put while the body scrolls"
            aria-label="Footer field"
          />
        </div>
      }
    >
      <div className="kit-panel-body">
        {Array.from({ length: lines }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows with nothing else to key on
          <p key={index}>
            Row {index + 1}. The panel shows one kind of content at a time,
            beside whatever page is open.
          </p>
        ))}
      </div>
    </SidePanelFrame>
  );
}

function Gone() {
  return (
    <SidePanelFrame title="Thread" subtitle="#garden">
      <SidePanelUnavailable message="This thread was deleted." />
    </SidePanelFrame>
  );
}

const registry: PanelRegistry = {
  example: { component: Example },
  gone: { component: Gone },
};

// The page beside the panel, with the controls a feature would use.
function Page() {
  const open = useSidePanelStore((s) => s.open);
  return (
    <div className="kit-page-with-panel">
      <main className="kit-page">
        <p className="muted">
          {open ? `Showing: ${open.kind}.` : "Nothing open."} Escape closes it
          while focus is inside, and focus comes back to the button that opened
          it. Narrow the window below 768px to see the phone form.
        </p>
        <div className="kit-row">
          <button
            type="button"
            className="chip"
            onClick={() => openSidePanel("example", {})}
          >
            Open
          </button>
          <button
            type="button"
            className="chip"
            onClick={() =>
              openSidePanel("example", {
                title: "Another one",
                from: "#stoop-sale",
                lines: "30",
              })
            }
          >
            Replace with a long one
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => openSidePanel("gone", {})}
          >
            Content that's gone
          </button>
        </div>
      </main>
      <SidePanel registry={registry} />
    </div>
  );
}

// SidePanel reads the address and history, so the story runs under a
// router of its own.
const withRouter: Decorator = (Story) => {
  const router = createRouter({
    routeTree: createRootRoute({ component: Story }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return <RouterProvider router={router} />;
};

const meta: Meta<typeof Page> = {
  title: "Components/SidePanel",
  component: Page,
  decorators: [withRouter],
};
export default meta;

// Open, replace and close it beside a page.
export const BesideAPage: StoryObj<typeof Page> = {};
