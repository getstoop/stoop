import type { ComponentType } from "react";
import { ThreadView } from "../../routes/Channel/ThreadView";

// What the side panel can show. A kind of content is one entry: its
// component, which draws itself inside SidePanelFrame, and optionally the
// search parameter a link uses to open it on arrival.
export interface PanelDefinition {
  component: ComponentType<{ params: Record<string, string> }>;
  link?: {
    // The parameter that names this kind ("t" for a thread).
    param: string;
    // Other parameters the link reads, removed with it ("m", the reply).
    also?: string[];
    // The panel's params from the arriving link's search, or null when the
    // link doesn't make sense.
    params: (search: URLSearchParams) => Record<string, string> | null;
  };
}

export type PanelRegistry = Record<string, PanelDefinition>;

// Content lives with its feature; the registry only names it.
export const panels: PanelRegistry = {
  thread: { component: ThreadView },
};
