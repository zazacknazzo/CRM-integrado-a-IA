'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileSpreadsheet, Upload, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Client = {
  conversation_id: string | null;
  last_attended_at: string | null;
  preferred_professional: string | null;
  id: string;
  phone_e164: string;
  name: string;
  lead_source: string;
  promotional_opt_out: number;
  created_at: string;
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/clients', { cache: 'no-store' });
    const data = (await response.json()) as { clients?: Client[] };
    setClients(data.clients ?? []);
  }
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/clients', { cache: 'no-store' }).then(async (response) => {
      const data = (await response.json()) as { clients?: Client[] };
      if (!cancelled) setClients(data.clients ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  async function upload() {
    if (!file) return;
    const form = new FormData();
    form.set('file', file);
    const response = await fetch('/api/clients/import', {
      method: 'POST',
      body: form,
    });
    const data = (await response.json()) as {
      imported?: number;
      skipped?: number;
      error?: string;
    };
    setMessage(
      response.ok
        ? `${data.imported ?? 0} clientes importados; ${data.skipped ?? 0} ignorados.`
        : (data.error ?? 'Falha na importação'),
    );
    if (response.ok) void load();
  }

  return (
    <main className="min-h-screen bg-[#f6f6f2] p-5">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3">
          <Link
            aria-label="Voltar para Inbox"
            className="grid size-8 place-items-center rounded-lg bg-card shadow-sm"
            href="/"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              CRM
            </p>
            <h1 className="font-display text-xl font-semibold">Clientes</h1>
          </div>
          <Badge className="ml-auto" variant="outline">
            <UsersRound /> {clients.length} registros
          </Badge>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader>
              <CardTitle>Base de clientes</CardTitle>
              <CardDescription>
                Telefones do WhatsApp são normalizados e deduplicados de forma
                conservadora.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Contato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.length ? (
                    clients.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell className="font-medium">
                          {client.conversation_id ? (
                            <Link
                              className="underline underline-offset-4"
                              href={`/?conversation=${client.conversation_id}`}
                            >
                              {client.name}
                            </Link>
                          ) : (
                            client.name
                          )}
                          {client.last_attended_at && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              Último atendimento:{' '}
                              {new Date(
                                client.last_attended_at,
                              ).toLocaleDateString('pt-BR')}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>{client.phone_e164}</TableCell>
                        <TableCell>{client.lead_source}</TableCell>
                        <TableCell>
                          {client.promotional_opt_out ? (
                            <Badge variant="destructive">Opt-out</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Permitido
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        className="py-10 text-center text-muted-foreground"
                        colSpan={4}
                      >
                        Nenhum cliente ainda. Use o simulador ou importe uma
                        planilha.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="size-4" /> Importar base
              </CardTitle>
              <CardDescription>
                CSV, XLSX ou XLS · até 5 MB / 5.000 linhas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                accept=".csv,.xlsx,.xls"
                className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <Button disabled={!file} onClick={upload}>
                <Upload /> Importar
              </Button>
              {message ? (
                <p className="rounded-lg bg-muted p-3 text-xs">{message}</p>
              ) : null}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Coluna obrigatória: telefone, phone, whatsapp ou celular. O
                sistema nunca substitui silenciosamente um nome manual já
                existente.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
