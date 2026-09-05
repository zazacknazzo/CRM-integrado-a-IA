import type { MessageChannel, SendMessageInput, SendMessageResult } from '../core/contracts.ts';

export class SimulatorChannel implements MessageChannel {
  readonly name = 'SIMULATOR' as const;
  readonly sent: SendMessageInput[] = [];

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    this.sent.push(input);
    return { externalId: `sim_${crypto.randomUUID()}`, status: 'sent', acceptedAt: new Date().toISOString() };
  }
}
