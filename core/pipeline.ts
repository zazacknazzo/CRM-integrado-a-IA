import type {
  InboundMessageInput,
  PipelineDependencies,
  StoredConversation,
  StoredMessage,
  VerificationResult,
} from './contracts.ts';
import { logEvent } from './logger.ts';
import { normalizePhone } from './phone.ts';
import { commercialStage } from './commercial.ts';

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function acquireConversationLock(
  conversationId: string,
  owner: string,
  deps: PipelineDependencies,
) {
  if (!deps.repository.acquireProcessingLock) return true;
  const deadline = Date.now() + 30_000;
  do {
    if (await deps.repository.acquireProcessingLock(conversationId, owner))
      return true;
    await wait(200);
  } while (Date.now() < deadline);
  return false;
}

export async function processInboundMessage(
  input: InboundMessageInput,
  deps: PipelineDependencies,
) {
  const phoneE164 = normalizePhone(input.fromPhone);
  if (!phoneE164) throw new Error('Invalid customer phone number');

  const conversation = await deps.repository.getOrCreateConversation({
    ...input,
    phoneE164,
  });
  const insert = await deps.repository.insertInbound(conversation.id, input);
  if (!insert.inserted) {
    await deps.repository.audit(
      conversation.id,
      'duplicate_webhook_ignored',
      'SYSTEM',
      { externalId: input.externalId },
    );
    logEvent('duplicate_webhook_ignored', { conversationId: conversation.id });
    const recovered = await processPendingConversation(conversation.id, deps);
    return recovered.status === 'NO_PENDING'
      ? ({ status: 'DUPLICATE', conversationId: conversation.id } as const)
      : recovered;
  }

  logEvent('inbound_message_persisted', {
    conversationId: conversation.id,
    channel: input.channel,
    type: input.type,
  });
  if (deps.debounceMs > 0) await wait(deps.debounceMs);

  return processPendingConversation(conversation.id, deps);
}

function retryDelay(attempt: number) {
  return Math.min(5 * 60_000, 5_000 * 3 ** Math.max(0, attempt - 1));
}

export async function processPendingConversation(
  conversationId: string,
  deps: PipelineDependencies,
) {
  const lockOwner = crypto.randomUUID();
  const lockAcquired = await acquireConversationLock(
    conversationId,
    lockOwner,
    deps,
  );
  if (!lockAcquired) {
    await deps.repository.audit(
      conversationId,
      'processing_coalesced_by_conversation_lock',
      'SYSTEM',
    );
    return { status: 'PROCESSING_BY_ANOTHER_MESSAGE', conversationId } as const;
  }

  let pending: StoredMessage[] = [];
  try {
    const freshConversation =
      await deps.repository.getConversation(conversationId);
    pending = await deps.repository.listPendingInbound(conversationId);
    if (pending.length === 0) {
      await deps.repository.audit(
        conversationId,
        'processing_coalesced_after_lock',
        'SYSTEM',
      );
      return { status: 'NO_PENDING', conversationId } as const;
    }
    const pendingIds = pending.map((message) => message.id);
    const combinedText = pending
      .map((message) => message.body ?? '')
      .join(' ')
      .toLocaleLowerCase('pt-BR');
    if (
      /\b(parar|pare|remover|cancelar mensagens|não quero receber|nao quero receber|sair da lista)\b/.test(
        combinedText,
      )
    ) {
      await deps.repository.setPromotionalOptOut?.(conversationId);
      await deps.repository.audit(
        conversationId,
        'promotional_opt_out_recorded',
        'CUSTOMER',
      );
    }

    if (freshConversation.controlState !== 'AI_ACTIVE') {
      await deps.repository.markProcessed(pendingIds);
      await deps.repository.audit(
        conversationId,
        'automatic_reply_skipped_control_state',
        'SYSTEM',
        { controlState: freshConversation.controlState },
      );
      return { status: 'CONTROLLED_BY_HUMAN', conversationId } as const;
    }

    const recentMessages =
      (await deps.repository.listRecentMessages?.(conversationId)) ?? pending;
    return await runAutomatedResponse({
      conversation: freshConversation,
      gateMessages: pending,
      recentMessages,
      triggerMessageId: pending.at(-1)?.id,
      processedMessageIds: pendingIds,
      deps,
    });
  } catch (error) {
    if (!pending.length || !deps.repository.deferPendingInbound) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    const nextAttempt =
      Math.max(...pending.map((message) => message.processingAttempts ?? 0)) +
      1;
    await deps.repository.noteIntegration({ lastError: reason });
    if (nextAttempt >= 4) {
      const handoffReason =
        'A automação falhou repetidamente. A equipe precisa responder esta conversa.';
      await deps.repository.setControlState(
        conversationId,
        'HUMAN_CONTROL',
        handoffReason,
      );
      await deps.repository.createHandoff(
        conversationId,
        pending.at(-1)?.id,
        handoffReason,
      );
      await deps.repository.markProcessed(pending.map((message) => message.id));
      await deps.repository.audit(
        conversationId,
        'automatic_processing_escalated',
        'SYSTEM',
        { attempts: nextAttempt, reason },
      );
      return { status: 'HUMAN_ATTENTION_REQUIRED', conversationId } as const;
    }
    const retryAt = new Date(
      Date.now() + retryDelay(nextAttempt),
    ).toISOString();
    await deps.repository.deferPendingInbound(
      pending.map((message) => message.id),
      reason,
      retryAt,
    );
    await deps.repository.audit(
      conversationId,
      'automatic_processing_retry_scheduled',
      'SYSTEM',
      { attempt: nextAttempt, retryAt, reason },
    );
    return { status: 'RETRY_SCHEDULED', conversationId } as const;
  } finally {
    await deps.repository.releaseProcessingLock?.(conversationId, lockOwner);
  }
}

export async function resumeAiConversation(
  conversationId: string,
  deps: PipelineDependencies,
) {
  const conversation = await deps.repository.getConversation(conversationId);
  if (conversation.controlState !== 'AI_ACTIVE') {
    return { status: 'CONTROLLED_BY_HUMAN', conversationId } as const;
  }

  const recentMessages =
    (await deps.repository.listRecentMessages?.(conversationId)) ?? [];
  const lastMessage = recentMessages.at(-1);
  if (!lastMessage || lastMessage.direction !== 'INBOUND') {
    return { status: 'NO_REPLY_NEEDED', conversationId } as const;
  }

  const claimed =
    (await deps.repository.claimInboundForResume?.(lastMessage.id)) ?? true;
  if (!claimed)
    return { status: 'ALREADY_PROCESSING', conversationId } as const;

  await deps.repository.audit(conversationId, 'ai_resume_started', 'HUMAN', {
    triggerMessageId: lastMessage.id,
  });
  try {
    return await runAutomatedResponse({
      conversation,
      gateMessages: [lastMessage],
      recentMessages,
      triggerMessageId: lastMessage.id,
      processedMessageIds: [lastMessage.id],
      deps,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (deps.repository.deferPendingInbound) {
      await deps.repository.deferPendingInbound(
        [lastMessage.id],
        reason,
        new Date(
          Date.now() + retryDelay((lastMessage.processingAttempts ?? 0) + 1),
        ).toISOString(),
      );
    } else {
      await deps.repository.markProcessed([lastMessage.id]);
    }
    await deps.repository.audit(conversationId, 'ai_resume_failed', 'SYSTEM', {
      reason,
    });
    throw error;
  }
}

async function runAutomatedResponse(input: {
  conversation: StoredConversation;
  gateMessages: StoredMessage[];
  recentMessages: StoredMessage[];
  triggerMessageId?: string;
  processedMessageIds: string[];
  deps: PipelineDependencies;
}) {
  const {
    conversation,
    gateMessages,
    recentMessages,
    triggerMessageId,
    processedMessageIds,
    deps,
  } = input;
  if (triggerMessageId && deps.repository.getOutboundByReplyTo) {
    const existing =
      await deps.repository.getOutboundByReplyTo(triggerMessageId);
    if (existing) {
      if (['sent', 'delivered', 'read'].includes(existing.status)) {
        await deps.repository.recoverCommercialReply?.(
          conversation.id,
          triggerMessageId,
        );
        await deps.repository.markProcessed(processedMessageIds);
        return { status: 'SENT', conversationId: conversation.id } as const;
      }
      const dispatch = await dispatchAiReply(
        conversation.id,
        existing.body,
        deps,
        triggerMessageId,
      );
      if (dispatch.status === 'SENT')
        await deps.repository.recoverCommercialReply?.(
          conversation.id,
          triggerMessageId,
        );
      await deps.repository.markProcessed(processedMessageIds);
      return {
        status: dispatch.status,
        conversationId: conversation.id,
      } as const;
    }
  }
  const gate = await deps.professionalGate.evaluate({
    messages: gateMessages,
    knowledge: deps.knowledge,
  });
  await deps.repository.audit(
    conversation.id,
    'professional_gate_executed',
    'AI',
    { decision: gate.decision, confidence: gate.confidence },
  );

  if (gate.decision === 'PROFESSIONAL_HANDOFF') {
    await deps.repository.setControlState(
      conversation.id,
      'PROFESSIONAL_HANDOFF',
      gate.reason,
    );
    await deps.repository.createHandoff(
      conversation.id,
      triggerMessageId,
      gate.reason,
    );
    await deps.repository.updateOpportunity(conversation.id, {
      interest: null,
      stage: 'PROFESSIONAL_REVIEW',
      summary: gate.crmSummary,
    });
    await deps.repository.markProcessed(processedMessageIds);
    await deps.repository.audit(conversation.id, 'professional_handoff', 'AI', {
      reason: gate.reason,
    });
    logEvent('professional_handoff', { conversationId: conversation.id });
    return {
      status: 'PROFESSIONAL_HANDOFF',
      conversationId: conversation.id,
    } as const;
  }

  const context =
    (await deps.repository.customerContext?.(conversation.id)) ?? '';
  let agent = triggerMessageId
    ? await deps.repository.resolveBooking?.(
        conversation.id,
        recentMessages,
        triggerMessageId,
      )
    : null;
  const scheduledReply = Boolean(agent);
  agent ??= await deps.commercialAgent.respond({
    messages: recentMessages,
    knowledge: deps.knowledge + '\n\n' + context,
  });
  if (triggerMessageId && !scheduledReply)
    agent =
      (await deps.repository.resolveBooking?.(
        conversation.id,
        recentMessages,
        triggerMessageId,
        agent,
      )) ?? agent;
  await deps.repository.audit(
    conversation.id,
    'commercial_agent_executed',
    'AI',
    {
      intent: agent.intent,
      temperature: agent.temperature,
      objection: agent.objection,
      nextBestAction: agent.nextBestAction,
      requiresFollowUp: agent.requiresFollowUp,
    },
  );
  const verifier: VerificationResult = await deps.responseVerifier.verify({
    messages: recentMessages,
    proposedReply: agent.reply,
    knowledge: deps.knowledge,
  });
  await deps.repository.audit(
    conversation.id,
    'response_verifier_executed',
    'AI',
    { allowed: verifier.allowed, reason: verifier.reason },
  );

  if (!verifier.allowed || !verifier.finalReply.trim()) {
    await deps.repository.setControlState(
      conversation.id,
      'HUMAN_CONTROL',
      verifier.reason,
    );
    await deps.repository.createHandoff(
      conversation.id,
      triggerMessageId,
      verifier.reason,
    );
    await deps.repository.markProcessed(processedMessageIds);
    return {
      status: 'VERIFIER_HANDOFF',
      conversationId: conversation.id,
    } as const;
  }

  await deps.repository.updateOpportunity(conversation.id, {
    interest: agent.interest,
    stage: commercialStage(agent),
    summary: agent.crmSummary,
    nextBestAction: agent.nextBestAction,
    objection: agent.objection,
    intent: agent.intent,
  });
  if (agent.requiresFollowUp) {
    await deps.repository.audit(
      conversation.id,
      'commercial_follow_up_requested',
      'AI',
      {
        interest: agent.interest,
        reason: agent.objection ?? 'CUSTOMER_REQUESTED_TIME',
      },
    );
  }
  if (triggerMessageId)
    await deps.repository.prepareCommercialReply?.(
      conversation.id,
      agent,
      triggerMessageId,
    );
  const dispatch = await dispatchAiReply(
    conversation.id,
    verifier.finalReply,
    deps,
    triggerMessageId,
  );
  if (dispatch.status === 'SENT' && triggerMessageId)
    await deps.repository.commercialReplySent?.(
      conversation.id,
      agent,
      triggerMessageId,
    );
  if (
    dispatch.status === 'SENT' &&
    agent.nextBestAction === 'REQUEST_HUMAN_CONFIRMATION'
  ) {
    await deps.repository.audit(
      conversation.id,
      'administrative_confirmation_requested',
      'AI',
      { nextBestAction: agent.nextBestAction },
    );
  }
  await deps.repository.markProcessed(processedMessageIds);
  return { status: dispatch.status, conversationId: conversation.id } as const;
}

export async function dispatchAiReply(
  conversationId: string,
  body: string,
  deps: PipelineDependencies,
  replyToMessageId?: string,
) {
  const conversation = await deps.repository.getConversation(conversationId);
  if (conversation.controlState !== 'AI_ACTIVE') {
    const event =
      conversation.controlState === 'HUMAN_CONTROL'
        ? 'reply_blocked_due_to_human_takeover'
        : 'message_blocked_professional_handoff';
    await deps.repository.audit(conversationId, event, 'SYSTEM', {
      controlState: conversation.controlState,
    });
    logEvent(event, { conversationId });
    return { status: 'BLOCKED' as const };
  }

  if (deps.channels[conversation.channel].enforcesCustomerServiceWindow) {
    const expiresAt = conversation.customerServiceWindowExpiresAt
      ? Date.parse(conversation.customerServiceWindowExpiresAt)
      : 0;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await deps.repository.audit(
        conversationId,
        'customer_service_window_expired',
        'SYSTEM',
      );
      return { status: 'TEMPLATE_REQUIRED' as const };
    }
  }

  const existing = replyToMessageId
    ? await deps.repository.getOutboundByReplyTo?.(replyToMessageId)
    : null;
  if (existing && ['sent', 'delivered', 'read'].includes(existing.status))
    return { status: 'SENT' as const, messageId: existing.id };
  const messageId =
    existing?.id ??
    (await deps.repository.createOutbound(conversationId, {
      senderType: 'AI',
      body,
      channel: conversation.channel,
      replyToMessageId,
    }));
  const outboundBody = existing?.body ?? body;
  let accepted = false;
  try {
    const result = await deps.channels[conversation.channel].sendMessage({
      to: conversation.phoneE164,
      type: 'text',
      text: outboundBody,
      idempotencyKey: messageId,
    });
    accepted = true;
    await deps.repository.markOutboundAccepted(messageId, result);
    await deps.repository.noteIntegration({
      lastSuccessfulSendAt: result.acceptedAt,
    });
    await deps.repository.audit(
      conversationId,
      'message_dispatch_accepted',
      'AI',
      { channel: conversation.channel },
    );
    return { status: 'SENT' as const, messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (accepted) {
      const persisted = await deps.repository.getOutboundMessage?.(messageId);
      if (persisted && ['sent', 'delivered', 'read'].includes(persisted.status))
        return { status: 'SENT' as const, messageId };
      const detail =
        'Envio aceito pelo canal, mas confirmação local falhou. Conferir no WhatsApp antes de reenviar.';
      await deps.repository.setControlState(
        conversationId,
        'HUMAN_CONTROL',
        detail,
      );
      await deps.repository.createHandoff(
        conversationId,
        replyToMessageId,
        detail,
      );
      await deps.repository.audit(
        conversationId,
        'delivery_reconciliation_required',
        'SYSTEM',
        { messageId },
      );
      return { status: 'BLOCKED' as const, messageId };
    }
    await deps.repository.markOutboundFailed(messageId, reason);
    await deps.repository.noteIntegration({ lastError: reason });
    throw error;
  }
}
