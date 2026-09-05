import { getRawDb, getRuntimeEnv } from '../../../db/index.ts';
import { requireCrmAuth } from '../../../lib/auth.ts';
import { scheduleManualFollowUp } from '../../../db/follow-up-scheduling.ts';
export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const result = await getRawDb()
    .prepare(
      `SELECT f.*, cl.phone_e164, COALESCE(cl.name,cl.whatsapp_profile_name,cl.phone_e164) AS client_name FROM follow_ups f JOIN conversations c ON c.id = f.conversation_id JOIN clients cl ON cl.id = c.client_id ORDER BY CASE WHEN f.status IN ('SCHEDULED','WAITING_FOR_TEMPLATE','PROCESSING') THEN 0 ELSE 1 END, f.priority DESC, f.scheduled_for ASC LIMIT 200`,
    )
    .all();
  return Response.json({ followUps: result.results });
}

export async function POST(request: Request) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => null)) as {
    conversationId?: string;
    scheduledFor?: string;
    message?: string;
    templateName?: string;
  } | null;
  if (
    !body?.conversationId ||
    !body.scheduledFor ||
    typeof body.message !== 'string'
  )
    return Response.json(
      { error: 'Conversa, mensagem e data são obrigatórias.' },
      { status: 400 },
    );
  const env = getRuntimeEnv();
  const result = await scheduleManualFollowUp(
    getRawDb(),
    {
      conversationId: body.conversationId,
      scheduledFor: body.scheduledFor,
      message: body.message,
      templateName: body.templateName,
    },
    Number(env.MAX_PROMOTIONAL_FOLLOWUPS ?? 2),
    Number(env.FOLLOWUP_LIMIT_WINDOW_DAYS ?? 30),
  );
  return Response.json(result, { status: result.code });
}
