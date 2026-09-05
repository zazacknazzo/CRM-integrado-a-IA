import { createRuntime } from '../../../../lib/runtime.ts';
import { requireCrmAuth } from '../../../../lib/auth.ts';

function maskedId(value?: string) {
  if (!value) return null;
  return value.length <= 6 ? value : `••••••${value.slice(-6)}`;
}

export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  try {
    const { env, repository, whatsapp } = createRuntime();
    const status = await repository.getIntegrationStatus();
    const provider = env.WHATSAPP_PROVIDER === 'baileys' ? 'baileys' : 'meta';
    const credentialsConfigured = provider === 'baileys'
      ? Boolean(env.WHATSAPP_WEB_GATEWAY_URL && env.WHATSAPP_WEB_GATEWAY_SECRET)
      : Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_BUSINESS_ACCOUNT_ID && env.WHATSAPP_GRAPH_API_VERSION);
    let gatewayConnected = false;
    let gatewayDiagnostics: Record<string, unknown> | null = null;
    if (provider === 'baileys' && credentialsConfigured) {
      try { gatewayDiagnostics = await whatsapp.testConfiguration(); gatewayConnected = true; } catch {}
    }
    return Response.json({
      provider,
      connected: provider === 'baileys' ? gatewayConnected : credentialsConfigured && !status?.last_error,
      credentialsConfigured,
      phoneNumberId: provider === 'meta' ? maskedId(env.WHATSAPP_PHONE_NUMBER_ID) : null,
      businessAccountId: provider === 'meta' ? maskedId(env.WHATSAPP_BUSINESS_ACCOUNT_ID) : null,
      webhookConfigured: provider === 'baileys'
        ? credentialsConfigured
        : Boolean(env.WHATSAPP_VERIFY_TOKEN && env.META_APP_SECRET && env.APP_URL),
      webhookUrl: provider === 'baileys'
        ? 'interno e assinado'
        : env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/api/webhooks/whatsapp` : null,
      connectionPageUrl: provider === 'baileys' ? 'http://127.0.0.1:8789' : null,
      gatewayAccount: gatewayDiagnostics?.displayPhoneNumber ?? null,
      gatewayLastMessageEventAt: gatewayDiagnostics?.lastMessageEventAt ?? null,
      gatewayLastInboundQueuedAt: gatewayDiagnostics?.lastInboundQueuedAt ?? null,
      gatewayLastDropReason: gatewayDiagnostics?.lastDropReason ?? null,
      gatewayLastUpsertType: gatewayDiagnostics?.lastUpsertType ?? null,
      gatewayIgnoredFromMe: gatewayDiagnostics?.ignoredFromMe ?? 0,
      gatewayWebsocketOpen: gatewayDiagnostics?.websocketOpen ?? false,
      gatewayConnectionOpenedAt: gatewayDiagnostics?.connectionOpenedAt ?? null,
      gatewayLastRecoveryAt: gatewayDiagnostics?.lastRecoveryAt ?? null,
      gatewayLastRecoveryReason: gatewayDiagnostics?.lastRecoveryReason ?? null,
      lastWebhookAt: status?.last_webhook_at ?? null,
      lastError: status?.last_error ?? null,
      lastSuccessfulSendAt: status?.last_successful_send_at ?? null,
      accessToken: provider === 'baileys' || env.WHATSAPP_ACCESS_TOKEN ? 'configured' : 'missing',
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not read WhatsApp settings' }, { status: 500 });
  }
}
