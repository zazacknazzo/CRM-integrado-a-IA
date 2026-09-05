import { createAgents } from '../agents/openai-agents.ts';
import { SimulatorChannel } from '../channels/simulator-channel.ts';
import { WhatsAppCloudApiChannel } from '../channels/whatsapp-cloud-api-channel.ts';
import { WhatsAppWebGatewayChannel } from '../channels/whatsapp-web-gateway-channel.ts';
import type { PipelineDependencies } from '../core/contracts.ts';
import { getRawDb, getRuntimeEnv } from '../db/index.ts';
import { D1ConversationRepository } from '../db/repository.ts';
import businessKnowledge from '../knowledge/business.md?raw';

function numberFrom(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
}

export function createRuntime() {
  const env = getRuntimeEnv();
  const repository = new D1ConversationRepository(
    getRawDb(),
    numberFrom(env.WHATSAPP_WINDOW_HOURS, 24, 1, 72),
    numberFrom(env.MAX_PROMOTIONAL_FOLLOWUPS, 2, 1, 2),
    numberFrom(env.FOLLOWUP_LIMIT_WINDOW_DAYS, 30, 1, 365),
  );
  const whatsapp =
    env.WHATSAPP_PROVIDER === 'baileys'
      ? new WhatsAppWebGatewayChannel({
          baseUrl: env.WHATSAPP_WEB_GATEWAY_URL ?? '',
          secret: env.WHATSAPP_WEB_GATEWAY_SECRET ?? '',
        })
      : new WhatsAppCloudApiChannel({
          accessToken: env.WHATSAPP_ACCESS_TOKEN ?? '',
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
          businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
          graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION ?? '',
        });
  const agents = createAgents({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
  });
  const pipeline: PipelineDependencies = {
    repository,
    channels: { SIMULATOR: new SimulatorChannel(), WHATSAPP: whatsapp },
    ...agents,
    knowledge: businessKnowledge,
    debounceMs: numberFrom(env.MESSAGE_DEBOUNCE_MS, 1400, 0, 5000),
  };
  return { env, repository, whatsapp, pipeline };
}
