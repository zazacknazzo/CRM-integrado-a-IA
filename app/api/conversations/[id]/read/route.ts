import { getRawDb } from '../../../../../db/index.ts';
import { requireCrmAuth } from '../../../../../lib/auth.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const result = await getRawDb().prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').bind(id).run();
  if ((result.meta.changes ?? 0) !== 1) return Response.json({ error: 'Conversation not found' }, { status: 404 });
  return Response.json({ read: true });
}
