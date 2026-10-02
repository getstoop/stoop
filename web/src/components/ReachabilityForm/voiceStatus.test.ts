import { create } from "@bufbuild/protobuf";
import { expect, test } from "vitest";
import { GetReachabilityResponseSchema } from "../../gen/stoop/instance/v1/instance_pb";
import { voiceStatus } from "./voiceStatus";

test("voice turned off outranks every other reading", () => {
  const reading = create(GetReachabilityResponseSchema, { voiceOff: true });
  expect(voiceStatus(reading)).toBe(
    "Voice is turned off on this server (STOOP_VOICE=false).",
  );
});

test("no LiveKit reads as unconfigured, not turned off", () => {
  const reading = create(GetReachabilityResponseSchema, {});
  expect(voiceStatus(reading)).toContain("isn't configured");
});
