import { getRawDb } from '../../../../db/index.ts';
import { requireCrmAuth } from '../../../../lib/auth.ts';
import { professionals } from '../../../../knowledge/catalog.ts';
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => null)) as {
    leadSource?: string;
    preferredProfessional?: string;
    notes?: string;
  } | null;
  const { id } = await context.params;
  if (
    !body ||
    ![
      'UNKNOWN',
      'WHATSAPP',
      'META_REFERRAL',
      'GOOGLE_ADS',
      'INDICATION',
      'ORGANIC',
      'IMPORT',
    ].includes(body.leadSource ?? '')
  )
    return Response.json(
      { error: 'Escolha uma origem válida.' },
      { status: 400 },
    );
  if (
    body.preferredProfessional &&
    !professionals.some((p) => p === body.preferredProfessional)
  )
    return Response.json(
      { error: 'Profissional não cadastrado.' },
      { status: 400 },
    );
  await getRawDb()
    .prepare(
      'UPDATE clients SET lead_source = ?, preferred_professional = ?, notes = ?, updated_at = ? WHERE id = ?',
    )
    .bind(
      body.leadSource,
      body.preferredProfessional || null,
      body.notes?.trim().slice(0, 1000) || null,
      new Date().toISOString(),
      id,
    )
    .run();
  return Response.json({ ok: true });
}
