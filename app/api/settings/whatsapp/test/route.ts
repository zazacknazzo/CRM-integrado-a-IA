import { createRuntime } from '../../../../../lib/runtime.ts';
import { requireCrmAuth } from '../../../../../lib/auth.ts';

export async function POST(request: Request) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  try {
    const { repository, whatsapp } = createRuntime();
    const result = await whatsapp.testConfiguration();
    await repository.noteIntegration({ lastError: null });
    return Response.json({ ok: true, result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'WhatsApp configuration test failed';
    try { const { repository } = createRuntime(); await repository.noteIntegration({ lastError: detail }); } catch {}
    return Response.json({ ok: false, error: detail }, { status: 400 });
  }
}
