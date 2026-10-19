import { type Client, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { InstanceService } from "@stoop/gen/stoop/instance/v1/instance_pb";

// Unlike web's transport (web/src/api/clients.ts) there is no cookie: a
// signed-in call carries its session as a bearer token, which the server
// takes everywhere a cookie works (identity.md → Sessions). Binary
// format, so a call goes through the protobuf runtime the way every
// later call will.
//
// The app talks to more than one server, so a client is made for the
// origin it is given, and the session it signs in with, rather than once
// for the app.
function transport(origin: string, token?: string) {
  const bearer: Interceptor = (next) => (req) => {
    req.header.set("Authorization", `Bearer ${token}`);
    return next(req);
  };
  return createConnectTransport({
    baseUrl: origin,
    useBinaryFormat: true,
    interceptors: token ? [bearer] : [],
  });
}

export function instanceClient(origin: string): Client<typeof InstanceService> {
  return createClient(InstanceService, transport(origin));
}

export function authClient(origin: string, token?: string): Client<typeof AuthService> {
  return createClient(AuthService, transport(origin, token));
}
