import { getRawDb } from '../../../../db/index.ts';
import { requireCrmAuth } from '../../../../lib/auth.ts';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => null)) as {
    status?: string;
  } | null;
  if (body?.status !== 'CANCELLED')
    return Response.json(
      { error: 'Somente o cancelamento manual é permitido' },
      { status: 400 },
    );
  const { id } = await context.params;
  const result = await getRawDb()
    .prepare(
      "UPDATE follow_ups SET status = 'CANCELLED', locked_at = NULL, updated_at = ? WHERE id = ? AND status IN ('SCHEDULED', 'WAITING_FOR_TEMPLATE', 'PROCESSING')",
    )
    .bind(new Date().toISOString(), id)
    .run();
  if ((result.meta.changes ?? 0) !== 1)
    return Response.json(
      { error: 'Follow-up não pode mais ser cancelado' },
      { status: 409 },
    );
  return Response.json({ id, status: 'CANCELLED' });
}
