import { getRawDb } from '../../../../db/index.ts';
import { requireCrmAuth } from '../../../../lib/auth.ts';
import { createRuntime } from '../../../../lib/runtime.ts';
import type { ChannelName } from '../../../../core/contracts.ts';
import { syncAppointment } from '../../../../db/commercial.ts';

const statuses = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => null)) as {
    status?: string;
  } | null;
  if (!body?.status || !statuses.includes(body.status))
    return Response.json({ error: 'Status inválido' }, { status: 400 });
  const { id } = await context.params;
  const db = getRawDb();
  const appointment = await db
    .prepare(
      `SELECT a.conversation_id, a.service, a.professional, a.start_at, a.status, a.confirmation_message_id,
       a.confirmation_sent_at, c.channel, c.customer_service_window_expires_at, cl.phone_e164
     FROM appointments a JOIN clients cl ON cl.id = a.client_id LEFT JOIN conversations c ON c.id = a.conversation_id WHERE a.id = ?`,
    )
    .bind(id)
    .first<{
      conversation_id: string | null;
      service: string;
      professional: string;
      start_at: string;
      status: string;
      confirmation_message_id: string | null;
      confirmation_sent_at: string | null;
      channel: ChannelName | null;
      customer_service_window_expires_at: string | null;
      phone_e164: string;
    }>();
  if (!appointment)
    return Response.json(
      { error: 'Agendamento não encontrado' },
      { status: 404 },
    );
  const timestamp = new Date().toISOString();
  if (
    ['CANCELLED', 'COMPLETED'].includes(appointment.status) &&
    body.status !== appointment.status
  )
    return Response.json(
      { error: 'Esse agendamento está encerrado. Crie um novo horário.' },
      { status: 409 },
    );
  const result = await db
    .prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?')
    .bind(body.status, timestamp, id)
    .run();
  if ((result.meta.changes ?? 0) !== 1)
    return Response.json(
      { error: 'Agendamento não encontrado' },
      { status: 404 },
    );
  await syncAppointment(db, id);
  let confirmationSent = false;
  let confirmationError: string | null = null;
  if (
    body.status === 'CONFIRMED' &&
    !appointment.confirmation_sent_at &&
    appointment.conversation_id &&
    appointment.channel
  ) {
    let messageId = appointment.confirmation_message_id;
    try {
      const { env, pipeline, repository } = createRuntime();
      const windowOpen =
        env.WHATSAPP_PROVIDER === 'baileys' ||
        appointment.channel !== 'WHATSAPP' ||
        Boolean(
          appointment.customer_service_window_expires_at &&
          Date.parse(appointment.customer_service_window_expires_at) >
            Date.now(),
        );
      if (!windowOpen)
        confirmationError =
          'Horário confirmado, mas a mensagem exige um template aprovado fora da janela oficial.';
      else {
        const when = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(appointment.start_at));
        const text = `Seu horário de ${appointment.service} ficou confirmado para ${when} com ${appointment.professional}. Se precisar ajustar, me avisa.`;
        messageId ??= await repository.createOutbound(
          appointment.conversation_id,
          { senderType: 'HUMAN', body: text, channel: appointment.channel },
        );
        await db
          .prepare(
            'UPDATE appointments SET confirmation_message_id = ?, confirmation_error = NULL, updated_at = ? WHERE id = ?',
          )
          .bind(messageId, timestamp, id)
          .run();
        const existing = await repository.getOutboundMessage?.(messageId);
        const sent =
          existing && ['sent', 'delivered', 'read'].includes(existing.status)
            ? { acceptedAt: timestamp }
            : await pipeline.channels[appointment.channel].sendMessage({
                to: appointment.phone_e164,
                type: 'text',
                text: existing?.body ?? text,
                idempotencyKey: messageId,
              });
        if ('externalId' in sent)
          await repository.markOutboundAccepted(messageId, sent);
        await repository.noteIntegration({
          lastSuccessfulSendAt: sent.acceptedAt,
          lastError: null,
        });
        await db
          .prepare(
            'UPDATE appointments SET confirmation_sent_at = ?, confirmation_error = NULL, updated_at = ? WHERE id = ?',
          )
          .bind(sent.acceptedAt, timestamp, id)
          .run();
        await repository.audit(
          appointment.conversation_id,
          'appointment_confirmed',
          'HUMAN',
          { appointmentId: id },
        );
        confirmationSent = true;
      }
    } catch (error) {
      confirmationError =
        error instanceof Error ? error.message : String(error);
      if (messageId) {
        try {
          const { repository } = createRuntime();
          await repository.markOutboundFailed(messageId, confirmationError);
        } catch {}
      }
    }
    if (confirmationError)
      await db
        .prepare(
          'UPDATE appointments SET confirmation_error = ?, updated_at = ? WHERE id = ?',
        )
        .bind(confirmationError.slice(0, 500), timestamp, id)
        .run();
  } else if (body.status === 'CONFIRMED' && appointment.confirmation_sent_at) {
    confirmationSent = true;
  }
  return Response.json({
    id,
    status: body.status,
    confirmationSent,
    confirmationError,
  });
}
