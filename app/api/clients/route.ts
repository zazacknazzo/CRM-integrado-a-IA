import { getRawDb } from '../../../db/index.ts';
import { requireCrmAuth } from '../../../lib/auth.ts';

export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await getRawDb()
      .prepare(
        `SELECT cl.id, cl.phone_e164, COALESCE(cl.name, cl.whatsapp_profile_name, 'Sem nome') AS name,
       cl.lead_source, cl.promotional_opt_out, cl.created_at, COUNT(c.id) AS conversation_count,
       cl.preferred_professional, cl.notes,
       (SELECT MAX(start_at) FROM appointments WHERE client_id = cl.id AND status = 'COMPLETED') AS last_attended_at,
       (SELECT id FROM conversations WHERE client_id = cl.id ORDER BY updated_at DESC LIMIT 1) AS conversation_id
       FROM clients cl LEFT JOIN conversations c ON c.client_id = cl.id
       GROUP BY cl.id ORDER BY cl.updated_at DESC LIMIT 500`,
      )
      .all();
    return Response.json({ clients: result.results });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not list clients',
      },
      { status: 500 },
    );
  }
}
