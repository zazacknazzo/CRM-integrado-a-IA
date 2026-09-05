import type { PipelineDependencies } from '../core/contracts.ts';
import { followUpEligibility } from '../core/follow-up-policy.ts';
import { commercialEvent } from './commercial.ts';

type FollowUp = {
  id: string;
  conversation_id: string;
  channel: 'WHATSAPP' | 'SIMULATOR';
  message_body: string | null;
  template_name: string | null;
  template_required: number;
  outbound_message_id: string | null;
  attempt_count: number;
  trigger_message_id: string | null;
  status: string;
  created_at: string;
};
export async function runFollowUps(
  db: D1Database,
  pipeline: PipelineDependencies,
) {
  const { repository } = pipeline;
  const timestamp = new Date().toISOString();
  await db
    .prepare(`UPDATE follow_ups SET status = 'SCHEDULED', locked_at = NULL WHERE status = 'PROCESSING' AND locked_at < ?
    AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = follow_ups.conversation_id AND c.processing_lock_until > ?)`)
    .bind(new Date(Date.now() - 120000).toISOString(), timestamp)
    .run();
  const due = await db
    .prepare(
      `SELECT * FROM follow_ups WHERE status = 'SCHEDULED' AND COALESCE(next_attempt_at,scheduled_for) <= ? ORDER BY priority DESC, scheduled_for LIMIT 20`,
    )
    .bind(timestamp)
    .all<FollowUp>();
  let sent = 0,
    failed = 0,
    cancelled = 0;
  for (const item of due.results) {
    const owner = crypto.randomUUID();
    if (
      !(await repository.acquireProcessingLock?.(item.conversation_id, owner))
    )
      continue;
    let messageId = item.outbound_message_id;
    let accepted = false;
    const claimAt = new Date().toISOString();
    try {
      const claimed = await db
        .prepare(
          `UPDATE follow_ups SET status = 'PROCESSING', locked_at = ? WHERE id = ? AND status = 'SCHEDULED'`,
        )
        .bind(claimAt, item.id)
        .run();
      if (!claimed.meta.changes) continue;
      // Reload all eligibility immediately before dispatch, including cancellation by a new inbound message.
      const fresh = await db
        .prepare(`SELECT f.status, c.control_state, c.customer_service_window_expires_at, cl.promotional_opt_out,
        EXISTS(SELECT 1 FROM appointments a WHERE a.conversation_id = c.id AND a.status IN ('CONFIRMED','PENDING_CONFIRMATION')) AS booked,
        EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'INBOUND' AND
          m.created_at > COALESCE((SELECT created_at FROM messages WHERE id = f.trigger_message_id), f.created_at)) AS replied,
        EXISTS(SELECT 1 FROM opportunities o WHERE o.conversation_id = c.id AND o.stage IN ('BOOKED','ATTENDED','LOST')) AS closed
        FROM follow_ups f JOIN conversations c ON c.id = f.conversation_id JOIN clients cl ON cl.id = c.client_id WHERE f.id = ?`)
        .bind(item.id)
        .first<{
          status: string;
          control_state: string;
          customer_service_window_expires_at: string | null;
          promotional_opt_out: number;
          booked: number;
          replied: number;
          closed: number;
        }>();
      if (!fresh) continue;
      const template = item.template_name
        ? await db
            .prepare(
              'SELECT name, language FROM whatsapp_templates WHERE name = ? AND approved = 1 ORDER BY language LIMIT 1',
            )
            .bind(item.template_name)
            .first<{ name: string; language: string }>()
        : null;
      const eligibility = followUpEligibility({
        status: fresh.status,
        control: fresh.control_state,
        expiresAt: fresh.customer_service_window_expires_at,
        optedOut: !!fresh.promotional_opt_out,
        booked: !!(fresh.booked || fresh.closed),
        replied: !!fresh.replied,
        channel: item.channel,
        approvedTemplate: !!template,
        templateRequired: !!item.template_required,
      });
      if (eligibility !== 'SEND') {
        await db
          .prepare(
            `UPDATE follow_ups SET status = ?, locked_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND status = 'PROCESSING'`,
          )
          .bind(
            eligibility === 'CANCEL' ? 'CANCELLED' : 'WAITING_FOR_TEMPLATE',
            eligibility === 'CANCEL'
              ? 'Cliente respondeu, agendou ou atendimento passou à equipe'
              : 'Janela encerrada: configure template aprovado',
            timestamp,
            item.id,
          )
          .run();
        if (eligibility === 'CANCEL') cancelled++;
        continue;
      }
      await commercialEvent(
        db,
        item.conversation_id,
        'stopped_replying',
        item.id,
        { followUpId: item.id },
      );
      const conversation = await repository.getConversation(
        item.conversation_id,
      );
      const useTemplate =
        !!item.template_required ||
        (item.channel === 'WHATSAPP' &&
          !(
            Date.parse(fresh.customer_service_window_expires_at ?? '') >
            Date.now()
          ));
      if (!item.message_body && !template)
        throw new Error('Mensagem do follow-up ausente');
      messageId ??= await repository.createOutbound(item.conversation_id, {
        senderType: 'AI',
        body: item.message_body ?? '[template]',
        channel: item.channel,
      });
      await db
        .prepare(
          'UPDATE follow_ups SET outbound_message_id = ? WHERE id = ? AND status = ?',
        )
        .bind(messageId, item.id, 'PROCESSING')
        .run();
      const existing = await repository.getOutboundMessage?.(messageId);
      const guard = await db
        .prepare(`SELECT f.id FROM follow_ups f JOIN conversations c ON c.id = f.conversation_id JOIN clients cl ON cl.id = c.client_id
        WHERE f.id = ? AND f.status = 'PROCESSING' AND c.control_state = 'AI_ACTIVE' AND cl.promotional_opt_out = 0
        AND c.processing_lock_owner = ?
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'INBOUND'
          AND m.created_at > COALESCE((SELECT created_at FROM messages WHERE id = f.trigger_message_id), f.created_at))
        AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.conversation_id = c.id AND o.stage IN ('BOOKED','ATTENDED','LOST'))
        AND (? = 1 OR c.channel != 'WHATSAPP' OR c.customer_service_window_expires_at > ?)
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id = c.id AND a.status IN ('CONFIRMED','PENDING_CONFIRMATION'))`)
        .bind(item.id, owner, useTemplate ? 1 : 0, new Date().toISOString())
        .first();
      if (!guard) {
        await db
          .prepare(
            `UPDATE follow_ups SET status = 'CANCELLED', locked_at = NULL, last_error = 'Elegibilidade mudou antes do envio', updated_at = ? WHERE id = ? AND status = 'PROCESSING' AND locked_at = ?`,
          )
          .bind(new Date().toISOString(), item.id, claimAt)
          .run();
        cancelled++;
        continue;
      }
      const result =
        existing && ['sent', 'delivered', 'read'].includes(existing.status)
          ? { acceptedAt: timestamp }
          : await pipeline.channels[item.channel].sendMessage({
              to: conversation.phoneE164,
              type: useTemplate ? 'template' : 'text',
              text: useTemplate ? undefined : item.message_body!,
              templateName: template?.name,
              templateLanguage: template?.language,
              idempotencyKey: messageId,
            });
      accepted = true;
      if ('externalId' in result)
        await repository.markOutboundAccepted(messageId, result);
      await db
        .prepare(
          `UPDATE follow_ups SET status = 'SENT', sent_at = ?, locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'PROCESSING' AND locked_at = ?`,
        )
        .bind(result.acceptedAt, timestamp, item.id, claimAt)
        .run();
      await commercialEvent(
        db,
        item.conversation_id,
        'followup_sent',
        item.id,
        { followUpId: item.id },
        'AI',
      );
      await db
        .prepare(
          `UPDATE opportunities SET next_best_action = 'WAIT_REPLY' WHERE conversation_id = ? AND stage NOT IN ('BOOKED','ATTENDED','LOST') AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = opportunities.conversation_id AND c.control_state = 'AI_ACTIVE')`,
        )
        .bind(item.conversation_id)
        .run();
      sent++;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (accepted) {
        const persisted = messageId
          ? await repository.getOutboundMessage?.(messageId)
          : null;
        if (
          persisted &&
          ['sent', 'delivered', 'read'].includes(persisted.status)
        ) {
          await db
            .prepare(
              "UPDATE follow_ups SET status = 'SENT', sent_at = COALESCE(sent_at, ?), locked_at = NULL WHERE id = ? AND status = 'PROCESSING' AND locked_at = ?",
            )
            .bind(new Date().toISOString(), item.id, claimAt)
            .run();
          await commercialEvent(
            db,
            item.conversation_id,
            'followup_sent',
            item.id,
            { followUpId: item.id },
            'AI',
          );
          sent++;
        } else {
          const reason =
            'Envio aceito; confirmação local falhou. Conferir no WhatsApp antes de reenviar.';
          await repository.setControlState(
            item.conversation_id,
            'HUMAN_CONTROL',
            reason,
          );
          await repository.createHandoff(
            item.conversation_id,
            undefined,
            reason,
          );
          await db
            .prepare(
              "UPDATE follow_ups SET status = 'FAILED', locked_at = NULL, last_error = ? WHERE id = ?",
            )
            .bind(reason, item.id)
            .run();
          failed++;
        }
        await repository.audit(
          item.conversation_id,
          'followup_bookkeeping_failed',
          'SYSTEM',
          { followUpId: item.id, reason: detail },
        );
        continue;
      }
      if (messageId) await repository.markOutboundFailed(messageId, detail);
      const attempts = item.attempt_count + 1;
      await db
        .prepare(
          `UPDATE follow_ups SET status = ?, attempt_count = ?, next_attempt_at = ?, locked_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND status = 'PROCESSING' AND locked_at = ?`,
        )
        .bind(
          attempts >= 3 ? 'FAILED' : 'SCHEDULED',
          attempts,
          new Date(Date.now() + 15000 * 3 ** item.attempt_count).toISOString(),
          detail.slice(0, 500),
          timestamp,
          item.id,
          claimAt,
        )
        .run();
      if (attempts >= 3) failed++;
    } finally {
      await repository.releaseProcessingLock?.(item.conversation_id, owner);
    }
  }
  return { checked: due.results.length, sent, failed, cancelled };
}
