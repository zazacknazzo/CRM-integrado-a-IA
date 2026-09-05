import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ChannelName,
  ControlState,
  ConversationRepository,
  InboundMessageInput,
  MessageChannel,
  MessageStatus,
  SendMessageInput,
  SendMessageResult,
  StoredConversation,
  StoredMessage,
} from '../core/contracts.ts';
import {
  dispatchAiReply,
  processInboundMessage,
  resumeAiConversation,
} from '../core/pipeline.ts';

class FakeChannel implements MessageChannel {
  readonly name: ChannelName = 'SIMULATOR';
  sent: SendMessageInput[] = [];
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    this.sent.push(input);
    return {
      externalId: 'sim-out-1',
      status: 'sent',
      acceptedAt: new Date().toISOString(),
    };
  }
}

class FakeRepository implements ConversationRepository {
  state: ControlState = 'AI_ACTIVE';
  inserted = true;
  pending: StoredMessage[] = [
    {
      id: 'm1',
      conversationId: 'c1',
      externalId: 'in1',
      channel: 'SIMULATOR',
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      messageType: 'text',
      body: 'Meu cabelo está quebrando depois da química',
      mediaId: null,
      status: 'delivered',
      processingState: 'RECEIVED',
      createdAt: new Date().toISOString(),
    },
  ];
  audits: string[] = [];
  handoffs = 0;
  processed = 0;
  outbound = 0;
  deferred = 0;
  claimedResumeMessages = new Set<string>();
  opportunityStage = '';
  acquireProcessingLock: NonNullable<
    ConversationRepository['acquireProcessingLock']
  > = async () => true;
  releaseProcessingLock: NonNullable<
    ConversationRepository['releaseProcessingLock']
  > = async () => {};
  async getOrCreateConversation(
    _input: InboundMessageInput & { phoneE164: string },
  ) {
    return this.conversation();
  }
  async insertInbound() {
    return {
      inserted: this.inserted,
      messageId: this.inserted ? 'm1' : undefined,
    };
  }
  async listPendingInbound() {
    return this.pending;
  }
  async listRecentMessages() {
    return this.pending;
  }
  async claimInboundForResume(messageId: string) {
    if (this.claimedResumeMessages.has(messageId)) return false;
    this.claimedResumeMessages.add(messageId);
    return true;
  }
  async markProcessed(ids: string[]) {
    this.processed += ids.length;
  }
  async deferPendingInbound(ids: string[]) {
    this.deferred += ids.length;
  }
  async getConversation() {
    return this.conversation();
  }
  async setControlState(_id: string, state: ControlState) {
    this.state = state;
  }
  async createHandoff() {
    this.handoffs += 1;
  }
  async updateOpportunity(
    _id: string,
    input: { interest: string | null; stage: string; summary: string },
  ) {
    this.opportunityStage = input.stage;
  }
  async createOutbound() {
    this.outbound += 1;
    return 'out1';
  }
  async markOutboundAccepted() {}
  async markOutboundFailed() {}
  async updateExternalMessageStatus(_id: string, _status: MessageStatus) {
    return true;
  }
  async audit(_id: string | null, event: string) {
    this.audits.push(event);
  }
  async noteIntegration() {}
  async setPromotionalOptOut() {}
  private conversation(): StoredConversation {
    return {
      id: 'c1',
      clientId: 'client1',
      channel: 'SIMULATOR',
      phoneE164: '+5511999999999',
      controlState: this.state,
      customerServiceWindowExpiresAt: new Date(
        Date.now() + 86_400_000,
      ).toISOString(),
    };
  }
}

const allowedAgent = {
  professionalGate: {
    async evaluate() {
      return {
        decision: 'ALLOW_COMMERCIAL' as const,
        reason: 'commercial',
        confidence: 1,
        crmSummary: 'lead',
      };
    },
  },
  commercialAgent: {
    async respond() {
      return {
        reply: 'Posso ajudar.',
        interest: 'Progressiva',
        opportunityStage: 'QUALIFICATION',
        crmSummary: 'lead',
        intent: 'CONSULTAR_SERVICO',
        temperature: 'WARM' as const,
        objection: null,
        nextBestAction: 'QUALIFY' as const,
        requiresFollowUp: false,
      };
    },
  },
  responseVerifier: {
    async verify() {
      return { allowed: true, reason: 'ok', finalReply: 'Posso ajudar.' };
    },
  },
};

test('professional handoff persists and sends literally zero messages', async () => {
  const repository = new FakeRepository();
  const channel = new FakeChannel();
  const result = await processInboundMessage(
    {
      externalId: 'in1',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'quebra após química',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: {
        async evaluate() {
          return {
            decision: 'PROFESSIONAL_HANDOFF',
            reason: 'possible damage',
            confidence: 1,
            crmSummary: 'review',
          };
        },
      },
      commercialAgent: allowedAgent.commercialAgent,
      responseVerifier: allowedAgent.responseVerifier,
    },
  );
  assert.equal(result.status, 'PROFESSIONAL_HANDOFF');
  assert.equal(repository.state, 'PROFESSIONAL_HANDOFF');
  assert.equal(repository.handoffs, 1);
  assert.equal(repository.outbound, 0);
  assert.equal(channel.sent.length, 0);
});

test('duplicate inbound event without pending work does not call agents or dispatch', async () => {
  const repository = new FakeRepository();
  repository.inserted = false;
  repository.pending = [];
  const channel = new FakeChannel();
  let gateCalls = 0;
  const result = await processInboundMessage(
    {
      externalId: 'same',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'oi',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: {
        async evaluate() {
          gateCalls += 1;
          return allowedAgent.professionalGate.evaluate();
        },
      },
      commercialAgent: allowedAgent.commercialAgent,
      responseVerifier: allowedAgent.responseVerifier,
    },
  );
  assert.equal(result.status, 'DUPLICATE');
  assert.equal(gateCalls, 0);
  assert.equal(channel.sent.length, 0);
});

test('dispatch re-reads database state and blocks takeover race', async () => {
  const repository = new FakeRepository();
  repository.state = 'HUMAN_CONTROL';
  const channel = new FakeChannel();
  const result = await dispatchAiReply('c1', 'Resposta tardia', {
    repository,
    channels: { SIMULATOR: channel, WHATSAPP: channel },
    debounceMs: 0,
    knowledge: '',
    ...allowedAgent,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(repository.outbound, 0);
  assert.equal(channel.sent.length, 0);
  assert.ok(repository.audits.includes('reply_blocked_due_to_human_takeover'));
});

test('consecutive pending messages are evaluated as one batch', async () => {
  const repository = new FakeRepository();
  repository.pending = [
    { ...repository.pending[0], id: 'm1', body: 'Queria fazer progressiva.' },
    {
      ...repository.pending[0],
      id: 'm2',
      externalId: 'in2',
      body: 'Meu cabelo está quebrando depois da química.',
    },
  ];
  const channel = new FakeChannel();
  let observed = 0;
  await processInboundMessage(
    {
      externalId: 'in1',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'progressiva',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: {
        async evaluate(input) {
          observed = input.messages.length;
          return {
            decision: 'PROFESSIONAL_HANDOFF',
            reason: 'damage',
            confidence: 1,
            crmSummary: 'review',
          };
        },
      },
      commercialAgent: allowedAgent.commercialAgent,
      responseVerifier: allowedAgent.responseVerifier,
    },
  );
  assert.equal(observed, 2);
  assert.equal(channel.sent.length, 0);
});

test('a simultaneous request waits for the conversation lock and does not call the agent twice', async () => {
  const repository = new FakeRepository();
  let lockAttempts = 0;
  repository.acquireProcessingLock = async () => {
    lockAttempts += 1;
    if (lockAttempts === 1) return false;
    repository.pending = [];
    return true;
  };
  repository.releaseProcessingLock = async () => {};
  const channel = new FakeChannel();
  let gateCalls = 0;
  const result = await processInboundMessage(
    {
      externalId: 'in2',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'oiii',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: {
        async evaluate() {
          gateCalls += 1;
          return allowedAgent.professionalGate.evaluate();
        },
      },
      commercialAgent: allowedAgent.commercialAgent,
      responseVerifier: allowedAgent.responseVerifier,
    },
  );
  assert.equal(result.status, 'NO_PENDING');
  assert.equal(lockAttempts, 2);
  assert.equal(gateCalls, 0);
  assert.equal(channel.sent.length, 0);
});

test('records follow-up intent as a parallel action without changing the commercial stage', async () => {
  const repository = new FakeRepository();
  repository.pending = [
    { ...repository.pending[0], body: 'Vou pensar e depois te aviso' },
  ];
  const channel = new FakeChannel();
  await processInboundMessage(
    {
      externalId: 'in1',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'vou pensar',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: allowedAgent.professionalGate,
      commercialAgent: {
        async respond() {
          return {
            reply:
              'Sem problema. Se quiser, posso retomar esse atendimento com você depois.',
            interest: 'Progressiva',
            opportunityStage: 'FOLLOW_UP',
            crmSummary: 'retorno',
            intent: 'ADIAR_DECISAO',
            temperature: 'WARM' as const,
            objection: 'NEEDS_TIME',
            nextBestAction: 'CREATE_FOLLOW_UP' as const,
            requiresFollowUp: true,
          };
        },
      },
      responseVerifier: {
        async verify(input) {
          return {
            allowed: true,
            reason: 'ok',
            finalReply: input.proposedReply,
          };
        },
      },
    },
  );
  assert.equal(repository.opportunityStage, 'QUALIFIED');
  assert.ok(repository.audits.includes('commercial_follow_up_requested'));
  assert.equal(channel.sent.length, 1);
});

test('unknown administrative information replies once without disabling the AI', async () => {
  const repository = new FakeRepository();
  repository.pending = [
    { ...repository.pending[0], body: 'Quanto custa progressiva?' },
  ];
  const channel = new FakeChannel();
  const result = await processInboundMessage(
    {
      externalId: 'in1',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'Quanto custa progressiva?',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: allowedAgent.professionalGate,
      commercialAgent: {
        async respond() {
          return {
            reply: 'Vou confirmar o valor para você.',
            interest: 'Progressiva',
            opportunityStage: 'HUMAN_CONFIRMATION',
            crmSummary: 'confirmar valor',
            intent: 'CONSULTAR_PRECO',
            temperature: 'HOT' as const,
            objection: null,
            nextBestAction: 'REQUEST_HUMAN_CONFIRMATION' as const,
            requiresFollowUp: false,
          };
        },
      },
      responseVerifier: {
        async verify(input) {
          return {
            allowed: true,
            reason: 'ok',
            finalReply: input.proposedReply,
          };
        },
      },
    },
  );
  assert.equal(result.status, 'SENT');
  assert.equal(channel.sent.length, 1);
  assert.equal(repository.state, 'AI_ACTIVE');
  assert.equal(repository.handoffs, 0);
  assert.ok(
    repository.audits.includes('administrative_confirmation_requested'),
  );
});

test('returning control to AI replies to the latest unanswered inbound message', async () => {
  const repository = new FakeRepository();
  repository.pending = [
    {
      ...repository.pending[0],
      body: 'Quero saber sobre progressiva',
      processingState: 'PROCESSED',
    },
  ];
  const channel = new FakeChannel();
  const result = await resumeAiConversation('c1', {
    repository,
    channels: { SIMULATOR: channel, WHATSAPP: channel },
    debounceMs: 0,
    knowledge: '',
    ...allowedAgent,
  });
  assert.equal(result.status, 'SENT');
  assert.equal(channel.sent.length, 1);
  assert.ok(repository.audits.includes('ai_resume_started'));
});

test('repeated AI takeover does not reply twice to the same inbound message', async () => {
  const repository = new FakeRepository();
  repository.pending = [
    {
      ...repository.pending[0],
      body: 'Quero saber sobre progressiva',
      processingState: 'PROCESSED',
    },
  ];
  const channel = new FakeChannel();
  const dependencies = {
    repository,
    channels: { SIMULATOR: channel, WHATSAPP: channel },
    debounceMs: 0,
    knowledge: '',
    ...allowedAgent,
  };
  await resumeAiConversation('c1', dependencies);
  const second = await resumeAiConversation('c1', dependencies);
  assert.equal(second.status, 'ALREADY_PROCESSING');
  assert.equal(channel.sent.length, 1);
});

test('transient agent failure keeps the inbound message for automatic retry', async () => {
  const repository = new FakeRepository();
  const channel = new FakeChannel();
  const result = await processInboundMessage(
    {
      externalId: 'in1',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'oi',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: {
        async evaluate() {
          throw new Error('temporary model failure');
        },
      },
      commercialAgent: allowedAgent.commercialAgent,
      responseVerifier: allowedAgent.responseVerifier,
    },
  );
  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.equal(repository.deferred, 1);
  assert.equal(repository.processed, 0);
  assert.equal(channel.sent.length, 0);
});

test('fourth processing failure pauses automation for human attention', async () => {
  const repository = new FakeRepository();
  repository.pending = [{ ...repository.pending[0], processingAttempts: 3 }];
  const channel = new FakeChannel();
  const result = await processInboundMessage(
    {
      externalId: 'in1',
      channel: 'SIMULATOR',
      fromPhone: '11999999999',
      type: 'text',
      text: 'oi',
      timestamp: new Date().toISOString(),
    },
    {
      repository,
      channels: { SIMULATOR: channel, WHATSAPP: channel },
      debounceMs: 0,
      knowledge: '',
      professionalGate: {
        async evaluate() {
          throw new Error('persistent model failure');
        },
      },
      commercialAgent: allowedAgent.commercialAgent,
      responseVerifier: allowedAgent.responseVerifier,
    },
  );
  assert.equal(result.status, 'HUMAN_ATTENTION_REQUIRED');
  assert.equal(repository.state, 'HUMAN_CONTROL');
  assert.equal(repository.handoffs, 1);
  assert.equal(repository.processed, 1);
});
