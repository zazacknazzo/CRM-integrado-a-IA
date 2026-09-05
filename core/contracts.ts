export type ChannelName = 'SIMULATOR' | 'WHATSAPP';
export type ControlState =
  | 'AI_ACTIVE'
  | 'HUMAN_CONTROL'
  | 'PROFESSIONAL_HANDOFF';
export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'document'
  | 'location'
  | 'interactive'
  | 'unknown';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface SendMessageInput {
  to: string;
  type: 'text' | 'template';
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  idempotencyKey: string;
}

export interface SendMessageResult {
  externalId: string;
  status: MessageStatus;
  acceptedAt: string;
}

export interface MessageChannel {
  readonly name: ChannelName;
  readonly enforcesCustomerServiceWindow?: boolean;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}

export interface InboundMessageInput {
  externalId: string;
  channel: ChannelName;
  fromPhone: string;
  profileName?: string;
  type: MessageType;
  text?: string;
  mediaId?: string;
  latitude?: number;
  longitude?: number;
  interactivePayload?: Record<string, unknown>;
  referral?: Record<string, unknown>;
  timestamp: string;
}

export interface StoredConversation {
  id: string;
  clientId: string;
  channel: ChannelName;
  phoneE164: string;
  controlState: ControlState;
  customerServiceWindowExpiresAt: string | null;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  externalId: string | null;
  channel: ChannelName;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'AI' | 'HUMAN';
  messageType: MessageType | 'template';
  body: string | null;
  mediaId: string | null;
  status: MessageStatus;
  processingState: 'RECEIVED' | 'PROCESSING' | 'PROCESSED';
  processingAttempts?: number;
  createdAt: string;
}

export interface StoredOutboundMessage {
  id: string;
  body: string;
  status: MessageStatus;
}

export interface GateResult {
  decision: 'ALLOW_COMMERCIAL' | 'PROFESSIONAL_HANDOFF';
  reason: string;
  confidence: number;
  crmSummary: string;
}

export interface AgentResult {
  reply: string;
  interest: string | null;
  opportunityStage: string;
  crmSummary: string;
  intent: string;
  temperature: 'COLD' | 'WARM' | 'HOT' | 'VERY_HOT';
  objection: string | null;
  nextBestAction:
    | 'ANSWER_QUESTION'
    | 'QUALIFY'
    | 'HANDLE_OBJECTION'
    | 'OFFER_PERIOD'
    | 'OFFER_TIME'
    | 'CONFIRM_BOOKING'
    | 'CREATE_FOLLOW_UP'
    | 'REQUEST_HUMAN_CONFIRMATION';
  requiresFollowUp: boolean;
}

export interface VerificationResult {
  allowed: boolean;
  reason: string;
  finalReply: string;
}

export interface ProfessionalGate {
  evaluate(input: {
    messages: StoredMessage[];
    knowledge: string;
  }): Promise<GateResult>;
}

export interface CommercialAgent {
  respond(input: {
    messages: StoredMessage[];
    knowledge: string;
  }): Promise<AgentResult>;
}

export interface ResponseVerifier {
  verify(input: {
    messages: StoredMessage[];
    proposedReply: string;
    knowledge: string;
  }): Promise<VerificationResult>;
}

export interface ConversationRepository {
  getOrCreateConversation(
    input: InboundMessageInput & { phoneE164: string },
  ): Promise<StoredConversation>;
  insertInbound(
    conversationId: string,
    input: InboundMessageInput,
  ): Promise<{ inserted: boolean; messageId?: string }>;
  listPendingInbound(conversationId: string): Promise<StoredMessage[]>;
  listRecentMessages?(conversationId: string): Promise<StoredMessage[]>;
  listRecoverableConversationIds?(limit?: number): Promise<string[]>;
  acquireProcessingLock?(
    conversationId: string,
    owner: string,
  ): Promise<boolean>;
  releaseProcessingLock?(conversationId: string, owner: string): Promise<void>;
  claimInboundForResume?(messageId: string): Promise<boolean>;
  deferPendingInbound?(
    messageIds: string[],
    reason: string,
    retryAt: string,
  ): Promise<void>;
  markProcessed(messageIds: string[]): Promise<void>;
  getConversation(conversationId: string): Promise<StoredConversation>;
  setControlState(
    conversationId: string,
    state: ControlState,
    reason?: string,
  ): Promise<void>;
  createHandoff(
    conversationId: string,
    triggerMessageId: string | undefined,
    reason: string,
  ): Promise<void>;
  updateOpportunity(
    conversationId: string,
    input: {
      interest: string | null;
      stage: string;
      summary: string;
      nextBestAction?: string;
      objection?: string | null;
      intent?: string;
    },
  ): Promise<void>;
  customerContext?(conversationId: string): Promise<string>;
  prepareCommercialReply?(
    conversationId: string,
    agent: AgentResult,
    triggerId: string,
  ): Promise<void>;
  recoverCommercialReply?(
    conversationId: string,
    triggerId: string,
  ): Promise<void>;
  commercialReplySent?(
    conversationId: string,
    agent: AgentResult,
    triggerId: string,
  ): Promise<void>;
  resolveBooking?(
    conversationId: string,
    messages: StoredMessage[],
    triggerId: string,
    agent?: AgentResult,
  ): Promise<AgentResult | null>;
  createOutbound(
    conversationId: string,
    input: {
      senderType: 'AI' | 'HUMAN';
      body: string;
      channel: ChannelName;
      replyToMessageId?: string;
    },
  ): Promise<string>;
  getOutboundByReplyTo?(
    replyToMessageId: string,
  ): Promise<StoredOutboundMessage | null>;
  getOutboundMessage?(messageId: string): Promise<StoredOutboundMessage | null>;
  markOutboundAccepted(
    messageId: string,
    result: SendMessageResult,
  ): Promise<void>;
  markOutboundFailed(messageId: string, reason: string): Promise<void>;
  updateExternalMessageStatus(
    externalId: string,
    status: MessageStatus,
    at: string,
    reason?: string,
  ): Promise<boolean>;
  audit(
    conversationId: string | null,
    eventType: string,
    actorType: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  noteIntegration(input: {
    lastWebhookAt?: string;
    lastError?: string | null;
    lastSuccessfulSendAt?: string;
  }): Promise<void>;
  setPromotionalOptOut?(conversationId: string): Promise<void>;
}

export interface PipelineDependencies {
  repository: ConversationRepository;
  channels: Record<ChannelName, MessageChannel>;
  professionalGate: ProfessionalGate;
  commercialAgent: CommercialAgent;
  responseVerifier: ResponseVerifier;
  knowledge: string;
  debounceMs: number;
}
