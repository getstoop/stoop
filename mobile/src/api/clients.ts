import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { InstanceService } from "@stoop/gen/stoop/instance/v1/instance_pb";

// Unlike web's transport (web/src/api/clients.ts) there is no cookie
// wrapper: nothing here signs in yet. Binary format, so a call goes
// through the protobuf runtime the way every later call will.
//
// The app talks to more than one server, so a client is made for the
// origin it is given rather than once for the app.
export function instanceClient(origin: string): Client<typeof InstanceService> {
  return createClient(
    InstanceService,
    createConnectTransport({ baseUrl: origin, useBinaryFormat: true }),
  );
}
