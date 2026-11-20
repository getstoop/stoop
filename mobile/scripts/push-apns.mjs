#!/usr/bin/env node
// Sends one hand-made push straight to Apple's sandbox, exactly as the
// relay would hand it over, for the notification service extension to
// decrypt on a phone. How to run it and its options:
// mobile/README.md -> Notifications -> Sending a push by hand.

import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "https://api.sandbox.push.apple.com";
const PAD_BLOCK = 256;
const RECORD_SIZE = 4096;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function localEnv() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  const found = {};
  if (!fs.existsSync(file)) return found;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) found[match[1]] = match[2];
  }
  return found;
}

const SWITCHES = new Set(["unreadable", "print"]);
const VALUES = new Set(["p256dh", "auth", "payload", "server-id", "topic"]);

function readArguments(args) {
  const flags = {};
  const rest = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (SWITCHES.has(name)) flags[name] = true;
    else if (VALUES.has(name) && index + 1 < args.length) flags[name] = args[++index];
    else fail(`Unknown or incomplete option ${arg}.`);
  }
  return { flags, rest };
}

// One aes128gcm record for the subscription's keys, as
// internal/webpush/encrypt.go makes it.
function encrypt(plain, receiverPublic, auth) {
  const sender = crypto.createECDH("prime256v1");
  const senderPublic = sender.generateKeys();
  const shared = sender.computeSecret(receiverPublic);
  const salt = crypto.randomBytes(16);
  const hkdf = (secret, saltBytes, info, length) =>
    Buffer.from(crypto.hkdfSync("sha256", secret, saltBytes, Buffer.from(info), length));
  const inputKey = hkdf(shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, senderPublic]), 32);
  const key = hkdf(inputKey, salt, "Content-Encoding: aes128gcm\0", 16);
  const nonce = hkdf(inputKey, salt, "Content-Encoding: nonce\0", 12);
  // The last-record delimiter, then zeros to the next multiple of 256.
  const record = Buffer.alloc((Math.floor(plain.length / PAD_BLOCK) + 1) * PAD_BLOCK);
  plain.copy(record);
  record[plain.length] = 2;
  const cipher = crypto.createCipheriv("aes-128-gcm", key, nonce);
  const sealed = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, sealed]);
}

// The phone's keys as given, or a pair nothing holds the private half of.
function subscription(flags) {
  if (flags.unreadable) {
    const stranger = crypto.createECDH("prime256v1");
    return { p256dh: stranger.generateKeys(), auth: crypto.randomBytes(16) };
  }
  if (!flags.p256dh || !flags.auth) fail("Pass --p256dh and --auth (the PUSH_KEYS_CHECK line), or --unreadable.");
  const p256dh = Buffer.from(flags.p256dh, "base64url");
  const auth = Buffer.from(flags.auth, "base64url");
  if (p256dh.length !== 65 || p256dh[0] !== 4) fail("--p256dh is not a 65-byte uncompressed P-256 point.");
  if (auth.length !== 16) fail("--auth is not 16 bytes.");
  return { p256dh, auth };
}

// APNs' provider token: an ES256 JWT, the signature as raw r|s.
function providerToken(keyPath, keyId, teamId) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${part({ alg: "ES256", kid: keyId })}.${part({ iss: teamId, iat: Math.floor(Date.now() / 1000) })}`;
  const signature = crypto.sign("sha256", Buffer.from(signed), {
    key: fs.readFileSync(keyPath),
    dsaEncoding: "ieee-p1363",
  });
  return `${signed}.${signature.toString("base64url")}`;
}

const { flags, rest } = readArguments(process.argv.slice(2));
if (!flags.payload) fail("Pass --payload <file>: one of internal/push/testdata/payload-*.json.");
const payload = JSON.parse(fs.readFileSync(flags.payload, "utf8"));
payload.serverId = flags["server-id"] ?? "dev-check";
const keys = subscription(flags);
const body = encrypt(Buffer.from(JSON.stringify(payload)), keys.p256dh, keys.auth);
const apnsPayload = JSON.stringify({
  aps: { alert: { title: "New activity" }, "mutable-content": 1 },
  c: body.toString("base64"),
});

if (flags.print) {
  console.log(apnsPayload);
  process.exit(0);
}

const env = { ...localEnv(), ...process.env };
const deviceToken = rest[0];
if (!deviceToken || !/^[0-9a-f]+$/i.test(deviceToken)) fail("Usage: push-apns.mjs <device token (hex)> [options]");
const keyPath = env.STOOP_APNS_KEY;
if (!keyPath) fail("Set STOOP_APNS_KEY to the path of the APNs auth key (.p8).");
const keyId = env.STOOP_APNS_KEY_ID ?? path.basename(keyPath).match(/^AuthKey_([A-Z0-9]+)\.p8$/)?.[1];
const teamId = env.STOOP_APPLE_TEAM_ID;
const topic = flags.topic ?? env.STOOP_IOS_BUNDLE_ID;
if (!keyId) fail("Set STOOP_APNS_KEY_ID: the key file's name doesn't say it.");
if (!teamId) fail("Set STOOP_APPLE_TEAM_ID.");
if (!topic) fail("Set STOOP_IOS_BUNDLE_ID or pass --topic.");

const client = http2.connect(HOST);
client.on("error", (error) => fail(`Connection failed: ${error.message}`));
const request = client.request({
  ":method": "POST",
  ":path": `/3/device/${deviceToken}`,
  authorization: `bearer ${providerToken(keyPath, keyId, teamId)}`,
  "apns-topic": topic,
  "apns-push-type": "alert",
  "apns-priority": "10",
  "content-type": "application/json",
});
let status = 0;
let apnsId = "";
let answer = "";
request.on("response", (headers) => {
  status = headers[":status"];
  apnsId = headers["apns-id"] ?? "";
});
request.on("data", (chunk) => {
  answer += chunk;
});
request.on("end", () => {
  client.close();
  const what = flags.unreadable ? "a push no key opens" : `${path.basename(flags.payload)} as server ${payload.serverId}`;
  // Nothing read from the environment is printed, the topic included.
  console.log(`Sent ${what} to ${HOST} (${apnsPayload.length} bytes).`);
  console.log(`APNs answered ${status}${apnsId ? `, apns-id ${apnsId}` : ""}${answer ? `: ${answer}` : ""}`);
  process.exit(status === 200 ? 0 : 1);
});
request.end(apnsPayload);
