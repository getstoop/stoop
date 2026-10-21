import { IdentityKind } from "../gen/stoop/access/v1/access_pb";

// What an account is, from the kind every wire shape that names one
// carries. UNSPECIFIED reads as a person, so a server that predates the
// field still renders people as people.
export const isBot = (kind: IdentityKind | undefined): boolean =>
  kind === IdentityKind.BOT;
