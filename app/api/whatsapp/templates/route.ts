import { getRawDb } from '../../../../db/index.ts';
import { requireCrmAuth } from '../../../../lib/auth.ts';

export async function GET(request: Request) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  const result = await getRawDb().prepare('SELECT id, name, language, category, approved, created_at FROM whatsapp_templates ORDER BY name').all();
  return Response.json({ templates: result.results });
}

export async function POST(request: Request) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { name?: string; language?: string; category?: string; approved?: boolean } | null;
  if (!body?.name?.trim() || !body.language?.trim() || !body.category?.trim()) return Response.json({ error: 'name, language and category are required' }, { status: 400 });
  try {
    const db = getRawDb();
    await db.prepare(
      `INSERT INTO whatsapp_templates (id, name, language, category, approved, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name, language) DO UPDATE SET category = excluded.category, approved = excluded.approved`,
    ).bind(crypto.randomUUID(), body.name.trim(), body.language.trim(), body.category.trim(), body.approved ? 1 : 0, new Date().toISOString()).run();
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not save template' }, { status: 500 });
  }
}
