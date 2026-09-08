import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type ActivityData, alertingCount } from "../api/activity";
import { canOpenInApp } from "../api/desktopLinks";
import { setBadge } from "../api/platform";
import { useInstanceStatus } from "../api/queries";
import { DialogHost } from "../components/DialogHost";
import { InviteHandoff } from "../components/InviteHandoff";
import type { GetInstanceStatusResponse } from "../gen/stoop/instance/v1/instance_pb";

// The outermost frame: whatever page is routed, plus the one place the
// app's dialogs render.
export function Root() {
  const { pathname, searchStr } = useRouterState({ select: (s) => s.location });
  // An invite link in a browser asks first: the app, or here. This sits
  // above the route tree, so nothing has looked the code up or redeemed
  // it by the time the choice is made. The answer lasts as long as the
  // page is loaded — this component is never unmounted — and nothing is
  // stored, so a fresh load asks again.
  const [inBrowser, setInBrowser] = useState(false);
  const invite = pathname.startsWith("/join/") ? `${pathname}${searchStr}` : "";
  const handoff = invite !== "" && !inBrowser && canOpenInApp(invite);
  // Fetches the status; the title itself is read off the cache below.
  useInstanceStatus();
  const queryClient = useQueryClient();
  // index.html's static <title>Stoop</title> is the pre-paint fallback;
  // this takes over once the instance status has loaded, everywhere in
  // the app. It watches the cache rather than useInstanceStatus's data:
  // login and setup call queryClient.clear(), which detaches an observer
  // that mounted before it (this one, for the life of the tab) from the
  // entry the admin page later refetches into.
  useEffect(() => {
    const apply = () => {
      const status = queryClient.getQueryData<GetInstanceStatusResponse>([
        "instance-status",
      ]);
      document.title = status?.instanceName || "Stoop";
    };
    apply();
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "instance-status") apply();
    });
  }, [queryClient]);
  // The unread badge the desktop shell shows on the dock and tray, read
  // off the activity cache the same way, and a no-op in a browser.
  useEffect(() => {
    const apply = () =>
      setBadge(
        alertingCount(queryClient.getQueryData<ActivityData>(["activity"])),
      );
    apply();
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "activity") apply();
    });
  }, [queryClient]);
  return (
    <>
      <div className="titlebar" />
      <div className="page">
        {handoff ? (
          <InviteHandoff path={invite} onContinue={() => setInBrowser(true)} />
        ) : (
          <Outlet />
        )}
      </div>
      <DialogHost />
    </>
  );
}
