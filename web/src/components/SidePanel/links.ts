import type { OpenPanel } from "../../stores/sidePanel";
import type { PanelRegistry } from "./registry";

// The panel a link asks for on arrival, and the address without the
// parameters that asked for it: the URL opens the panel once and then
// stops describing it, since the panel's state belongs to the app.
export function panelFromLink(
  search: string,
  pathname: string,
  registry: PanelRegistry,
): { panel: OpenPanel; search: string } | null {
  const query = new URLSearchParams(search);
  for (const [kind, definition] of Object.entries(registry)) {
    const link = definition.link;
    if (!link || !query.has(link.param)) continue;
    const params = link.params(query, pathname);
    for (const key of [link.param, ...(link.also ?? [])]) query.delete(key);
    const rest = query.toString();
    if (!params) return null;
    return { panel: { kind, params }, search: rest ? `?${rest}` : "" };
  }
  return null;
}
