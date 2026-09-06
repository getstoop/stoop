import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "../gen/stoop/auth/v1/auth_pb";
import { ChatService } from "../gen/stoop/chat/v1/chat_pb";
import { FileService } from "../gen/stoop/files/v1/files_pb";
import { InstanceService } from "../gen/stoop/instance/v1/instance_pb";
import { VoiceService } from "../gen/stoop/voice/v1/voice_pb";
import { serverOrigin } from "./origin";

// The session rides an HttpOnly cookie, so requests need credentials
// included.
const transport = createConnectTransport({
  baseUrl: serverOrigin(),
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});

export const authClient = createClient(AuthService, transport);
export const chatClient = createClient(ChatService, transport);
export const filesClient = createClient(FileService, transport);
export const instanceClient = createClient(InstanceService, transport);
export const voiceClient = createClient(VoiceService, transport);
