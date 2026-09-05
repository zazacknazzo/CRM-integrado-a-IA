import type { AgentResult, StoredMessage } from '../core/contracts.ts';
import { chosenTime, requestedDay, slotLabel } from '../core/booking.ts';
import { findCatalogService } from '../knowledge/catalog.ts';

// Used only by the team's manual appointment endpoint.
export const noConflict = `NOT EXISTS (SELECT 1 FROM appointments a
  WHERE lower(a.professional) = lower(s.professional) AND a.status IN ('CONFIRMED','PENDING_CONFIRMATION')
  AND julianday(a.start_at) < julianday(s.start_at, '+' || s.duration_minutes || ' minutes')
  AND julianday(a.start_at, '+' || a.duration_minutes || ' minutes') > julianday(s.start_at))`;

function reply(
  text: string,
  service: string | null,
  action: AgentResult['nextBestAction'],
  summary: string,
): AgentResult {
  return {
    reply: text,
    interest: service,
    opportunityStage: 'WANTS_TO_BOOK',
    crmSummary: summary,
    intent: 'AGENDAR',
    temperature: 'VERY_HOT',
    objection: null,
    nextBestAction: action,
    requiresFollowUp: false,
  };
}

// No connected salon agenda in this MVP: capture a request, never offer or reserve a slot.
export async function resolveBooking(
  db: D1Database,
  conversationId: string,
  messages: StoredMessage[],
  _triggerId: string,
  agent?: AgentResult,
): Promise<AgentResult | null> {
  const inbound = messages.filter((m) => m.direction === 'INBOUND');
  const latest = inbound.at(-1)?.body ?? '';
  const opportunity = await db
    .prepare(
      'SELECT interest, stage, intent FROM opportunities WHERE conversation_id = ?',
    )
    .bind(conversationId)
    .first<{ interest: string | null; stage: string; intent: string | null }>();
  const explicit =
    /\b(agendar|marcar|reservar|quero um hor[aá]rio|tem vaga)\b/i.test(latest);
  const preference = Boolean(
    requestedDay(latest) ||
    chosenTime(latest) ||
    /\b(manh[ãa]|tarde|noite)\b/i.test(latest),
  );
  const modelBooking =
    !!agent &&
    (['OFFER_TIME', 'OFFER_PERIOD', 'CONFIRM_BOOKING'].includes(
      agent.nextBestAction,
    ) ||
      ['BOOKED', 'TIME_OFFERED', 'WON'].includes(agent.opportunityStage) ||
      /(?:confirmad|reservad|agendad).{0,30}(?:para|[àa]s)|(?:tenho|temos).{0,30}\d{1,2}(?:h|:)/i.test(
        agent.reply,
      ));
  const continuing =
    preference &&
    (opportunity?.stage === 'WANTS_TO_BOOK' ||
      opportunity?.intent === 'AGENDAR');
  if (!explicit && !continuing && !modelBooking) return null;

  const current = await db
    .prepare(`SELECT service, professional, start_at, status FROM appointments
    WHERE conversation_id = ? AND status IN ('CONFIRMED','PENDING_CONFIRMATION') AND start_at > ? ORDER BY start_at LIMIT 1`)
    .bind(conversationId, new Date().toISOString())
    .first<{
      service: string;
      professional: string;
      start_at: string;
      status: string;
    }>();
  if (current)
    return reply(
      current.status === 'CONFIRMED'
        ? `Você já tem ${current.service} confirmado para ${slotLabel(current.start_at)} com ${current.professional}. Quer pedir alguma alteração à equipe?`
        : 'Seu pedido já está com a equipe. Ela vai confirmar o horário com você.',
      current.service,
      'REQUEST_HUMAN_CONFIRMATION',
      'Cliente consultou ou pediu alteração no agendamento registrado pela equipe.',
    );

  if (explicit)
    await db
      .prepare(`UPDATE opportunities SET stage = 'WANTS_TO_BOOK', next_best_action = 'OFFER_PERIOD', lost_reason = NULL
    WHERE conversation_id = ? AND stage IN ('ATTENDED','LOST','BOOKED')`)
      .bind(conversationId)
      .run();
  const service =
    findCatalogService(latest) ??
    (agent?.interest ? findCatalogService(agent.interest) : null) ??
    (opportunity?.interest ? findCatalogService(opportunity.interest) : null);
  if (!service)
    return reply(
      'Você quer marcar qual serviço?',
      null,
      'QUALIFY',
      'Pedido de agendamento: falta definir o serviço.',
    );

  // Only reuse preferences from this booking request, not unrelated old visits.
  const start = inbound.findLastIndex((m) =>
    /\b(agendar|marcar|reservar)\b/i.test(m.body ?? ''),
  );
  const context = inbound
    .slice(start >= 0 ? start : -3)
    .map((m) => m.body ?? '')
    .join(' ');
  const day = requestedDay(context);
  const time = chosenTime(latest);
  const period = /\b(manh[ãa]|tarde|noite)\b/i.exec(context)?.[0] ?? null;
  const summary = `Pedido de ${service.name}; dia: ${day ?? 'não definido'}; preferência: ${time ?? period ?? 'não definida'}. A equipe precisa consultar a agenda real e confirmar; nenhuma reserva foi feita.`;
  if (!day)
    return reply(
      'Qual dia fica melhor pra você?',
      service.name,
      'OFFER_PERIOD',
      summary,
    );
  if (!period && !time)
    return reply(
      'Você prefere de manhã ou à tarde?',
      service.name,
      'OFFER_PERIOD',
      summary,
    );
  return reply(
    'Pode deixar! A equipe vai conferir esse período e confirmar o horário com você.',
    service.name,
    'REQUEST_HUMAN_CONFIRMATION',
    summary,
  );
}
