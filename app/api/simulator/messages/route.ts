import { processInboundMessage } from '../../../../core/pipeline.ts';
import { createRuntime } from '../../../../lib/runtime.ts';
import { requireCrmAuth } from '../../../../lib/auth.ts';

export async function POST(request: Request) {
  const unauthorized = await requireCrmAuth(request); if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { externalId?: string; fromPhone?: string; text?: string } | null;
  if (!body?.fromPhone || !body.text?.trim()) return Response.json({ error: 'fromPhone and text are required' }, { status: 400 });
  try {
    const { pipeline } = createRuntime();
    const result = await processInboundMessage({
      externalId: body.externalId ?? `sim_in_${crypto.randomUUID()}`,
      channel: 'SIMULATOR',
      fromPhone: body.fromPhone,
      type: 'text',
      text: body.text.trim(),
      timestamp: new Date().toISOString(),
    }, pipeline);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Simulator processing failed' }, { status: 500 });
  }
}
