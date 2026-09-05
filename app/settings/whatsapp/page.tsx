'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CircleDashed, ExternalLink, MessageCircleMore, RefreshCw, ShieldCheck, Webhook } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Status = {
  provider: 'meta' | 'baileys';
  connected: boolean;
  credentialsConfigured: boolean;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  webhookConfigured: boolean;
  webhookUrl: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  lastSuccessfulSendAt: string | null;
  accessToken: 'configured' | 'missing';
  connectionPageUrl: string | null;
};

export default function WhatsAppSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const isWebGateway = status?.provider === 'baileys';

  async function load() {
    const response = await fetch('/api/settings/whatsapp', { cache: 'no-store' });
    setStatus(await response.json() as Status);
  }

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings/whatsapp', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json() as Status;
      if (!cancelled) setStatus(payload);
    });
    return () => { cancelled = true; };
  }, []);

  async function testConfiguration() {
    setTesting(true); setResult(null);
    const response = await fetch('/api/settings/whatsapp/test', { method: 'POST' });
    const payload = await response.json() as { ok?: boolean; error?: string; result?: { verifiedName?: string } };
    setResult({ ok: response.ok, message: response.ok ? `Configuração válida${payload.result?.verifiedName ? ` · ${payload.result.verifiedName}` : ''}` : payload.error ?? 'Falha no teste' });
    setTesting(false); void load();
  }

  return (
    <main className="min-h-screen bg-[#f6f6f2] text-foreground">
      <header className="border-b border-border bg-card"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5"><div className="flex items-center gap-3"><Link aria-label="Voltar para Inbox" className="grid size-8 place-items-center rounded-lg hover:bg-muted" href="/"><ArrowLeft className="size-4" /></Link><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Configurações</p><h1 className="font-display text-base font-semibold">WhatsApp</h1></div></div>{status?.connected ? <Badge className="border-[#cfe2d6] bg-[#eef7f1] text-[#316346]" variant="outline"><span className="size-1.5 rounded-full bg-[#3f9260]" /> Conectado</Badge> : <Badge variant="outline">Não conectado</Badge>}</div></header>

      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-7 lg:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircleMore className="size-4 text-[#4f735f]" /> {isWebGateway ? 'WhatsApp Web local' : 'WhatsApp Business Platform'}</CardTitle><CardDescription>{isWebGateway ? 'Modo rápido para o salão. A sessão fica neste computador e pode desconectar.' : 'Cloud API oficial da Meta. Tokens e secrets permanecem somente no servidor.'}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {isWebGateway ? <>
                <div className="rounded-lg border border-[#efd8a9] bg-[#fff8e9] px-3.5 py-3 text-xs leading-relaxed text-[#785b22]">Integração não oficial. Use um número exclusivo do salão e evite disparos em massa.</div>
                <SettingRow label="Gateway local" value={status?.credentialsConfigured ? 'Em execução neste computador' : 'Inicie com pnpm whatsapp:web'} ok={Boolean(status?.credentialsConfigured)} />
                <SettingRow label="Sessão do WhatsApp" value={status?.connected ? 'Conectada' : 'Aguardando leitura do QR Code'} ok={Boolean(status?.connected)} />
                <SettingRow label="Webhook interno" value={status?.webhookUrl ?? 'Não configurado'} ok={Boolean(status?.webhookConfigured)} />
              </> : <>
                <SettingRow label="Access token" value={status?.accessToken === 'configured' ? 'Configurado · ••••••••••••' : 'Não configurado'} ok={status?.accessToken === 'configured'} />
                <SettingRow label="Phone Number ID" value={status?.phoneNumberId ?? 'Não configurado'} ok={Boolean(status?.phoneNumberId)} />
                <SettingRow label="Business Account ID" value={status?.businessAccountId ?? 'Não configurado'} ok={Boolean(status?.businessAccountId)} />
                <SettingRow label="Webhook" value={status?.webhookUrl ?? 'APP_URL não configurada'} ok={Boolean(status?.webhookConfigured)} />
              </>}
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4"><Button disabled={testing} onClick={testConfiguration}>{testing ? <RefreshCw className="animate-spin" /> : <ShieldCheck />} Testar configuração</Button><p className="text-[11px] text-muted-foreground">O teste apenas consulta metadados do número; nenhuma mensagem é enviada.</p></div>
              {isWebGateway && status?.connectionPageUrl ? <a className="inline-flex items-center gap-1 text-xs font-medium text-[#3f6e51] hover:underline" href={status.connectionPageUrl} target="_blank" rel="noreferrer">Abrir QR Code local <ExternalLink className="size-3" /></a> : null}
              {result ? <div className={`rounded-lg px-3 py-2.5 text-xs ${result.ok ? 'bg-[#eef7f1] text-[#316346]' : 'bg-[#fff0ed] text-[#994b3d]'}`}>{result.message}</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Webhook className="size-4 text-[#4f735f]" /> Diagnóstico</CardTitle><CardDescription>Eventos recentes da integração.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Metric label="Último webhook" value={formatDate(status?.lastWebhookAt)} />
              <Metric label="Último envio aceito" value={formatDate(status?.lastSuccessfulSendAt)} />
              <Metric error={Boolean(status?.lastError)} label="Último erro" value={status?.lastError ?? 'Nenhum erro registrado'} />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader><CardTitle>Checklist de conexão</CardTitle><CardDescription>{isWebGateway ? 'Conexão rápida pelo computador do salão.' : 'Os passos no painel da Meta são manuais e obrigatórios.'}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {(isWebGateway ? [
              ['1', 'Execute pnpm whatsapp:web no computador que ficará ligado no salão.'],
              ['2', 'Abra a página local do QR Code.'],
              ['3', 'No celular do salão, use Aparelhos conectados e leia o QR Code.'],
              ['4', 'Mantenha o comando aberto durante o atendimento.'],
              ['5', 'Envie uma mensagem de outro celular e confira a Inbox.'],
            ] : [
              ['1', 'Crie um app do tipo Business no Meta for Developers.'],
              ['2', 'Adicione o produto WhatsApp e use primeiro o número de teste da Meta.'],
              ['3', 'Copie token, Phone Number ID e WABA ID para .dev.vars.'],
              ['4', 'Inicie o app e execute o túnel HTTPS com pnpm tunnel.'],
              ['5', 'Cadastre a URL pública terminada em /api/webhooks/whatsapp.'],
              ['6', 'Use o mesmo WHATSAPP_VERIFY_TOKEN e assine o campo messages.'],
            ]).map(([number, copy]) => <div className="flex gap-3" key={number}><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#e8ece7] text-[10px] font-semibold text-[#365443]">{number}</span><p className="pt-0.5 text-xs leading-relaxed text-muted-foreground">{copy}</p></div>)}
            {!isWebGateway ? <a className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#3f6e51] hover:underline" href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" rel="noreferrer" target="_blank">Abrir documentação da Meta <ExternalLink className="size-3" /></a> : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function SettingRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3.5 py-3"><div><p className="text-xs font-medium">{label}</p><p className="mt-1 break-all text-[11px] text-muted-foreground">{value}</p></div>{ok ? <CheckCircle2 className="size-4 shrink-0 text-[#4e8a63]" /> : <CircleDashed className="size-4 shrink-0 text-muted-foreground" />}</div>;
}

function Metric({ error = false, label, value }: { error?: boolean; label: string; value: string }) {
  return <div className="rounded-lg bg-[#f7f7f4] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p><p className={`mt-2 text-[11px] leading-relaxed ${error ? 'text-[#994b3d]' : 'text-foreground'}`}>{value}</p></div>;
}

function formatDate(value?: string | null) {
  if (!value) return 'Ainda não registrado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
