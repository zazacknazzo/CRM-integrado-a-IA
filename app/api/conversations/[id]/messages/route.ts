import { createRuntime } from '../../../../../lib/runtime.ts';
import { requireCrmAuth } from '../../../../../lib/auth.ts';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    const { repository } = createRuntime();
    return Response.json({ messages: await repository.listConversationMessages(id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not list messages' }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { text?: string } | null;
  if (!body?.text?.trim()) return Response.json({ error: 'text is required' }, { status: 400 });
  try {
    const { id } = await context.params;
    const { pipeline, repository } = createRuntime();
    let conversation = await repository.getConversation(id);
    if (conversation.controlState === 'AI_ACTIVE') {
      return Response.json({ error: 'Message blocked because conversation is AI_ACTIVE; take over first' }, { status: 409 });
    }
    if (conversation.controlState === 'PROFESSIONAL_HANDOFF') {
      await repository.setControlState(id, 'HUMAN_CONTROL', 'Professional answered from Inbox');
      conversation = await repository.getConversation(id);
    }
    if (pipeline.channels[conversation.channel].enforcesCustomerServiceWindow) {
      const expiresAt = conversation.customerServiceWindowExpiresAt ? Date.parse(conversation.customerServiceWindowExpiresAt) : 0;
      if (expiresAt <= Date.now()) return Response.json({ error: 'Customer service window expired' }, { status: 409 });
    }
    const messageId = await repository.createOutbound(id, { senderType: 'HUMAN', body: body.text.trim(), channel: conversation.channel });
    try {
      const result = await pipeline.channels[conversation.channel].sendMessage({ to: conversation.phoneE164, type: 'text', text: body.text.trim(), idempotencyKey: messageId });
      await repository.markOutboundAccepted(messageId, result);
      await repository.noteIntegration({ lastSuccessfulSendAt: result.acceptedAt });
      await repository.audit(id, 'human_message_sent', 'HUMAN', { channel: conversation.channel });
      return Response.json({ messageId, status: result.status });
    } catch (error) {
      await repository.markOutboundFailed(messageId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not send message' }, { status: 500 });
  }
}
