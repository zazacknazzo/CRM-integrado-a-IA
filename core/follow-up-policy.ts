export function followUpEligibility(
  input: {
    status: string;
    control: string;
    optedOut: boolean;
    booked: boolean;
    replied: boolean;
    channel: string;
    expiresAt: string | null;
    approvedTemplate: boolean;
    templateRequired: boolean;
  },
  now = Date.now(),
) {
  if (
    input.status !== 'PROCESSING' ||
    input.control !== 'AI_ACTIVE' ||
    input.optedOut ||
    input.booked ||
    input.replied
  )
    return 'CANCEL';
  if (input.templateRequired && !input.approvedTemplate) return 'TEMPLATE';
  if (
    input.channel === 'WHATSAPP' &&
    !(Date.parse(input.expiresAt ?? '') > now) &&
    !input.approvedTemplate
  )
    return 'TEMPLATE';
  if (
    input.channel === 'WHATSAPP' &&
    !input.expiresAt &&
    !input.approvedTemplate
  )
    return 'TEMPLATE';
  return 'SEND';
}
