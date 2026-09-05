import { getRawDb } from '../../../../../db/index.ts';
import { requireCrmAuth } from '../../../../../lib/auth.ts';
import {
  cancelFollowUps,
  commercialEvent,
} from '../../../../../db/commercial.ts';
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => null)) as {
    stage?: string;
    reason?: string;
    nextBestAction?: string;
  } | null;
  const { id } = await context.params;
  if (body?.stage !== 'LOST' || !body.reason?.trim())
    return Response.json(
      { error: 'Informe o motivo da perda.' },
      { status: 400 },
    );
  const db = getRawDb();
  const updated = await db
    .prepare(
      `UPDATE opportunities SET stage = 'LOST', next_best_action = 'CLOSE', lost_reason = ?, updated_at = ? WHERE conversation_id = ? AND stage NOT IN ('BOOKED','ATTENDED')`,
    )
    .bind(body.reason.trim().slice(0, 500), new Date().toISOString(), id)
    .run();
  if (!updated.meta.changes)
    return Response.json(
      { error: 'Oportunidade indisponível ou já agendada.' },
      { status: 409 },
    );
  await cancelFollowUps(db, id, 'Oportunidade encerrada');
  await commercialEvent(
    db,
    id,
    'lead_lost',
    id,
    { reason: body.reason.trim() },
    'HUMAN',
  );
  return Response.json({ ok: true });
}
