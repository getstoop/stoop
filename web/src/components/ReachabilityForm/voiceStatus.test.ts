import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";
import { GetReachabilityResponseSchema } from "../../gen/stoop/instance/v1/instance_pb";
import { voiceStatus } from "./voiceStatus";

test("voice turned off outranks every other reading", () => {
  const r = create(GetReachabilityResponseSchema, { voiceOff: true });
  expect(voiceStatus(r)).toBe(
    "Voice is turned off on this server (STOOP_VOICE=false).",
  );
});

test("no LiveKit reads as unconfigured, not turned off", () => {
  const r = create(GetReachabilityResponseSchema, {});
  expect(voiceStatus(r)).toContain("isn't configured");
});
