import type { AgentResult } from './contracts.ts';

export const stageNames: Record<string, string> = {
  NEW_LEAD: 'Novo lead',
  IN_CONVERSATION: 'Em conversa',
  QUALIFIED: 'Interesse definido',
  WANTS_TO_BOOK: 'Quer agendar',
  BOOKED: 'Agendado',
  ATTENDED: 'Atendido',
  LOST: 'Perdido',
};
export const actionNames: Record<string, string> = {
  ANSWER_QUESTION: 'Responder dúvida',
  QUALIFY: 'Entender o serviço',
  HANDLE_OBJECTION: 'Resolver objeção',
  OFFER_PERIOD: 'Definir dia e período',
  OFFER_TIME: 'Equipe consultar agenda',
  CONFIRM_BOOKING: 'Confirmar horário',
  CREATE_FOLLOW_UP: 'Retomar conversa',
  REQUEST_HUMAN_CONFIRMATION: 'Equipe confirmar informação',
  WAIT_REPLY: 'Aguardar resposta',
  PROFESSIONAL_REVIEW: 'Profissional assumir',
  HUMAN_REPLY: 'Responder pessoalmente',
  CLOSE: 'Encerrar oportunidade',
};
export function normalizeStage(stage?: string | null) {
  const aliases: Record<string, string> = {
    NEW: 'NEW_LEAD',
    QUALIFICATION: 'QUALIFIED',
    SCHEDULING: 'WANTS_TO_BOOK',
    WON: 'WANTS_TO_BOOK',
    TIME_OFFERED: 'WANTS_TO_BOOK',
    OBJECTION: 'QUALIFIED',
    FOLLOW_UP: 'IN_CONVERSATION',
    HUMAN_CONFIRMATION: 'IN_CONVERSATION',
    PROFESSIONAL_REVIEW: 'IN_CONVERSATION',
    AGENDAMENTO_EM_ANDAMENTO: 'WANTS_TO_BOOK',
    AGENDAMENTO_SOLICITADO: 'WANTS_TO_BOOK',
    CONSIDERATION: 'IN_CONVERSATION',
    INTEREST: 'QUALIFIED',
    'consideração': 'IN_CONVERSATION',
  };
  return stage && stageNames[stage]
    ? stage
    : (aliases[stage ?? ''] ?? 'NEW_LEAD');
}

// Closing is based on persisted appointments, never on the model's stage label.
export function commercialStage(agent: AgentResult) {
  if (
    agent.intent === 'AGENDAR' ||
    ['OFFER_TIME', 'OFFER_PERIOD', 'CONFIRM_BOOKING'].includes(
      agent.nextBestAction,
    )
  )
    return 'WANTS_TO_BOOK';
  return agent.interest ? 'QUALIFIED' : 'IN_CONVERSATION';
}
export function followUpPlan(agent: AgentResult) {
  const booking = ['OFFER_TIME', 'OFFER_PERIOD', 'CONFIRM_BOOKING'].includes(
    agent.nextBestAction,
  );
  if (agent.nextBestAction === 'REQUEST_HUMAN_CONFIRMATION') return null;
  if (!booking && !agent.interest && !agent.requiresFollowUp) return null;
  return {
    priority: booking ? 90 : agent.requiresFollowUp ? 55 : 65,
    delayHours: booking ? 2 : agent.requiresFollowUp ? 20 : 6,
    reason: booking
      ? 'BOOKING_ABANDONED'
      : agent.requiresFollowUp
        ? 'THINKING'
        : /pre[cç]o|price/i.test(agent.intent)
          ? 'PRICE_NO_REPLY'
          : 'INTEREST_NO_REPLY',
  };
}
export function commercialEvents(agent: AgentResult) {
  const events: string[] = [];
  if (agent.interest) events.push('service_interest_detected');
  if (/pre[cç]o|price/i.test(agent.intent)) events.push('price_asked');
  if (agent.objection === 'PRICE') events.push('price_objection');
  if (agent.requiresFollowUp) events.push('thinking');
  if (
    agent.intent === 'AGENDAR' ||
    ['OFFER_TIME', 'OFFER_PERIOD', 'CONFIRM_BOOKING'].includes(
      agent.nextBestAction,
    )
  )
    events.push('schedule_asked', 'booking_started');
  return events;
}
export function stalledMinutes(at: string | null, now = Date.now()) {
  return at ? Math.max(0, Math.floor((now - Date.parse(at)) / 60_000)) : 0;
}
export function attentionPriority(
  item: {
    control_state: string;
    opportunity_stage?: string | null;
    next_best_action?: string | null;
    pending_follow_up_at?: string | null;
    last_direction?: string | null;
    last_interaction_at?: string | null;
  },
  now = Date.now(),
) {
  if (item.control_state === 'PROFESSIONAL_HANDOFF') return 120;
  if (
    item.control_state === 'HUMAN_CONTROL' &&
    item.last_direction === 'INBOUND'
  )
    return 110;
  if (
    ['BOOKED', 'ATTENDED', 'LOST'].includes(
      normalizeStage(item.opportunity_stage),
    )
  )
    return 0;
  if (item.pending_follow_up_at && Date.parse(item.pending_follow_up_at) <= now)
    return 95;
  if (item.next_best_action === 'REQUEST_HUMAN_CONFIRMATION') return 90;
  if (item.opportunity_stage === 'TIME_OFFERED') return 85;
  if (normalizeStage(item.opportunity_stage) === 'WANTS_TO_BOOK') return 80;
  if (item.last_direction === 'INBOUND') return 70;
  return Math.min(
    60,
    20 + stalledMinutes(item.last_interaction_at ?? null, now) / 60,
  );
}
