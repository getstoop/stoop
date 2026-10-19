import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "../gen/stoop/auth/v1/auth_pb";
import { ChatService } from "../gen/stoop/chat/v1/chat_pb";
import { FileService } from "../gen/stoop/files/v1/files_pb";
import { InstanceService } from "../gen/stoop/instance/v1/instance_pb";
import { IntegrationService } from "../gen/stoop/integrations/v1/integrations_pb";
import { VoiceService } from "../gen/stoop/voice/v1/voice_pb";
import { askToConfirm, needsConfirming } from "./askToConfirm";
import { serverOrigin } from "./origin";

// A change refused for want of a recent sign-in (a Server admin action,
// say) offers "Confirm it's you" from wherever it was made. The error still
// reaches the caller, which shows it as it would any other.
function offerConfirm(): Interceptor {
  return (next) => async (req) => {
    try {
      return await next(req);
    } catch (err) {
      if (needsConfirming(err)) void askToConfirm();
      throw err;
    }
  };
}

// The session rides an HttpOnly cookie, so requests need credentials
// included.
const transport = createConnectTransport({
  baseUrl: serverOrigin(),
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
  interceptors: [offerConfirm()],
});

export const authClient = createClient(AuthService, transport);
export const chatClient = createClient(ChatService, transport);
export const filesClient = createClient(FileService, transport);
export const instanceClient = createClient(InstanceService, transport);
export const integrationsClient = createClient(IntegrationService, transport);
export const voiceClient = createClient(VoiceService, transport);
