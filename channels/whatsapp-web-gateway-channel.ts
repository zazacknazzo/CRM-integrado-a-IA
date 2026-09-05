import type {
  MessageChannel,
  SendMessageInput,
  SendMessageResult,
} from '../core/contracts.ts';

export interface WhatsAppWebGatewayConfig {
  baseUrl: string;
  secret: string;
}

function requireConfig(config: WhatsAppWebGatewayConfig) {
  if (!config.baseUrl) throw new Error('WHATSAPP_WEB_GATEWAY_URL missing');
  if (!config.secret) throw new Error('WHATSAPP_WEB_GATEWAY_SECRET missing');
}

async function gatewayError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  return new Error(
    payload.error || `WhatsApp Web gateway returned ${response.status}`,
  );
}

export class WhatsAppWebGatewayChannel implements MessageChannel {
  readonly name = 'WHATSAPP' as const;
  readonly enforcesCustomerServiceWindow = false;
  private readonly config: WhatsAppWebGatewayConfig;
  private readonly request: typeof fetch;

  constructor(config: WhatsAppWebGatewayConfig, request: typeof fetch = fetch) {
    this.config = config;
    this.request = request;
  }

  private endpoint(path: string) {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    requireConfig(this.config);
    if (input.type !== 'text' || !input.text?.trim()) {
      throw new Error(
        'WhatsApp Web gateway currently supports text messages only',
      );
    }
    const response = await this.request(this.endpoint('/send'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: input.to,
        text: input.text.trim(),
        idempotencyKey: input.idempotencyKey,
      }),
    });
    if (!response.ok) throw await gatewayError(response);
    const payload = (await response.json()) as {
      externalId?: string;
      acceptedAt?: string;
    };
    if (!payload.externalId)
      throw new Error(
        'WhatsApp Web gateway accepted the request without a message id',
      );
    return {
      externalId: payload.externalId,
      status: 'sent',
      acceptedAt: payload.acceptedAt ?? new Date().toISOString(),
    };
  }

  async testConfiguration() {
    requireConfig(this.config);
    const response = await this.request(this.endpoint('/health'), {
      headers: { Authorization: `Bearer ${this.config.secret}` },
    });
    if (!response.ok) throw await gatewayError(response);
    const payload = (await response.json()) as {
      connected?: boolean;
      account?: string | null;
      lastMessageEventAt?: string | null;
      lastInboundQueuedAt?: string | null;
      lastDropReason?: string | null;
      lastUpsertType?: string | null;
      ignoredFromMe?: number;
      websocketOpen?: boolean;
      connectionOpenedAt?: string | null;
      lastConnectionClosedAt?: string | null;
      lastOutboundSentAt?: string | null;
      lastRecoveryAt?: string | null;
      lastRecoveryReason?: string | null;
    };
    if (!payload.connected)
      throw new Error('WhatsApp Web gateway is waiting for the QR code');
    return {
      verifiedName: 'WhatsApp Web local',
      displayPhoneNumber: payload.account ?? undefined,
      lastMessageEventAt: payload.lastMessageEventAt ?? null,
      lastInboundQueuedAt: payload.lastInboundQueuedAt ?? null,
      lastDropReason: payload.lastDropReason ?? null,
      lastUpsertType: payload.lastUpsertType ?? null,
      ignoredFromMe: payload.ignoredFromMe ?? 0,
      websocketOpen: payload.websocketOpen ?? false,
      connectionOpenedAt: payload.connectionOpenedAt ?? null,
      lastConnectionClosedAt: payload.lastConnectionClosedAt ?? null,
      lastOutboundSentAt: payload.lastOutboundSentAt ?? null,
      lastRecoveryAt: payload.lastRecoveryAt ?? null,
      lastRecoveryReason: payload.lastRecoveryReason ?? null,
    };
  }
}
