import { getRawDb } from '../../../db/index.ts';
import { requireCrmAuth } from '../../../lib/auth.ts';
import { catalog, professionals } from '../../../knowledge/catalog.ts';
import { syncAppointment } from '../../../db/commercial.ts';

export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  const from =
    url.searchParams.get('from') ??
    new Date(Date.now() - 86_400_000).toISOString();
  const to =
    url.searchParams.get('to') ??
    new Date(Date.now() + 90 * 86_400_000).toISOString();
  const result = await getRawDb()
    .prepare(
      `SELECT a.*, COALESCE(cl.name, cl.whatsapp_profile_name, cl.phone_e164) AS client_name, cl.phone_e164
     FROM appointments a JOIN clients cl ON cl.id = a.client_id
     WHERE a.start_at >= ? AND a.start_at <= ? ORDER BY a.start_at ASC LIMIT 500`,
    )
    .bind(from, to)
    .all();
  return Response.json({ appointments: result.results });
}

export async function POST(request: Request) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => null)) as {
    conversationId?: string;
    clientId?: string;
    professional?: string;
    service?: string;
    startAt?: string;
    durationMinutes?: number;
    status?: string;
    notes?: string;
  } | null;
  const start = body?.startAt ? Date.parse(body.startAt) : Number.NaN;
  if (
    !body?.professional?.trim() ||
    !body.service?.trim() ||
    !Number.isFinite(start)
  ) {
    return Response.json(
      { error: 'Profissional, serviço e data/hora são obrigatórios' },
      { status: 400 },
    );
  }
  if (start <= Date.now())
    return Response.json(
      { error: 'Escolha um horário futuro' },
      { status: 400 },
    );
  const service = catalog.find((s) => s.name === body.service);
  const professional = professionals.find((p) => p === body.professional);
  if (!service)
    return Response.json(
      { error: 'Escolha um serviço cadastrado' },
      { status: 400 },
    );
  if (!professional)
    return Response.json(
      { error: 'Escolha um profissional cadastrado' },
      { status: 400 },
    );
  const db = getRawDb();
  let clientId = body.clientId;
  if (body.conversationId) {
    const conversationClient = (
      await db
        .prepare('SELECT client_id FROM conversations WHERE id = ?')
        .bind(body.conversationId)
        .first<{ client_id: string }>()
    )?.client_id;
    if (!conversationClient || (clientId && clientId !== conversationClient))
      return Response.json(
        { error: 'Cliente não corresponde à conversa' },
        { status: 400 },
      );
    clientId = conversationClient;
  }
  if (!clientId)
    return Response.json({ error: 'Cliente não encontrado' }, { status: 404 });
  const duration = service.durationMinutes;
  const statuses = ['PENDING_CONFIRMATION', 'CONFIRMED'];
  const status = statuses.includes(body.status ?? '')
    ? body.status!
    : 'PENDING_CONFIRMATION';
  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const endAt = new Date(start + duration * 60_000).toISOString();
  const conflict = await db
    .prepare(
      `SELECT id FROM appointments
     WHERE lower(professional) = lower(?) AND status IN ('PENDING_CONFIRMATION', 'CONFIRMED')
     AND julianday(start_at) < julianday(?)
     AND julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?) LIMIT 1`,
    )
    .bind(professional, endAt, new Date(start).toISOString())
    .first();
  if (conflict)
    return Response.json(
      {
        error: `${professional} já possui um horário que conflita com esse período`,
      },
      { status: 409 },
    );
  const inserted = await db
    .prepare(
      `INSERT INTO appointments (id, conversation_id, client_id, professional, service, start_at, duration_minutes, status, notes, created_at, updated_at, estimated_value_cents)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM appointments WHERE lower(professional) = lower(?) AND status IN ('PENDING_CONFIRMATION','CONFIRMED')
       AND julianday(start_at) < julianday(?) AND julianday(start_at, '+' || duration_minutes || ' minutes') > julianday(?))`,
    )
    .bind(
      id,
      body.conversationId ?? null,
      clientId,
      professional,
      service.name,
      new Date(start).toISOString(),
      duration,
      status,
      body.notes?.trim() || null,
      timestamp,
      timestamp,
      service.priceCents,
      professional,
      endAt,
      new Date(start).toISOString(),
    )
    .run();
  if (!inserted.meta.changes)
    return Response.json(
      { error: 'Esse período acabou de ser reservado.' },
      { status: 409 },
    );
  await syncAppointment(db, id);
  return Response.json({ id, status }, { status: 201 });
}
