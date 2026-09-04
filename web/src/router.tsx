import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { ActivityPage } from "./routes/Activity";
import { AdminPage } from "./routes/Admin";
import { AppShell } from "./routes/AppShell";
import { ChannelView } from "./routes/Channel";
import { DMIndex, DMLayout } from "./routes/DirectMessages";
import { HomePage } from "./routes/Home";
import { JoinPage } from "./routes/Join";
import { LoginPage } from "./routes/Login";
import { ProfilePage } from "./routes/Profile";
import { Root } from "./routes/Root";
import { SetupPage } from "./routes/Setup";
import { SpaceIndex, SpaceLayout } from "./routes/Space";
import { SpaceSettingsPage } from "./routes/SpaceSettings";

const rootRoute = createRootRoute({ component: Root });

// ?redirect=<path> sends the user back where they were headed after login
// (e.g. an invite link). Only same-origin absolute paths are accepted, and
// never /login itself — a redirect back to the login page would leave the
// user stuck on the form after a successful login.
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  if (value === "/login" || value.startsWith("/login?")) return undefined;
  if (value.startsWith("/login/")) return undefined;
  return value;
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
  // Return the key explicitly even when rejected: a route's search is
  // merged over its parent's raw search, so omitting the key would let the
  // unvalidated value through.
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string; error?: string; password?: "1" } => ({
    redirect: safeRedirect(search.redirect),
    // A failed provider sign-in redirects back with a short error code.
    error:
      typeof search.error === "string" && search.error !== ""
        ? search.error.slice(0, 40)
        : undefined,
    // Shows the password form when the server hides it (admins' fallback).
    password: search.password === "1" ? "1" : undefined,
  }),
});

// First-run setup on a fresh instance; redirects to /login once set up.
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: SetupPage,
});

// Pathless layout: every route beneath it is auth-guarded by AppShell.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppShell,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: HomePage,
});

const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin",
  component: AdminPage,
  // ?tab=accounts (the account list) / ?tab=hosting (how people reach the
  // server) / ?tab=login (sign-in providers) / ?tab=storage (uploads).
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "accounts" | "hosting" | "login" | "storage" } => ({
    tab:
      search.tab === "accounts" ||
      search.tab === "hosting" ||
      search.tab === "login" ||
      search.tab === "storage"
        ? search.tab
        : undefined,
  }),
});

const activityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activity",
  component: ActivityPage,
});

const profileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/profile",
  component: ProfilePage,

  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tab?: "appearance" | "notifications" | "security";
    linked?: string;
    error?: string;
  } => ({
    tab:
      search.tab === "appearance" ||
      search.tab === "notifications" ||
      search.tab === "security"
        ? search.tab
        : undefined,
    linked:
      typeof search.linked === "string" && search.linked !== ""
        ? search.linked.slice(0, 40)
        : undefined,
    error:
      typeof search.error === "string" && search.error !== ""
        ? search.error.slice(0, 40)
        : undefined,
  }),
});

const joinRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/join/$code",
  component: JoinPage,
  // ?space=<name> is a display-only hint carried in shared links.
  validateSearch: (search: Record<string, unknown>): { space?: string } => ({
    space: typeof search.space === "string" ? search.space : undefined,
  }),
});

// Direct messages: a list, and conversations rendered by the same
// ChannelView as space channels (spaceId absent → "").
const dmRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dm",
  component: DMLayout,
});

const dmIndexRoute = createRoute({
  getParentRoute: () => dmRoute,
  path: "/",
  component: DMIndex,
});

const dmChannelRoute = createRoute({
  getParentRoute: () => dmRoute,
  path: "/$channelId",
  component: ChannelView,
  validateSearch: (search: Record<string, unknown>): { m?: string } => ({
    m: typeof search.m === "string" && search.m !== "" ? search.m : undefined,
  }),
});

const spaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/s/$spaceId",
  component: SpaceLayout,
});

const spaceIndexRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/",
  component: SpaceIndex,
});

// Space settings sits beside the space layout, not inside it: its nav
// column takes the channel sidebar's place (components/SettingsFrame).
// ?tab= picks the section; none is General.
const SPACE_SETTINGS_TABS = [
  "about",
  "channels",
  "members",
  "banned",
  "owner",
] as const;
const spaceSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/s/$spaceId/settings",
  component: SpaceSettingsPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: (typeof SPACE_SETTINGS_TABS)[number] } => ({
    tab: SPACE_SETTINGS_TABS.find((t) => t === search.tab),
  }),
});

const channelRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/c/$channelId",
  component: ChannelView,
  // ?m=<messageId> opens the channel around that message (activity,
  // shared links) instead of at the newest one.
  validateSearch: (search: Record<string, unknown>): { m?: string } => ({
    m: typeof search.m === "string" && search.m !== "" ? search.m : undefined,
  }),
});

// The kit page (every shared control in every theme) exists in dev
// builds only; the import is dead code in production, so Vite drops it.
const kitRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/kit",
        component: lazyRouteComponent(() => import("./routes/Kit"), "KitPage"),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  ...kitRoutes,
  appRoute.addChildren([
    homeRoute,
    adminRoute,
    activityRoute,
    profileRoute,
    joinRoute,
    dmRoute.addChildren([dmIndexRoute, dmChannelRoute]),
    spaceSettingsRoute,
    spaceRoute.addChildren([spaceIndexRoute, channelRoute]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
