import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { D1ConversationRepository } from '../db/repository.ts';
import {
  processInboundMessage,
  processPendingConversation,
} from '../core/pipeline.ts';
import { commercialDashboard } from '../db/dashboard.ts';
import {
  recordCommercialInbound,
  scheduleCommercialFollowUp,
  syncAppointment,
} from '../db/commercial.ts';
import { scheduleManualFollowUp } from '../db/follow-up-scheduling.ts';
import { runFollowUps } from '../db/follow-up-runner.ts';
import { followUpEligibility } from '../core/follow-up-policy.ts';
import { createAgents } from '../agents/openai-agents.ts';
import type {
  AgentResult,
  InboundMessageInput,
  PipelineDependencies,
  SendMessageInput,
} from '../core/contracts.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sql.exec(
      readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'),
    );
  function prepare(query: string, values: unknown[] = []): any {
    const statement = sql.prepare(query);
    const args = values as (string | number | null)[];
    return {
      bind: (...bound: unknown[]) => prepare(query, bound),
      first: async (field?: string) => {
        const row = statement.get(...args);
        return row ? (field ? row[field] : row) : null;
      },
      all: async () => ({ results: statement.all(...args), success: true }),
      run: async () => {
        const r = statement.run(...args);
        return { meta: { changes: Number(r.changes) }, success: true };
      },
      execute: () => statement.run(...args),
    };
  }
  const db = {
    prepare,
    batch: async (statements: { execute: () => unknown }[]) => {
      sql.exec('BEGIN');
      try {
        const results = statements.map((s) => s.execute());
        sql.exec('COMMIT');
        return results;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
  const repository = new D1ConversationRepository(db);
  let agent: AgentResult = {
    reply: 'A progressiva fica a partir de R$ 180. Seu cabelo está até onde?',
    intent: 'PRECO',
    opportunityStage: 'QUALIFICATION',
    interest: 'Progressiva',
    crmSummary: 'Consultou progressiva',
    temperature: 'HOT',
    objection: null,
    nextBestAction: 'QUALIFY',
    requiresFollowUp: false,
  };
  const sent: SendMessageInput[] = [];
  const channel = {
    name: 'WHATSAPP' as const,
    enforcesCustomerServiceWindow: true,
    sendMessage: async (input: SendMessageInput) => {
      sent.push(input);
      return {
        externalId: crypto.randomUUID(),
        status: 'sent' as const,
        acceptedAt: new Date().toISOString(),
      };
    },
  };
  const deps: PipelineDependencies = {
    repository,
    channels: { WHATSAPP: channel, SIMULATOR: channel },
    professionalGate: createAgents({}).professionalGate,
    commercialAgent: { respond: async () => agent },
    responseVerifier: {
      verify: async ({ proposedReply }) => ({
        allowed: true,
        reason: 'test',
        finalReply: proposedReply,
      }),
    },
    knowledge: '',
    debounceMs: 0,
  };
  let index = 0;
  function input(
    text: string,
    channel: InboundMessageInput['channel'] = 'WHATSAPP',
    phone = '+5521999990001',
  ): InboundMessageInput {
    return {
      externalId: crypto.randomUUID(),
      channel,
      fromPhone: phone,
      type: 'text',
      text,
      timestamp: new Date(Date.now() - 10000 + index++ * 100).toISOString(),
    };
  }
  const send = (
    text: string,
    channel?: InboundMessageInput['channel'],
    phone?: string,
  ) => processInboundMessage(input(text, channel, phone), deps);
  const row = (query: string) =>
    sql.prepare(query).get() as Record<string, any>;
  const count = (table: string) =>
    Number(row('SELECT COUNT(*) n FROM ' + table).n);
  return {
    sql,
    db,
    repository,
    deps,
    sent,
    input,
    send,
    row,
    count,
    setAgent: (next: Partial<AgentResult>) => {
      agent = { ...agent, ...next };
    },
    getAgent: () => agent,
  };
}

test('commercial persistence creates one contextual follow-up and deduplicated events', async () => {
  const f = fixture();
  const message = f.input('quanto é progressiva?');
  const first = await processInboundMessage(message, f.deps);
  assert.equal(first.status, 'SENT');
  await processInboundMessage(message, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.count('follow_ups'), 1);
  assert.equal(
    f.row(
      'SELECT stage,next_best_action,estimated_value_cents FROM opportunities',
    ).estimated_value_cents,
    18000,
  );
  assert.equal(
    f.row("SELECT COUNT(*) n FROM audit_events WHERE event_type='price_asked'")
      .n,
    1,
  );
  assert.equal(f.row('SELECT priority FROM follow_ups').priority, 65);
  f.sql.close();
});

test('unconnected agenda captures day/period, leaves team action and never creates a reservation', async () => {
  const f = fixture();
  await f.send('Quero agendar progressiva');
  assert.match(f.sent.at(-1)!.text!, /qual dia/i);
  await f.send('sexta');
  assert.match(f.sent.at(-1)!.text!, /manhã ou à tarde/);
  await f.send('tarde');
  assert.match(f.sent.at(-1)!.text!, /equipe.*confirmar/);
  assert.equal(f.count('appointments'), 0);
  const o = f.row('SELECT * FROM opportunities');
  assert.equal(o.stage, 'WANTS_TO_BOOK');
  assert.equal(o.next_best_action, 'REQUEST_HUMAN_CONFIRMATION');
  assert.match(o.summary, /tarde.*nenhuma reserva/i);
  assert.equal(
    f.row("SELECT COUNT(*) n FROM follow_ups WHERE status='SCHEDULED'").n,
    0,
  );
  f.sql.close();
});

test('model cannot invent availability or close a booking by setting its own stage', async () => {
  const f = fixture();
  f.setAgent({
    opportunityStage: 'BOOKED',
    reply: 'Tenho 14h. Reservado para amanhã.',
    nextBestAction: 'CONFIRM_BOOKING',
  });
  await f.send('quero progressiva');
  assert.doesNotMatch(f.sent[0].text!, /14h|reservado|confirmado/i);
  assert.equal(f.row('SELECT stage FROM opportunities').stage, 'WANTS_TO_BOOK');
  assert.equal(f.count('appointments'), 0);
  f.sql.close();
});

test('professional handoff remains absolutely silent and cancels automatic follow-ups', async () => {
  const f = fixture();
  await f.send('quanto é progressiva?');
  await f.send('Meu cabelo está quebrando depois da química');
  assert.equal(f.sent.length, 1);
  assert.equal(
    f.row('SELECT control_state FROM conversations').control_state,
    'PROFESSIONAL_HANDOFF',
  );
  assert.equal(
    f.row('SELECT next_best_action FROM opportunities').next_best_action,
    'PROFESSIONAL_REVIEW',
  );
  assert.equal(f.row('SELECT status FROM follow_ups').status, 'CANCELLED');
  assert.equal(f.count('appointments'), 0);
  f.sql.close();
});

test('retry repairs commercial events and follow-up without a second outbound row', async () => {
  const f = fixture();
  const normal = f.deps.channels.WHATSAPP.sendMessage;
  let fail = true;
  f.deps.channels.WHATSAPP.sendMessage = async (i) => {
    if (fail) {
      fail = false;
      throw Error('offline');
    }
    return normal(i);
  };
  const result = await f.send('quanto é progressiva?');
  assert.equal(result.status, 'RETRY_SCHEDULED');
  f.sql.exec('UPDATE messages SET next_processing_at=NULL');
  await processPendingConversation(result.conversationId, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.count('follow_ups'), 1);
  assert.equal(
    f.row("SELECT COUNT(*) n FROM messages WHERE direction='OUTBOUND'").n,
    1,
  );
  assert.equal(
    f.row("SELECT COUNT(*) n FROM audit_events WHERE event_type='price_asked'")
      .n,
    1,
  );
  f.sql.close();
});

test('post-send bookkeeping failure never downgrades a sent message or resends it', async () => {
  const f = fixture();
  f.repository.noteIntegration = async () => {
    throw Error('bookkeeping unavailable');
  };
  const result = await f.send('quanto é progressiva?');
  assert.equal(result.status, 'SENT');
  assert.equal(
    f.row("SELECT status FROM messages WHERE direction='OUTBOUND'").status,
    'sent',
  );
  await processPendingConversation(result.conversationId, f.deps);
  assert.equal(f.sent.length, 1);
  f.sql.close();
});

test('accepted but locally unrecorded delivery is handed to the team, never blindly retried', async () => {
  const f = fixture();
  f.repository.markOutboundAccepted = async () => {
    throw Error('local write failed');
  };
  const result = await f.send('quanto é progressiva?');
  assert.equal(result.status, 'BLOCKED');
  assert.equal(
    f.row('SELECT control_state FROM conversations').control_state,
    'HUMAN_CONTROL',
  );
  await processPendingConversation(result.conversationId, f.deps);
  assert.equal(f.sent.length, 1);
  f.sql.close();
});

test('handoff during transport preserves professional action after reply bookkeeping', async () => {
  const f = fixture(),
    normal = f.deps.channels.WHATSAPP.sendMessage;
  f.deps.channels.WHATSAPP.sendMessage = async (i) => {
    const c = f.row('SELECT id FROM conversations');
    await f.repository.setControlState(
      c.id,
      'PROFESSIONAL_HANDOFF',
      'Equipe assumiu',
    );
    return normal(i);
  };
  await f.send('quanto é progressiva?');
  assert.equal(
    f.row('SELECT next_best_action FROM opportunities').next_best_action,
    'PROFESSIONAL_REVIEW',
  );
  assert.equal(f.count('follow_ups'), 0);
  f.sql.close();
});

test('manual return enforces minimum delay, one pending job and per-client limit atomically', async () => {
  const f = fixture();
  const result = await f.send('quanto é progressiva?');
  const c = result.conversationId;
  const input = {
    conversationId: c,
    scheduledFor: new Date(Date.now() + 3 * 3600000).toISOString(),
    message: 'Ainda tem dúvida?',
  };
  assert.equal(
    (
      await scheduleManualFollowUp(f.db, {
        ...input,
        scheduledFor: new Date().toISOString(),
      })
    ).code,
    400,
  );
  assert.equal((await scheduleManualFollowUp(f.db, input)).code, 409);
  f.sql.exec(
    "UPDATE follow_ups SET status='SENT',sent_at='" +
      new Date(Date.now() - 4 * 3600000).toISOString() +
      "'",
  );
  const outcomes = await Promise.all([
    scheduleManualFollowUp(f.db, input),
    scheduleManualFollowUp(f.db, input),
  ]);
  assert.deepEqual(outcomes.map((o) => o.code).sort(), [201, 409]);
  f.sql.exec("UPDATE follow_ups SET status='SENT'");
  assert.equal((await scheduleManualFollowUp(f.db, input)).code, 409);
  f.sql.close();
});

test('recovery requires an actual sent return and excludes explicit refusal/opt-out', async () => {
  const f = fixture();
  const result = await f.send('quanto é progressiva?');
  const c = result.conversationId;
  await recordCommercialInbound(
    f.db,
    c,
    'x',
    new Date().toISOString(),
    'Sim, quero continuar',
  );
  assert.equal(
    f.row(
      "SELECT COUNT(*) n FROM audit_events WHERE event_type='lead_recovered'",
    ).n,
    0,
  );
  f.sql.exec(
    "UPDATE follow_ups SET status='SENT',sent_at='" +
      new Date(Date.now() - 1000).toISOString() +
      "'",
  );
  await recordCommercialInbound(
    f.db,
    c,
    'y',
    new Date().toISOString(),
    'Pare de mandar mensagens, não quero',
  );
  assert.equal(
    f.row(
      "SELECT COUNT(*) n FROM audit_events WHERE event_type='lead_recovered'",
    ).n,
    0,
  );
  await recordCommercialInbound(
    f.db,
    c,
    'z',
    new Date().toISOString(),
    'Sim, quero continuar',
  );
  await recordCommercialInbound(
    f.db,
    c,
    'z2',
    new Date().toISOString(),
    'Sexta',
  );
  assert.equal(
    f.row(
      "SELECT COUNT(*) n FROM audit_events WHERE event_type='lead_recovered'",
    ).n,
    1,
  );
  f.sql.close();
});

test('follow-up runner sends only once, respects fresh takeover and records events', async () => {
  const f = fixture();
  await f.send('quanto é progressiva?');
  f.sql.exec("UPDATE follow_ups SET scheduled_for='2000-01-01T00:00:00.000Z'");
  assert.equal((await runFollowUps(f.db, f.deps)).sent, 1);
  assert.equal((await runFollowUps(f.db, f.deps)).sent, 0);
  assert.equal(f.sent.length, 2);
  assert.equal(
    f.row(
      "SELECT COUNT(*) n FROM audit_events WHERE event_type='followup_sent'",
    ).n,
    1,
  );
  f.sql.close();
});

test('runner cancels when customer replies or team takes over immediately before transport', async () => {
  const f = fixture();
  const result = await f.send('quanto é progressiva?');
  f.sql.exec("UPDATE follow_ups SET scheduled_for='2000-01-01T00:00:00.000Z'");
  const original = f.repository.getOutboundMessage.bind(f.repository);
  f.repository.getOutboundMessage = async (id) => {
    await f.repository.setControlState(
      result.conversationId,
      'HUMAN_CONTROL',
      'Equipe assumiu',
    );
    return original(id);
  };
  await runFollowUps(f.db, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.row('SELECT status FROM follow_ups').status, 'CANCELLED');
  assert.equal(
    f.row('SELECT next_best_action FROM opportunities').next_best_action,
    'HUMAN_REPLY',
  );
  f.sql.close();
});

test('expired/invalid WhatsApp window requires approved template and preserves stored language', async () => {
  const f = fixture();
  await f.send('quanto é progressiva?');
  f.sql.exec(
    "UPDATE follow_ups SET scheduled_for='2000-01-01T00:00:00.000Z'; UPDATE conversations SET customer_service_window_expires_at='invalid'",
  );
  await runFollowUps(f.db, f.deps);
  assert.equal(
    f.row('SELECT status FROM follow_ups').status,
    'WAITING_FOR_TEMPLATE',
  );
  assert.equal(f.sent.length, 1);
  f.sql.exec(
    "INSERT INTO whatsapp_templates(id,name,language,category,approved,created_at) VALUES('t','retorno','pt_PT','MARKETING',1,'2026-01-01'); UPDATE follow_ups SET status='SCHEDULED',template_name='retorno',template_required=1",
  );
  await runFollowUps(f.db, f.deps);
  assert.equal(f.sent.at(-1)!.type, 'template');
  assert.equal(f.sent.at(-1)!.templateLanguage, 'pt_PT');
  f.sql.close();
});

test('dashboard excludes simulator and never counts multiple bookings as multiple converted leads', async () => {
  const f = fixture();
  const real = await f.send('quanto é progressiva?');
  await f.send('quanto é progressiva?', 'SIMULATOR', '+5521999990002');
  const c = f.row("SELECT * FROM conversations WHERE channel='WHATSAPP'");
  const timestamp = new Date().toISOString(),
    future = new Date(Date.now() + 86400000).toISOString();
  for (const id of ['a1', 'a2'])
    f.sql
      .prepare(
        'INSERT INTO appointments (id,conversation_id,client_id,professional,service,start_at,duration_minutes,status,created_at,updated_at,estimated_value_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        real.conversationId,
        c.client_id,
        'Profissional exemplo',
        'Progressiva',
        future,
        120,
        'CONFIRMED',
        timestamp,
        timestamp,
        id === 'a1' ? 18000 : null,
      );
  await syncAppointment(f.db, 'a1');
  const d = await commercialDashboard(f.db);
  assert.equal(d.leads_week, 1);
  assert.equal(d.converted_leads, 1);
  assert.equal(d.conversion_rate, 100);
  assert.equal(d.future_bookings, 2);
  assert.equal(d.forecast_cents, 18000);
  assert.equal(d.bookings_without_value, 1);
  assert.equal(
    f.row(
      "SELECT status FROM follow_ups WHERE conversation_id='" +
        real.conversationId +
        "'",
    ).status,
    'CANCELLED',
  );
  f.sql.close();
});

test('automatic scheduling rechecks per-client limit and newer inbound at insertion time', async () => {
  const f = fixture();
  const result = await f.send('quanto é progressiva?'),
    c = result.conversationId;
  const first = f.row("SELECT id FROM messages WHERE direction='INBOUND'").id;
  f.sql.exec("UPDATE follow_ups SET status='CANCELLED'");
  await f.repository.insertInbound(c, f.input('Outra dúvida'));
  await scheduleCommercialFollowUp(f.db, c, f.getAgent(), first);
  assert.equal(
    f.row("SELECT COUNT(*) n FROM follow_ups WHERE status='SCHEDULED'").n,
    0,
  );
  f.sql.close();
});

test('eligibility is fail-closed for every blocking state and invalid window', () => {
  const base = {
    status: 'PROCESSING',
    control: 'AI_ACTIVE',
    optedOut: false,
    booked: false,
    replied: false,
    channel: 'WHATSAPP',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    approvedTemplate: false,
    templateRequired: false,
  };
  assert.equal(followUpEligibility(base), 'SEND');
  for (const patch of [
    { optedOut: true },
    { booked: true },
    { replied: true },
    { control: 'PROFESSIONAL_HANDOFF' },
    { status: 'CANCELLED' },
  ])
    assert.equal(followUpEligibility({ ...base, ...patch }), 'CANCEL');
  assert.equal(
    followUpEligibility({ ...base, expiresAt: 'invalid' }),
    'TEMPLATE',
  );
});
