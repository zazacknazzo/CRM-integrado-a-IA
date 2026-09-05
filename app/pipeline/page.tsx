'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  actionNames,
  stageNames,
  normalizeStage,
  stalledMinutes,
} from '@/core/commercial';
type Conversation = {
  id: string;
  client_name: string;
  channel: string;
  control_state: string;
  opportunity_stage: string | null;
  interest: string | null;
  next_best_action: string | null;
  last_interaction_at: string | null;
  pending_follow_up_at: string | null;
  estimated_value_cents: number | null;
};
export default function PipelinePage() {
  const [asOf, setAsOf] = useState(() => Date.now());
  const [items, setItems] = useState<Conversation[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await fetch('/api/conversations', { cache: 'no-store' });
        if (!r.ok) throw new Error('Não foi possível carregar o funil');
        const data = (await r.json()) as { conversations?: Conversation[] };
        if (active) {
          setAsOf(Date.now());
          setItems(data.conversations ?? []);
          setError('');
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : 'Falha ao carregar');
      }
    };
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const real = items.filter((i) => i.channel === 'WHATSAPP');
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Funil comercial</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/commercial">Agir agora</Link>
          <Link href="/">Inbox</Link>
          <Link href="/follow-ups">Recuperar leads</Link>
        </nav>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="flex gap-4 overflow-x-auto pb-5">
        {Object.entries(stageNames).map(([stage, name]) => {
          const group = real.filter(
            (i) => normalizeStage(i.opportunity_stage) === stage,
          );
          return (
            <section
              key={stage}
              className="w-72 shrink-0 rounded-xl bg-muted p-3"
            >
              <h2 className="mb-3 flex justify-between text-sm font-semibold">
                {name}
                <span>{group.length}</span>
              </h2>
              <div className="space-y-3">
                {group.map((i) => (
                  <Link
                    className="block"
                    key={i.id}
                    href={'/?conversation=' + i.id}
                  >
                    <Card className="py-4">
                      <CardContent className="space-y-2 px-4">
                        <h3 className="font-semibold">{i.client_name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {i.interest ?? 'Serviço a definir'}
                        </p>
                        <p className="text-sm font-medium text-primary">
                          {i.control_state === 'PROFESSIONAL_HANDOFF'
                            ? 'Profissional assumir'
                            : i.control_state === 'HUMAN_CONTROL'
                              ? 'Atendimento humano'
                              : (actionNames[i.next_best_action ?? ''] ??
                                'Responder')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {stalledMinutes(i.last_interaction_at, asOf)} min
                          desde a última interação
                        </p>
                        {i.pending_follow_up_at && (
                          <p className="text-sm">
                            {Date.parse(i.pending_follow_up_at) <= asOf
                              ? 'Sem resposta · retorno pendente'
                              : 'Retorno programado'}
                          </p>
                        )}
                        {i.estimated_value_cents != null && (
                          <p className="text-sm">
                            Potencial{' '}
                            {new Intl.NumberFormat('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            }).format(i.estimated_value_cents / 100)}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Atendimento humano e retorno são sinalizados nos cartões, preservando a
        etapa de venda. Simulações não entram no funil.
      </p>
    </main>
  );
}
