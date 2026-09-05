'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock3, MessageCircle, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type FollowUp = {
  conversation_id: string;
  client_name: string;
  priority: number;
  reason: string | null;
  id: string;
  phone_e164: string;
  message_body: string | null;
  scheduled_for: string;
  status: string;
  sent_at: string | null;
  last_error: string | null;
};
const statusNames: Record<string, string> = {
  SCHEDULED: 'Agendado',
  PROCESSING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelado',
  WAITING_FOR_TEMPLATE: 'Aguardando template',
};

export default function FollowUpsPage() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const load = useCallback(async () => {
    const response = await fetch('/api/follow-ups', { cache: 'no-store' });
    if (response.ok)
      setItems(
        ((await response.json()) as { followUps?: FollowUp[] }).followUps ?? [],
      );
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  async function cancel(id: string) {
    const response = await fetch(`/api/follow-ups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });
    if (response.ok) void load();
  }
  return (
    <main className="min-h-screen bg-[#f6f6f2] p-5">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center gap-3">
          <Link
            className="grid size-9 place-items-center rounded-lg bg-card shadow-sm"
            href="/"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Relacionamento
            </p>
            <h1 className="font-display text-xl font-semibold">Follow-ups</h1>
          </div>
          <Badge className="ml-auto" variant="outline">
            <Clock3 />{' '}
            {items.filter((item) => item.status === 'SCHEDULED').length}{' '}
            pendentes
          </Badge>
        </header>
        <div className="space-y-3">
          {items.map((item) => (
            <Card className="py-4" key={item.id}>
              <CardContent className="flex items-start gap-4 px-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e8ece7] text-[#486253]">
                  <MessageCircle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      <Link
                        className="underline underline-offset-4"
                        href={`/?conversation=${item.conversation_id}`}
                      >
                        {item.client_name ?? item.phone_e164}
                      </Link>{' '}
                      ·{' '}
                      {item.priority >= 80
                        ? 'Prioridade alta'
                        : 'Retorno comercial'}
                    </p>
                    <Badge variant="outline">
                      {statusNames[item.status] ?? item.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed">
                    {item.message_body ?? 'Mensagem de template'}
                  </p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Programado:{' '}
                    {new Intl.DateTimeFormat('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(item.scheduled_for))}
                  </p>
                  {item.last_error ? (
                    <p className="mt-2 rounded-md bg-red-50 p-2 text-[10px] text-red-800">
                      {item.last_error}
                    </p>
                  ) : null}
                </div>
                {['SCHEDULED', 'WAITING_FOR_TEMPLATE'].includes(item.status) ? (
                  <Button
                    aria-label="Cancelar follow-up"
                    onClick={() => void cancel(item.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
          {!items.length ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Nenhum retorno pendente. O agente agenda um retorno após novas
                conversas comerciais que ficam sem resposta.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}
