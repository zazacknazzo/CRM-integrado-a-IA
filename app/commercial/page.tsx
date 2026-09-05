'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { actionNames, stageNames, stalledMinutes } from '@/core/commercial';

type Lead = {
  id: string;
  channel: string;
  client_name: string;
  interest: string | null;
  opportunity_stage: string;
  control_state: string;
  next_best_action: string;
  last_interaction_at: string | null;
  pending_follow_up_at: string | null;
  estimated_value_cents: number | null;
  attention_priority: number;
};
type Metrics = {
  leads_today: number;
  leads_week: number;
  leads_served: number;
  conversion_rate: number;
  converted_leads: number;
  active_conversations: number;
  pending_follow_ups: number;
  recovered_leads: number;
  potential_cents: number | null;
  future_bookings: number;
  forecast_cents: number | null;
  bookings_without_value: number;
  sources: {
    lead_source: string;
    leads: number;
    booked_leads: number;
    potential_cents: number | null;
    booked_cents: number | null;
  }[];
};
const sources: Record<string, string> = {
  UNKNOWN: 'Não identificada',
  WHATSAPP: 'WhatsApp direto',
  META_REFERRAL: 'Anúncio Meta',
  GOOGLE_ADS: 'Google Ads',
  INDICATION: 'Indicação',
  ORGANIC: 'Orgânico',
  IMPORT: 'Base importada',
};
const money = (cents: number | null) =>
  cents === null
    ? 'Sem valor cadastrado'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(cents / 100);
export default function CommercialPage() {
  const [asOf, setAsOf] = useState(() => Date.now());
  const [metrics, setMetrics] = useState<Metrics | null>(null),
    [leads, setLeads] = useState<Lead[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [m, c] = await Promise.all([
          fetch('/api/commercial', { cache: 'no-store' }),
          fetch('/api/conversations', { cache: 'no-store' }),
        ]);
        if (!m.ok || !c.ok)
          throw new Error('Não foi possível carregar o comercial.');
        const [data, conversations] = await Promise.all([
          m.json() as Promise<Metrics>,
          c.json() as Promise<{ conversations: Lead[] }>,
        ]);
        if (active) {
          setAsOf(Date.now());
          setMetrics(data);
          setLeads(conversations.conversations ?? []);
          setError('');
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : 'Falha ao carregar');
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const queue = leads
    .filter((l) => l.channel === 'WHATSAPP' && l.attention_priority > 0)
    .sort((a, b) => b.attention_priority - a.attention_priority)
    .slice(0, 30);
  return (
    <main className="min-h-screen bg-background p-4 sm:p-7">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">RJ Studio de Beleza</p>
            <h1 className="font-display text-2xl font-semibold">Comercial</h1>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/">Inbox</Link>
            <Link href="/pipeline">Funil</Link>
            <Link href="/appointments">Agenda</Link>
          </nav>
        </header>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {!metrics && !error && <p>Carregando resultados…</p>}
        {metrics && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Leads hoje', metrics.leads_today, '/'],
                ['Leads nesta semana', metrics.leads_week, '/pipeline'],
                ['Atendidos na semana', metrics.leads_served, '/'],
                [
                  'Conversão da semana',
                  metrics.conversion_rate + '%',
                  '/pipeline',
                ],
                [
                  'Agendamentos futuros',
                  metrics.future_bookings,
                  '/appointments',
                ],
                [
                  'Retornos pendentes',
                  metrics.pending_follow_ups,
                  '/follow-ups',
                ],
                [
                  'Leads recuperados na semana',
                  metrics.recovered_leads,
                  '/follow-ups',
                ],
                [
                  'Previsão da agenda',
                  money(metrics.forecast_cents),
                  '/appointments',
                ],
              ].map(([label, value, url]) => (
                <Link href={String(url)} key={label}>
                  <Card className="h-full py-4">
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="mt-2 text-2xl font-semibold">{value}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Semana desde segunda-feira, no horário de Brasília. Conversão:{' '}
              {metrics.converted_leads} dos {metrics.leads_week} leads recebidos
              nesta semana têm agendamento confirmado. Valores são estimativas;
              serviços complexos têm preço inicial.{' '}
              {metrics.bookings_without_value > 0 &&
                `${metrics.bookings_without_value} reservas ainda sem valor cadastrado.`}
            </p>
            <section className="rounded-xl border bg-card p-5">
              <div className="mb-4 flex flex-wrap justify-between gap-2">
                <h2 className="text-lg font-semibold">Agir agora</h2>
                <p className="text-sm text-muted-foreground">
                  {metrics.active_conversations} conversas abertas · potencial{' '}
                  {money(metrics.potential_cents)}
                </p>
              </div>
              {queue.length ? (
                <div className="divide-y">
                  {queue.map((l) => {
                    const action =
                      l.control_state === 'PROFESSIONAL_HANDOFF'
                        ? 'Profissional assumir'
                        : l.control_state === 'HUMAN_CONTROL'
                          ? 'Atendimento pessoal'
                          : l.pending_follow_up_at &&
                              Date.parse(l.pending_follow_up_at) <= asOf
                            ? 'Retomar conversa'
                            : (actionNames[l.next_best_action] ?? 'Responder');
                    const minutes = stalledMinutes(l.last_interaction_at, asOf);
                    return (
                      <Link
                        href={'/?conversation=' + l.id}
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-4"
                      >
                        <div>
                          <p className="font-medium">{l.client_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {l.interest ?? 'Serviço a definir'} ·{' '}
                            {stageNames[l.opportunity_stage] ??
                              l.opportunity_stage}{' '}
                            ·{' '}
                            {minutes < 60
                              ? minutes + ' min'
                              : Math.floor(minutes / 60) + ' h'}{' '}
                            sem interação
                          </p>
                        </div>
                        <span
                          className={
                            l.control_state === 'PROFESSIONAL_HANDOFF'
                              ? 'text-amber-800 font-medium'
                              : 'text-primary font-medium'
                          }
                        >
                          {action} →
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Nenhuma conversa real precisando de atenção ainda.
                </p>
              )}
            </section>
            <section className="rounded-xl border bg-card p-5">
              <h2 className="mb-3 text-lg font-semibold">
                Os leads estão virando agendamentos?
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-3">Origem</th>
                      <th>Leads</th>
                      <th>Agendaram</th>
                      <th>Conversão</th>
                      <th>Potencial</th>
                      <th>Agendado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.sources.map((s) => (
                      <tr key={s.lead_source} className="border-b">
                        <td className="py-3">
                          {sources[s.lead_source] ?? s.lead_source}
                        </td>
                        <td>{s.leads}</td>
                        <td>{s.booked_leads}</td>
                        <td>
                          {s.leads
                            ? Math.round((s.booked_leads / s.leads) * 100)
                            : 0}
                          %
                        </td>
                        <td>{money(s.potential_cents)}</td>
                        <td>{money(s.booked_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Sem identificação, a origem permanece desconhecida. Corrija-a
                nos detalhes da conversa quando souber de onde a cliente veio.
              </p>
            </section>
          </>
        )}
        <Link href="/">
          <Button variant="outline">Abrir caixa de entrada</Button>
        </Link>
      </div>
    </main>
  );
}
