import { commercialEvent } from './commercial.ts';
export async function scheduleManualFollowUp(
  db: D1Database,
  input: {
    conversationId: string;
    scheduledFor: string;
    message: string;
    templateName?: string;
  },
  max = 2,
  windowDays = 30,
) {
  const scheduledAt = Date.parse(input.scheduledFor),
    timestamp = new Date().toISOString();
  if (
    !Number.isFinite(scheduledAt) ||
    scheduledAt < Date.now() + 2 * 3600000 ||
    !input.message.trim() ||
    input.message.length > 2000
  )
    return {
      error:
        'Escolha um retorno daqui a pelo menos 2 horas e uma mensagem de até 2000 caracteres.',
      code: 400,
    };
  const c = await db
    .prepare(
      `SELECT c.channel,c.customer_service_window_expires_at FROM conversations c WHERE c.id=?`,
    )
    .bind(input.conversationId)
    .first<{
      channel: string;
      customer_service_window_expires_at: string | null;
    }>();
  if (!c) return { error: 'Conversa não encontrada.', code: 404 };
  const windowOpen =
    c.channel !== 'WHATSAPP' ||
    Date.parse(c.customer_service_window_expires_at ?? '') > scheduledAt;
  const approved = input.templateName
    ? await db
        .prepare(
          'SELECT name FROM whatsapp_templates WHERE name=? AND approved=1',
        )
        .bind(input.templateName)
        .first()
    : null;
  const status = windowOpen || approved ? 'SCHEDULED' : 'WAITING_FOR_TEMPLATE';
  const eligibility = windowOpen
    ? 'FREE_FORM_ALLOWED'
    : approved
      ? 'APPROVED_TEMPLATE'
      : 'TEMPLATE_REQUIRED';
  const id = crypto.randomUUID();
  const limit = Number.isFinite(max) ? Math.max(1, Math.min(2, max)) : 2;
  const days = Number.isFinite(windowDays)
    ? Math.max(1, Math.min(365, windowDays))
    : 30;
  const inserted = await db
    .prepare(`INSERT INTO follow_ups
    (id,conversation_id,channel,scheduled_for,status,delivery_eligibility,template_required,template_name,message_body,trigger_message_id,reason,created_at,updated_at)
    SELECT ?,c.id,c.channel,?,?,?,?,?,?,
      (SELECT id FROM messages m WHERE m.conversation_id=c.id AND m.direction='INBOUND' ORDER BY created_at DESC LIMIT 1),'MANUAL',?,?
    FROM conversations c JOIN clients cl ON cl.id=c.client_id WHERE c.id=? AND c.control_state='AI_ACTIVE' AND cl.promotional_opt_out=0
    AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.conversation_id=c.id AND o.stage IN ('BOOKED','ATTENDED','LOST'))
    AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id=c.id AND a.status IN ('CONFIRMED','PENDING_CONFIRMATION'))
    AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.conversation_id=c.id AND f.status IN ('SCHEDULED','WAITING_FOR_TEMPLATE','PROCESSING'))
    AND (SELECT COUNT(*) FROM follow_ups f JOIN conversations fc ON fc.id=f.conversation_id WHERE fc.client_id=c.client_id
      AND f.created_at>=? AND f.status NOT IN ('CANCELLED','FAILED')) < ?
    AND NOT EXISTS (SELECT 1 FROM follow_ups f JOIN conversations fc ON fc.id=f.conversation_id
      WHERE fc.client_id=c.client_id AND f.status='SENT' AND f.sent_at>?)`)
    .bind(
      id,
      new Date(scheduledAt).toISOString(),
      status,
      eligibility,
      windowOpen ? 0 : 1,
      input.templateName ?? null,
      input.message.trim(),
      timestamp,
      timestamp,
      input.conversationId,
      new Date(Date.now() - days * 86400000).toISOString(),
      limit,
      new Date(scheduledAt - 2 * 3600000).toISOString(),
    )
    .run();
  if (!inserted.meta.changes)
    return {
      error:
        'Retorno bloqueado: já existe um pendente, limite atingido, cliente respondeu à equipe, agendou ou pediu para parar.',
      code: 409,
    };
  await commercialEvent(
    db,
    input.conversationId,
    'followup_scheduled',
    id,
    { scheduledFor: input.scheduledFor, reason: 'MANUAL' },
    'HUMAN',
  );
  return {
    id,
    status,
    deliveryEligibility: eligibility,
    templateRequired: !windowOpen,
    code: 201,
  };
}
