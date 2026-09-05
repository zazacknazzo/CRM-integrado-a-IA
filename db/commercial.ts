import type { AgentResult } from '../core/contracts.ts';
import {
  commercialEvents,
  commercialStage,
  followUpPlan,
  normalizeStage,
} from '../core/commercial.ts';
import { findCatalogService } from '../knowledge/catalog.ts';

const now = () => new Date().toISOString();
export async function commercialEvent(
  db: D1Database,
  conversationId: string,
  event: string,
  key: string,
  metadata: Record<string, unknown> = {},
  actor = 'SYSTEM',
) {
  await db
    .prepare(`INSERT OR IGNORE INTO audit_events (id, conversation_id, event_type, actor_type, metadata_json, dedup_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      conversationId,
      event,
      actor,
      JSON.stringify(metadata),
      event + ':' + key,
      now(),
    )
    .run();
}
export async function cancelFollowUps(
  db: D1Database,
  conversationId: string,
  reason: string,
) {
  await db
    .prepare(`UPDATE follow_ups SET status = 'CANCELLED', last_error = ?, locked_at = NULL, updated_at = ?
    WHERE conversation_id = ? AND status IN ('SCHEDULED','WAITING_FOR_TEMPLATE','PROCESSING')`)
    .bind(reason, now(), conversationId)
    .run();
}
export async function recordCommercialInbound(
  db: D1Database,
  conversationId: string,
  messageId: string,
  at: string,
  body = '',
) {
  await cancelFollowUps(db, conversationId, 'Cliente respondeu');
  const declined =
    !body.trim() ||
    /\b(parar|pare|remover|cancelar mensagens|n[aã]o quero|n[aã]o tenho interesse|desisti|j[aá] marquei em outro)\b/i.test(
      body,
    );
  const sent = declined
    ? null
    : await db
        .prepare(`SELECT id FROM follow_ups WHERE conversation_id = ? AND status = 'SENT' AND recovered_at IS NULL
    AND sent_at < ? AND sent_at >= ? ORDER BY sent_at DESC LIMIT 1`)
        .bind(
          conversationId,
          at,
          new Date(Date.parse(at) - 7 * 86400000).toISOString(),
        )
        .first<{ id: string }>();
  if (sent) {
    await db
      .prepare(
        `UPDATE follow_ups SET recovered_at = ? WHERE conversation_id = ? AND status = 'SENT' AND sent_at < ? AND recovered_at IS NULL`,
      )
      .bind(at, conversationId, at)
      .run();
    await commercialEvent(db, conversationId, 'lead_recovered', sent.id, {
      followUpId: sent.id,
      messageId,
    });
    await db
      .prepare(
        'UPDATE opportunities SET recovered_at = ? WHERE conversation_id = ?',
      )
      .bind(at, conversationId)
      .run();
  }
  await db
    .prepare(`INSERT OR IGNORE INTO opportunities (id, conversation_id, title, stage, next_best_action, created_at, updated_at)
    VALUES (?, ?, 'Atendimento WhatsApp', 'NEW_LEAD', 'ANSWER_QUESTION', ?, ?)`)
    .bind(crypto.randomUUID(), conversationId, now(), now())
    .run();
  await db
    .prepare(`UPDATE opportunities SET last_interaction_at = MAX(COALESCE(last_interaction_at, ''), ?),
    next_best_action = CASE WHEN stage IN ('BOOKED','ATTENDED','LOST') THEN next_best_action ELSE 'ANSWER_QUESTION' END WHERE conversation_id = ?`)
    .bind(at, conversationId)
    .run();
}
export async function saveOpportunity(
  db: D1Database,
  conversationId: string,
  input: {
    interest: string | null;
    stage: string;
    summary: string;
    nextBestAction?: string;
    objection?: string | null;
    intent?: string;
  },
) {
  const price = input.interest
    ? (findCatalogService(input.interest)?.priceCents ?? null)
    : null;
  await db
    .prepare(`INSERT INTO opportunities
    (id, conversation_id, title, stage, interest, summary, next_best_action, objection, intent, estimated_value_cents, created_at, updated_at)
    VALUES (?, ?, 'Atendimento WhatsApp', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      stage = CASE WHEN opportunities.stage IN ('BOOKED','ATTENDED','LOST') THEN opportunities.stage ELSE excluded.stage END,
      interest = COALESCE(excluded.interest, opportunities.interest),
      summary = excluded.summary, next_best_action = CASE WHEN opportunities.stage IN ('BOOKED','ATTENDED','LOST')
        AND excluded.next_best_action NOT IN ('PROFESSIONAL_REVIEW','HUMAN_REPLY') THEN 'CLOSE' ELSE excluded.next_best_action END,
      objection = excluded.objection, intent = excluded.intent,
      estimated_value_cents = COALESCE(excluded.estimated_value_cents, opportunities.estimated_value_cents),
      updated_at = excluded.updated_at`)
    .bind(
      crypto.randomUUID(),
      conversationId,
      normalizeStage(input.stage),
      input.interest,
      input.summary,
      input.nextBestAction ?? 'PROFESSIONAL_REVIEW',
      input.objection ?? null,
      input.intent ?? null,
      price,
      now(),
      now(),
    )
    .run();
}
export async function customerContext(db: D1Database, conversationId: string) {
  const client = await db
    .prepare(`SELECT cl.name, cl.name_source, cl.preferred_professional, cl.notes, cl.lead_source,
    (SELECT MAX(start_at) FROM appointments WHERE client_id = cl.id AND status = 'COMPLETED') AS last_attended,
    (SELECT professional FROM appointments WHERE client_id = cl.id AND status = 'COMPLETED' ORDER BY start_at DESC LIMIT 1) AS last_professional
    FROM clients cl JOIN conversations c ON c.client_id = cl.id WHERE c.id = ?`)
    .bind(conversationId)
    .first();
  return (
    'CONTEXTO CADASTRADO (importação não comprova atendimento anterior; não invente memória):\n' +
    JSON.stringify(client)
  );
}
export async function scheduleCommercialFollowUp(
  db: D1Database,
  conversationId: string,
  agent: AgentResult,
  triggerId: string,
  maxAttempts = 2,
  windowDays = 30,
) {
  const plan = followUpPlan(agent);
  if (!plan) return;
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  const due = new Date(Date.now() + plan.delayHours * 3600000).toISOString();
  const timestamp = now();
  const id = crypto.randomUUID();
  const service = agent.interest
    ? findCatalogService(agent.interest)?.name.toLocaleLowerCase('pt-BR')
    : null;
  const message =
    plan.priority >= 90
      ? `Oi! Ainda quer marcar${service ? ' ' + service : ''}? Me diz o dia que prefere e a equipe confirma pra você.`
      : service
        ? `Oi! Ficou alguma dúvida sobre ${service}? Se quiser continuar, estou por aqui.`
        : 'Oi! Conseguiu pensar no que conversamos? Estou por aqui.';
  const result = await db
    .prepare(`INSERT INTO follow_ups
    (id, conversation_id, channel, scheduled_for, status, delivery_eligibility, template_required, message_body, trigger_message_id, priority, reason, created_at, updated_at)
    SELECT ?, c.id, c.channel, ?,
      CASE WHEN c.channel = 'WHATSAPP' AND COALESCE(c.customer_service_window_expires_at, '') <= ? THEN 'WAITING_FOR_TEMPLATE' ELSE 'SCHEDULED' END,
      CASE WHEN c.channel = 'WHATSAPP' AND COALESCE(c.customer_service_window_expires_at, '') <= ? THEN 'TEMPLATE_REQUIRED' ELSE 'FREE_FORM_ALLOWED' END,
      CASE WHEN c.channel = 'WHATSAPP' AND COALESCE(c.customer_service_window_expires_at, '') <= ? THEN 1 ELSE 0 END,
      ?, ?, ?, ?, ?, ?
    FROM conversations c JOIN clients cl ON cl.id = c.client_id JOIN opportunities o ON o.conversation_id = c.id
    WHERE c.id = ? AND c.control_state = 'AI_ACTIVE' AND cl.promotional_opt_out = 0
      AND o.stage NOT IN ('BOOKED','ATTENDED','LOST')
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id = c.id AND a.status IN ('PENDING_CONFIRMATION','CONFIRMED'))
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'INBOUND'
        AND m.created_at > (SELECT created_at FROM messages WHERE id = ?))
      AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.conversation_id = c.id AND
        (f.trigger_message_id = ? OR f.status IN ('SCHEDULED','WAITING_FOR_TEMPLATE','PROCESSING')))
      AND (SELECT COUNT(*) FROM follow_ups f JOIN conversations fc ON fc.id = f.conversation_id
        WHERE fc.client_id = c.client_id AND f.created_at >= ? AND f.status NOT IN ('CANCELLED','FAILED')) < ?`)
    .bind(
      id,
      due,
      due,
      due,
      due,
      message,
      triggerId,
      plan.priority,
      plan.reason,
      timestamp,
      timestamp,
      conversationId,
      triggerId,
      triggerId,
      since,
      maxAttempts,
    )
    .run();
  if (result.meta.changes)
    await commercialEvent(db, conversationId, 'followup_scheduled', id, {
      reason: plan.reason,
      scheduledFor: due,
      priority: plan.priority,
    });
}
export async function recordCommercialReply(
  db: D1Database,
  conversationId: string,
  agent: AgentResult,
  triggerId: string,
  maxAttempts = 2,
  windowDays = 30,
) {
  for (const event of commercialEvents(agent))
    await commercialEvent(
      db,
      conversationId,
      event,
      triggerId,
      { interest: agent.interest },
      'AI',
    );
  // Booking results have already been persisted by the scheduling service.
  await db
    .prepare(
      `UPDATE opportunities SET next_best_action = ? WHERE conversation_id = ? AND stage NOT IN ('BOOKED','ATTENDED','LOST') AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = opportunities.conversation_id AND c.control_state = 'AI_ACTIVE')`,
    )
    .bind(
      agent.nextBestAction === 'REQUEST_HUMAN_CONFIRMATION'
        ? agent.nextBestAction
        : agent.requiresFollowUp
          ? 'CREATE_FOLLOW_UP'
          : 'WAIT_REPLY',
      conversationId,
    )
    .run();
  await scheduleCommercialFollowUp(
    db,
    conversationId,
    agent,
    triggerId,
    maxAttempts,
    windowDays,
  );
}
export async function syncAppointment(db: D1Database, appointmentId: string) {
  const appointment = await db
    .prepare('SELECT * FROM appointments WHERE id = ?')
    .bind(appointmentId)
    .first<{
      conversation_id: string | null;
      client_id: string;
      status: string;
      service: string;
      estimated_value_cents: number | null;
    }>();
  if (!appointment?.conversation_id) return;
  const active = await db
    .prepare(`SELECT status FROM appointments WHERE conversation_id = ? AND status IN ('CONFIRMED','PENDING_CONFIRMATION')
    AND start_at > ? ORDER BY CASE WHEN status = 'CONFIRMED' THEN 0 ELSE 1 END LIMIT 1`)
    .bind(appointment.conversation_id, now())
    .first<{ status: string }>();
  const effectiveStatus = active?.status ?? appointment.status;
  const stage =
    effectiveStatus === 'COMPLETED'
      ? 'ATTENDED'
      : effectiveStatus === 'CONFIRMED'
        ? 'BOOKED'
        : 'WANTS_TO_BOOK';
  await saveOpportunity(db, appointment.conversation_id, {
    interest: appointment.service,
    stage,
    summary: 'Agenda atualizada',
    nextBestAction: stage === 'WANTS_TO_BOOK' ? 'OFFER_TIME' : 'CLOSE',
  });
  await db
    .prepare(
      'UPDATE opportunities SET stage = ?, next_best_action = ?, updated_at = ? WHERE conversation_id = ?',
    )
    .bind(
      stage,
      stage === 'WANTS_TO_BOOK' ? 'OFFER_TIME' : 'CLOSE',
      now(),
      appointment.conversation_id,
    )
    .run();
  if (appointment.status !== 'CANCELLED')
    await cancelFollowUps(
      db,
      appointment.conversation_id,
      'Agendamento criado',
    );
  if (appointment.status === 'CONFIRMED')
    await commercialEvent(
      db,
      appointment.conversation_id,
      'booking_completed',
      appointmentId,
      { appointmentId },
    );
  if (appointment.status === 'COMPLETED')
    await commercialEvent(
      db,
      appointment.conversation_id,
      'appointment_attended',
      appointmentId,
      { appointmentId },
    );
  if (appointment.status === 'CANCELLED')
    await commercialEvent(
      db,
      appointment.conversation_id,
      'booking_cancelled',
      appointmentId,
      { appointmentId },
    );
}
export { commercialStage };
