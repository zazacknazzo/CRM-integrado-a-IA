import type {
  MessageChannel,
  SendMessageInput,
  SendMessageResult,
} from '../core/contracts.ts';

export interface WhatsAppCloudApiConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  graphApiVersion: string;
}

function requireConfig(config: WhatsAppCloudApiConfig): void {
  if (!config.accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN missing');
  if (!config.phoneNumberId)
    throw new Error('WHATSAPP_PHONE_NUMBER_ID missing');
  if (!config.businessAccountId)
    throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID missing');
  if (!/^v\d+\.\d+$/.test(config.graphApiVersion))
    throw new Error('WHATSAPP_GRAPH_API_VERSION missing or invalid');
}

function graphError(status: number, payload: unknown): Error {
  const object =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const nested =
    object.error && typeof object.error === 'object'
      ? (object.error as Record<string, unknown>)
      : {};
  const detail =
    typeof nested.message === 'string' ? nested.message : `HTTP ${status}`;
  if (status === 401) return new Error(`Meta API returned 401: ${detail}`);
  if (/phone number/i.test(detail))
    return new Error(`Phone Number ID invalid: ${detail}`);
  return new Error(`Meta API returned ${status}: ${detail}`);
}

export class WhatsAppCloudApiChannel implements MessageChannel {
  readonly name = 'WHATSAPP' as const;
  readonly enforcesCustomerServiceWindow = true;

  constructor(
    private readonly config: WhatsAppCloudApiConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    requireConfig(this.config);
    const body =
      input.type === 'template'
        ? {
            messaging_product: 'whatsapp',
            to: input.to.replace(/^\+/, ''),
            type: 'template',
            template: {
              name: input.templateName,
              language: { code: input.templateLanguage ?? 'pt_BR' },
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: input.to.replace(/^\+/, ''),
            type: 'text',
            text: { preview_url: false, body: input.text },
          };

    const response = await this.request(
      `https://graph.facebook.com/${this.config.graphApiVersion}/${this.config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
    };
    if (!response.ok) throw graphError(response.status, payload);
    const externalId = payload.messages?.[0]?.id;
    if (!externalId)
      throw new Error('Meta API accepted the request without a message id');
    return { externalId, status: 'sent', acceptedAt: new Date().toISOString() };
  }

  async testConfiguration() {
    requireConfig(this.config);
    const response = await this.request(
      `https://graph.facebook.com/${this.config.graphApiVersion}/${this.config.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${this.config.accessToken}` } },
    );
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) throw graphError(response.status, payload);
    return {
      id: payload.id,
      displayPhoneNumber: payload.display_phone_number,
      verifiedName: payload.verified_name,
      qualityRating: payload.quality_rating,
    };
  }
}
