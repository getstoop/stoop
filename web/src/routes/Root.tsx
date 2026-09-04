import { useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useInstanceStatus } from "../api/queries";
import { DialogHost } from "../components/DialogHost";
import type { GetInstanceStatusResponse } from "../gen/stoop/instance/v1/instance_pb";

// The outermost frame: whatever page is routed, plus the one place the
// app's dialogs render.
export function Root() {
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
  return (
    <>
      <Outlet />
      <DialogHost />
    </>
  );
}
