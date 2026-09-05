'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleX,
  Scissors,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Appointment = {
  id: string;
  client_name: string;
  phone_e164: string;
  professional: string;
  service: string;
  start_at: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
};
const statusNames: Record<string, string> = {
  PENDING_CONFIRMATION: 'A confirmar',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

export default function AppointmentsPage() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/appointments', { cache: 'no-store' });
    if (response.ok)
      setItems(
        ((await response.json()) as { appointments?: Appointment[] })
          .appointments ?? [],
      );
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    return () => clearTimeout(initial);
  }, [load]);
  const grouped = useMemo(
    () =>
      items.reduce((result, item) => {
        const day = new Intl.DateTimeFormat('pt-BR', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
        }).format(new Date(item.start_at));
        result.set(day, [...(result.get(day) ?? []), item]);
        return result;
      }, new Map<string, Appointment[]>()),
    [items],
  );
  async function update(id: string, status: string) {
    const response = await fetch(`/api/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      confirmationSent?: boolean;
      confirmationError?: string | null;
    };
    setMessage(
      response.ok
        ? status === 'CONFIRMED' && result.confirmationSent
          ? 'Horário confirmado e cliente avisado no WhatsApp.'
          : (result.confirmationError ?? 'Agenda atualizada.')
        : 'Não foi possível atualizar.',
    );
    if (response.ok) void load();
  }
  return (
    <main className="min-h-screen bg-[#f6f6f2] p-5">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center gap-3">
          <Link
            className="grid size-9 place-items-center rounded-lg bg-card shadow-sm"
            href="/"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Operação
            </p>
            <h1 className="font-display text-xl font-semibold">Agenda</h1>
          </div>
          <Badge className="ml-auto" variant="outline">
            <CalendarDays /> {items.length} agendamentos
          </Badge>
        </header>
        <p className="mb-5 rounded-lg border bg-card p-4 text-sm">
          Agenda sem integração com o salão. A IA coleta preferências; somente a
          equipe registra e confirma os agendamentos depois de consultar a
          agenda real.
        </p>
        {message ? (
          <p className="mb-4 rounded-lg bg-green-50 p-3 text-xs text-green-800">
            {message}
          </p>
        ) : null}
        <div className="space-y-6">
          {[...grouped.entries()].map(([day, appointments]) => (
            <section key={day}>
              <h2 className="mb-2 capitalize text-sm font-semibold">{day}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {appointments.map((item) => (
                  <Card className="gap-3 py-4" key={item.id}>
                    <CardHeader className="px-4">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-sm">
                          {item.client_name}
                        </CardTitle>
                        <Badge variant="outline">
                          {statusNames[item.status] ?? item.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 px-4 text-xs">
                      <p className="flex items-center gap-2">
                        <Scissors className="size-3.5 text-muted-foreground" />{' '}
                        {item.service} · {item.professional}
                      </p>
                      <p className="text-muted-foreground">
                        {new Intl.DateTimeFormat('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(item.start_at))}{' '}
                        · {item.duration_minutes} min · {item.phone_e164}
                      </p>
                      {item.notes ? (
                        <p className="text-muted-foreground">{item.notes}</p>
                      ) : null}
                      {item.status !== 'CANCELLED' &&
                      item.status !== 'COMPLETED' ? (
                        <div className="flex gap-2 pt-2">
                          {item.status !== 'CONFIRMED' ? (
                            <Button
                              onClick={() => void update(item.id, 'CONFIRMED')}
                              size="sm"
                            >
                              <Check /> Confirmar
                            </Button>
                          ) : (
                            <Button
                              onClick={() => void update(item.id, 'COMPLETED')}
                              size="sm"
                            >
                              <Check /> Concluir
                            </Button>
                          )}
                          <Button
                            onClick={() => void update(item.id, 'CANCELLED')}
                            size="sm"
                            variant="outline"
                          >
                            <CircleX /> Cancelar
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
          {!items.length ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                Nenhum agendamento. Crie um pelo painel da conversa na Inbox.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}
