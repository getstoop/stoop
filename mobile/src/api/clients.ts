import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { InstanceService } from "@stoop/gen/stoop/instance/v1/instance_pb";
import { serverUrl } from "./server";

// Unlike web's transport (web/src/api/clients.ts) there is no cookie
// wrapper: nothing here signs in yet. Binary format, so a call goes
// through the protobuf runtime the way every later call will.
//
// Built on first use rather than at import, so a missing server address
// shows on screen instead of failing before the first render.
let instance: Client<typeof InstanceService> | undefined;

export function instanceClient(): Client<typeof InstanceService> {
  if (!instance) {
    const transport = createConnectTransport({
      baseUrl: serverUrl(),
      useBinaryFormat: true,
    });
    instance = createClient(InstanceService, transport);
  }
  return instance;
}
