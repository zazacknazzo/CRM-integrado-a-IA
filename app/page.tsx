'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Bell,
  Bot,
  CalendarDays,
  CheckCheck,
  Clock3,
  Inbox,
  KanbanSquare,
  LogOut,
  MessageCircleMore,
  Search,
  SendHorizontal,
  Settings,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CommercialDetails } from '@/components/commercial-details';
import { actionNames, stageNames as commercialStages } from '@/core/commercial';
import { useAtendeWebMcp } from '@/hooks/use-atende-webmcp';

type ControlState = 'AI_ACTIVE' | 'HUMAN_CONTROL' | 'PROFESSIONAL_HANDOFF';
type Filter = 'all' | 'unread' | 'handoff';
type ApiConversation = {
  next_best_action?: string;
  attention_priority?: number;
  estimated_value_cents?: number | null;
  objection?: string | null;
  last_attended_at?: string | null;
  last_professional?: string | null;
  preferred_professional?: string | null;
  client_notes?: string | null;
  name_source?: string;
  pending_follow_up_at?: string | null;
  id: string;
  channel: string;
  client_id: string;
  client_name: string;
  phone_e164: string;
  last_message: string | null;
  last_customer_message_at: string | null;
  unread_count: number;
  control_state: ControlState;
  handoff_reason: string | null;
  customer_service_window_expires_at: string | null;
  lead_source: string;
  opportunity_stage: string | null;
  interest: string | null;
  summary: string | null;
  last_outbound_status: string | null;
  created_at: string;
};
type ApiMessage = {
  id: string;
  direction: string;
  sender_type: string;
  body: string | null;
  message_type: string;
  status: string;
  failure_reason?: string | null;
  created_at: string;
};
type CatalogService = {
  name: string;
  priceCents: number;
  startingAt: boolean;
  durationMinutes: number;
};
type WhatsAppStatus = {
  provider?: string;
  connected?: boolean;
  lastWebhookAt?: string | null;
  lastError?: string | null;
  gatewayAccount?: string | null;
  gatewayLastDropReason?: string | null;
  gatewayLastInboundQueuedAt?: string | null;
  gatewayWebsocketOpen?: boolean;
  gatewayLastRecoveryAt?: string | null;
  gatewayLastRecoveryReason?: string | null;
};

const tones = [
  'bg-[#e8d7ca] text-[#744b37]',
  'bg-[#dbe5ce] text-[#49603a]',
  'bg-[#d8e3ea] text-[#3c5d70]',
  'bg-[#eadfca] text-[#755b37]',
];
const sourceNames: Record<string, string> = {
  UNKNOWN: 'Não identificada',
  GOOGLE_ADS: 'Google Ads',
  INDICATION: 'Indicação',
  ORGANIC: 'Orgânico',
  META_REFERRAL: 'Anúncio Meta',
  IMPORT: 'Importação',
  WHATSAPP: 'WhatsApp',
};
const stageNames: Record<string, string> = {
  ...commercialStages,
  NEW: 'Novo contato',
  QUALIFICATION: 'Qualificação',
  SCHEDULING: 'Agendamento',
  FOLLOW_UP: 'Aguardando retorno',
  OBJECTION: 'Objeção',
  HUMAN_CONFIRMATION: 'Confirmação da equipe',
  PROFESSIONAL_REVIEW: 'Avaliação profissional',
  WON: 'Convertido',
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'WA'
  );
}
function shortTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}
function windowLabel(value: string | null, provider?: string) {
  if (provider === 'baileys') return 'Envio local disponível';
  if (!value) return 'Sem janela aberta';
  const minutes = Math.floor((Date.parse(value) - Date.now()) / 60_000);
  if (minutes <= 0) return 'Janela encerrada';
  return `Aberta por mais ${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}
function requiresAttention(item: ApiConversation) {
  return (
    item.control_state === 'PROFESSIONAL_HANDOFF' ||
    (item.control_state === 'HUMAN_CONTROL' && Boolean(item.handoff_reason))
  );
}
function outboundStatus(status: string) {
  const labels: Record<string, string> = {
    queued: 'Na fila',
    accepted: 'Enviada',
    sent: 'Enviada',
    delivered: 'Entregue',
    read: 'Lida',
    failed: 'Falhou',
  };
  return labels[status] ?? status;
}
function localDateTimeMin() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export default function Home() {
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus>({});
  const [modal, setModal] = useState<'appointment' | 'followup' | null>(null);
  const [professional, setProfessional] = useState('');
  const [service, setService] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  const [catalogProfessionals, setCatalogProfessionals] = useState<string[]>(
    [],
  );
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const knownHandoffs = useRef<Set<string> | null>(null);
  const messagesViewport = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);
  const loadedConversation = useRef('');

  const active = useMemo(
    () => conversations.find((item) => item.id === selected) ?? null,
    [conversations, selected],
  );
  const unread = useMemo(
    () => conversations.reduce((total, item) => total + item.unread_count, 0),
    [conversations],
  );
  const handoffs = useMemo(
    () => conversations.filter(requiresAttention).length,
    [conversations],
  );
  const visible = useMemo(
    () =>
      conversations.filter((item) => {
        const matchesQuery = `${item.client_name} ${item.phone_e164}`
          .toLocaleLowerCase('pt-BR')
          .includes(query.toLocaleLowerCase('pt-BR'));
        return (
          matchesQuery &&
          (filter === 'all' ||
            (filter === 'unread' && item.unread_count > 0) ||
            (filter === 'handoff' && requiresAttention(item)))
        );
      }),
    [conversations, filter, query],
  );

  const loadConversations = useCallback(async () => {
    const response = await fetch('/api/conversations', { cache: 'no-store' });
    if (!response.ok) return;
    const next =
      ((await response.json()) as { conversations?: ApiConversation[] })
        .conversations ?? [];
    const nextHandoffs = new Set(
      next.filter(requiresAttention).map((item) => item.id),
    );
    if (knownHandoffs.current) {
      for (const item of next)
        if (nextHandoffs.has(item.id) && !knownHandoffs.current.has(item.id)) {
          if ('Notification' in window && Notification.permission === 'granted')
            new Notification('Atende: profissional necessário', {
              body: `${item.client_name}: ${item.handoff_reason ?? 'verifique a conversa'}`,
            });
          try {
            const context = new AudioContext();
            const oscillator = context.createOscillator();
            oscillator.connect(context.destination);
            oscillator.start();
            oscillator.stop(context.currentTime + 0.12);
          } catch {}
        }
    }
    knownHandoffs.current = nextHandoffs;
    setConversations(next);
    setSelected((current) =>
      current && next.some((item) => item.id === current)
        ? current
        : (next[0]?.id ?? ''),
    );
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void loadConversations(), 0);
    const timer = setInterval(() => void loadConversations(), 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadConversations]);
  useEffect(() => {
    const load = async () => {
      const response = await fetch('/api/settings/whatsapp', {
        cache: 'no-store',
      });
      if (response.ok) setWhatsapp((await response.json()) as WhatsAppStatus);
    };
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const load = async () => {
      const response = await fetch('/api/catalog', { cache: 'force-cache' });
      if (!response.ok) return;
      const result = (await response.json()) as {
        services?: CatalogService[];
        professionals?: string[];
      };
      setCatalogServices(result.services ?? []);
      setCatalogProfessionals(result.professionals ?? []);
    };
    void load();
  }, []);
  useEffect(() => {
    if (!selected) return;
    shouldAutoScroll.current = true;
    let cancelled = false;
    const load = async () => {
      const response = await fetch(`/api/conversations/${selected}/messages`, {
        cache: 'no-store',
      });
      if (response.ok && !cancelled) {
        const viewport = messagesViewport.current;
        shouldAutoScroll.current =
          loadedConversation.current !== selected ||
          !viewport ||
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
            180;
        loadedConversation.current = selected;
        setMessages(
          ((await response.json()) as { messages?: ApiMessage[] }).messages ??
            [],
        );
      }
    };
    void fetch(`/api/conversations/${selected}/read`, { method: 'POST' }).then(
      () =>
        setConversations((items) =>
          items.map((item) =>
            item.id === selected ? { ...item, unread_count: 0 } : item,
          ),
        ),
    );
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 2500);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [selected]);
  useEffect(() => {
    if (!shouldAutoScroll.current) return;
    const frame = requestAnimationFrame(() =>
      messagesViewport.current?.scrollTo({
        top: messagesViewport.current.scrollHeight,
        behavior: 'smooth',
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  const changeControlState = useCallback(
    async (state: 'AI_ACTIVE' | 'HUMAN_CONTROL') => {
      if (!selected) return;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const response = await fetch(`/api/conversations/${selected}/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        });
        const result = (await response.json()) as {
          error?: string;
          controlState?: ControlState;
          resumeStatus?: string;
          resumeError?: string | null;
        };
        if (!response.ok)
          throw new Error(
            result.error ?? 'Não foi possível alterar o controle',
          );
        setConversations((items) =>
          items.map((item) =>
            item.id === selected
              ? { ...item, control_state: result.controlState ?? state }
              : item,
          ),
        );
        setNotice(
          state === 'HUMAN_CONTROL'
            ? 'Conversa assumida pela equipe.'
            : result.resumeStatus === 'SENT'
              ? 'A IA assumiu e respondeu à última mensagem.'
              : result.resumeError
                ? `IA ativa, mas a resposta falhou: ${result.resumeError}`
                : 'A IA responderá à próxima mensagem.',
        );
        await loadConversations();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Falha ao alterar o controle',
        );
      } finally {
        setBusy(false);
      }
    },
    [loadConversations, selected],
  );
  useAtendeWebMcp({
    conversationId: selected,
    setControlState: changeControlState,
  });

  async function sendMessage() {
    if (!active || !draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/conversations/${active.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.trim() }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Não foi possível enviar');
      setDraft('');
      setNotice('Mensagem enviada.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível enviar',
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveAppointment() {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: active.id,
          professional,
          service,
          startAt: new Date(scheduledFor).toISOString(),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Não foi possível agendar');
      setModal(null);
      setProfessional('');
      setService('');
      setScheduledFor('');
      setNotice('Agendamento salvo como pendente de confirmação.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível agendar',
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveFollowUp() {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: active.id,
          message: followUpMessage,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Não foi possível agendar o retorno');
      setModal(null);
      setFollowUpMessage('');
      setScheduledFor('');
      setNotice('Follow-up agendado. O sistema fará o envio automaticamente.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível agendar o retorno',
      );
    } finally {
      setBusy(false);
    }
  }
  async function enableAlerts() {
    if (!('Notification' in window)) {
      setError('Este navegador não oferece notificações.');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotice(
      permission === 'granted'
        ? 'Alertas de handoff ativados.'
        : 'O navegador não autorizou os alertas.',
    );
  }
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex min-h-16 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 lg:px-7">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="hidden sm:block">
            <p className="font-display text-[17px] font-semibold">Atende</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              CRM inteligente
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <nav className="flex items-center lg:hidden">
            <Link href="/commercial" className="p-2 text-sm font-medium">
              Comercial
            </Link>
            <Link
              aria-label="Agenda"
              className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              href="/appointments"
            >
              <CalendarDays className="size-4" />
            </Link>
            <Link
              aria-label="Follow-ups"
              className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              href="/follow-ups"
            >
              <Clock3 className="size-4" />
            </Link>
            <Link
              aria-label="Configurações"
              className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              href="/settings/whatsapp"
            >
              <Settings className="size-4" />
            </Link>
          </nav>
          <Badge
            className={`${whatsapp.connected ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'} max-w-[145px] truncate sm:max-w-none`}
            variant="outline"
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${whatsapp.connected ? 'bg-green-600' : 'bg-red-600'}`}
            />
            <span className="truncate">
              {whatsapp.connected
                ? `WhatsApp conectado${whatsapp.gatewayAccount ? ` ${whatsapp.gatewayAccount}` : ''}`
                : 'WhatsApp desconectado'}
            </span>
          </Badge>
          <Button
            aria-label="Ativar alertas"
            onClick={enableAlerts}
            size="icon"
            variant="ghost"
          >
            <Bell />
          </Button>
          <Button
            aria-label="Sair"
            onClick={logout}
            size="icon"
            variant="ghost"
          >
            <LogOut />
          </Button>
        </div>
      </header>
      <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden flex-col justify-between border-r border-border bg-[#f7f7f4] p-3 lg:flex">
          <nav className="space-y-1">
            <NavItem
              href="/commercial"
              icon={<KanbanSquare />}
              label="Agir agora"
            />
            <NavItem
              active
              count={unread || undefined}
              href="/"
              icon={<Inbox />}
              label="Inbox"
            />
            <NavItem
              href="/appointments"
              icon={<CalendarDays />}
              label="Agenda"
            />
            <NavItem href="/follow-ups" icon={<Clock3 />} label="Follow-ups" />
            <NavItem href="/clients" icon={<UsersRound />} label="Clientes" />
            <NavItem
              href="/pipeline"
              icon={<KanbanSquare />}
              label="Pipeline"
            />
            <div className="my-4 border-t border-border" />
            <NavItem
              href="/settings/whatsapp"
              icon={<Settings />}
              label="Configurações"
            />
          </nav>
          <div className="rounded-xl border bg-card p-3">
            <p className="flex items-center gap-2 text-xs font-medium">
              <MessageCircleMore className="size-4" />{' '}
              {whatsapp.provider === 'baileys'
                ? 'WhatsApp local'
                : 'WhatsApp oficial'}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {whatsapp.gatewayLastDropReason === 'FROM_CONNECTED_ACCOUNT'
                ? 'Teste enviado pelo próprio número conectado é ignorado. Use outro celular.'
                : whatsapp.gatewayLastDropReason === 'LID_WITHOUT_PHONE_MAPPING'
                  ? 'Mensagem recebida sem telefone identificável; reconecte o WhatsApp.'
                  : whatsapp.lastError
                    ? `Erro: ${whatsapp.lastError}`
                    : whatsapp.gatewayLastInboundQueuedAt
                      ? `Última entrada: ${shortTime(whatsapp.gatewayLastInboundQueuedAt)}`
                      : whatsapp.lastWebhookAt
                        ? `Última mensagem: ${shortTime(whatsapp.lastWebhookAt)}`
                        : 'Aguardando mensagens'}
            </p>
          </div>
        </aside>
        <section className="grid min-h-0 grid-cols-1 xl:grid-cols-[330px_minmax(460px,1fr)_300px]">
          <aside
            className={`border-r bg-card ${mobileChatOpen ? 'hidden xl:block' : 'block'}`}
          >
            <div className="border-b px-4 pb-4 pt-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h1 className="font-display text-xl font-semibold">Inbox</h1>
                  <p className="text-xs text-muted-foreground">
                    {conversations.length} conversas ·{' '}
                    {
                      conversations.filter((c) => c.channel === 'SIMULATOR')
                        .length
                    }{' '}
                    simulações
                  </p>
                </div>
                {handoffs ? (
                  <Badge
                    className="bg-amber-50 text-amber-800"
                    variant="outline"
                  >
                    {handoffs} atenção
                  </Badge>
                ) : null}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Buscar por nome ou telefone"
                  className="h-9 bg-[#f6f6f3] pl-8"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Nome ou telefone"
                  value={query}
                />
              </div>
              <div className="mt-3 flex gap-2">
                <FilterButton
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                >
                  Todas {conversations.length}
                </FilterButton>
                <FilterButton
                  active={filter === 'unread'}
                  onClick={() => setFilter('unread')}
                >
                  Não lidas {unread}
                </FilterButton>
                <FilterButton
                  active={filter === 'handoff'}
                  onClick={() => setFilter('handoff')}
                >
                  Atenção {handoffs}
                </FilterButton>
              </div>
            </div>
            <div className="max-h-[calc(100vh-205px)] divide-y overflow-y-auto">
              {visible.map((item, index) => (
                <button
                  aria-label={`Abrir conversa com ${item.client_name}`}
                  className={`flex w-full gap-3 px-4 py-4 text-left hover:bg-[#f8f8f5] ${selected === item.id ? 'bg-[#f1f4ef] shadow-[inset_3px_0_0_#567663]' : ''}`}
                  key={item.id}
                  onClick={() => {
                    setSelected(item.id);
                    setMobileChatOpen(true);
                    setNotice('');
                    setError('');
                  }}
                >
                  <Avatar className="size-10">
                    <AvatarFallback
                      className={`${tones[index % tones.length]} text-xs font-semibold`}
                    >
                      {initials(item.client_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2">
                      <strong className="truncate text-sm">
                        {item.client_name}
                      </strong>
                      <small className="shrink-0 text-muted-foreground">
                        {shortTime(item.last_customer_message_at)}
                      </small>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.last_message ?? 'Nova conversa'}
                    </span>
                    <span className="mt-2 block text-sm">
                      {item.interest ?? 'Serviço a definir'} ·{' '}
                      {stageNames[item.opportunity_stage ?? 'NEW_LEAD'] ??
                        'Em conversa'}
                    </span>
                    <span className="mt-1 block text-sm font-medium text-primary">
                      {item.control_state === 'PROFESSIONAL_HANDOFF'
                        ? 'Profissional assumir'
                        : (actionNames[item.next_best_action ?? ''] ??
                          'Responder à cliente')}
                    </span>
                    <span className="mt-2 flex items-center justify-between">
                      <span className="text-[10px] text-[#4f735f]">
                        WhatsApp ·{' '}
                        {item.control_state === 'AI_ACTIVE' ? 'IA' : 'Equipe'}
                      </span>
                      {item.unread_count ? (
                        <span className="grid size-5 place-items-center rounded-full bg-[#b8533f] text-[10px] text-white">
                          {item.unread_count}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              ))}
              {!visible.length ? (
                <p className="p-8 text-center text-xs text-muted-foreground">
                  Nenhuma conversa encontrada.
                </p>
              ) : null}
            </div>
          </aside>
          <section
            className={`${mobileChatOpen ? 'flex' : 'hidden xl:flex'} min-h-[calc(100vh-64px)] flex-col bg-[#f5f5f1] xl:min-h-[680px]`}
          >
            {active ? (
              <>
                <header className="flex min-h-[72px] items-center justify-between gap-2 border-b bg-card px-3 sm:px-5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Button
                      aria-label="Voltar para conversas"
                      className="xl:hidden"
                      onClick={() => setMobileChatOpen(false)}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowLeft />
                    </Button>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">
                        {active.client_name}
                      </h2>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {active.phone_e164} · WhatsApp
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      className={`${active.control_state === 'AI_ACTIVE' ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'} hidden sm:flex`}
                      variant="outline"
                    >
                      {active.control_state === 'AI_ACTIVE' ? (
                        <>
                          <Bot /> IA ativa
                        </>
                      ) : active.control_state === 'PROFESSIONAL_HANDOFF' ? (
                        'Profissional necessário'
                      ) : (
                        'Controle humano'
                      )}
                    </Badge>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void changeControlState(
                          active.control_state === 'AI_ACTIVE'
                            ? 'HUMAN_CONTROL'
                            : 'AI_ACTIVE',
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      {active.control_state === 'AI_ACTIVE'
                        ? 'Assumir'
                        : 'Devolver para IA'}
                    </Button>
                  </div>
                </header>
                <div
                  className="flex-1 overflow-y-auto px-3 py-5 sm:px-5 sm:py-6"
                  ref={messagesViewport}
                >
                  <div className="mx-auto max-w-2xl space-y-2.5">
                    {messages.map((message) => (
                      <div
                        className={`flex ${message.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}
                        key={message.id}
                      >
                        <div
                          className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[13px] shadow-sm sm:max-w-[78%] ${message.direction === 'OUTBOUND' ? (message.status === 'failed' ? 'rounded-br-md border border-red-200 bg-red-50' : message.sender_type === 'AI' ? 'rounded-br-md bg-[#e4ece9]' : 'rounded-br-md bg-[#dcece1]') : 'rounded-bl-md border bg-card'}`}
                          title={message.failure_reason ?? undefined}
                        >
                          <p>{message.body ?? `[${message.message_type}]`}</p>
                          <p
                            className={`mt-1 flex justify-end gap-1 text-[9px] ${message.status === 'failed' ? 'text-red-700' : 'text-muted-foreground'}`}
                          >
                            {message.sender_type === 'AI'
                              ? 'IA · '
                              : message.sender_type === 'HUMAN'
                                ? 'Equipe · '
                                : ''}
                            {shortTime(message.created_at)}
                            {message.direction === 'OUTBOUND' ? (
                              <>
                                {' '}
                                · {outboundStatus(message.status)}{' '}
                                <CheckCheck
                                  className={`size-3 ${message.status === 'read' ? 'text-blue-600' : ''}`}
                                />
                              </>
                            ) : null}
                          </p>
                          {message.status === 'failed' ? (
                            <p className="mt-1 text-[10px] text-red-700">
                              Não enviada
                              {message.failure_reason
                                ? `: ${message.failure_reason}`
                                : '. Tente novamente.'}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {!messages.length ? (
                      <p className="py-12 text-center text-xs text-muted-foreground">
                        Esta conversa ainda não possui mensagens.
                      </p>
                    ) : null}
                    {requiresAttention(active) ? (
                      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-xs font-semibold text-amber-900">
                          Atenção da equipe necessária
                        </p>
                        <p className="mt-1 text-[11px] text-amber-800">
                          {active.handoff_reason ??
                            'A automação foi pausada para avaliação humana.'}
                        </p>
                        {active.control_state === 'PROFESSIONAL_HANDOFF' ? (
                          <Button
                            className="mt-3"
                            disabled={busy}
                            onClick={() =>
                              void changeControlState('HUMAN_CONTROL')
                            }
                            size="sm"
                          >
                            Assumir conversa
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <footer className="border-t bg-card p-3 sm:p-4">
                  <div className="mx-auto max-w-2xl">
                    {active.control_state === 'AI_ACTIVE' ? (
                      <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-3 py-3 text-xs text-green-800 sm:px-4">
                        <span className="flex items-center gap-2">
                          <Bot className="size-4" /> A IA está respondendo.
                        </span>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void changeControlState('HUMAN_CONTROL')
                          }
                          size="sm"
                          variant="outline"
                        >
                          Assumir
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-xl border bg-card">
                        <Textarea
                          className="min-h-[70px] resize-none border-0 shadow-none"
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder="Escreva uma mensagem…"
                          value={draft}
                        />
                        <div className="flex justify-end border-t p-2">
                          <Button
                            disabled={busy || !draft.trim()}
                            onClick={() => void sendMessage()}
                            size="sm"
                          >
                            <SendHorizontal /> Enviar
                          </Button>
                        </div>
                      </div>
                    )}
                    {notice ? (
                      <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-[11px] text-green-800">
                        {notice}
                      </p>
                    ) : null}
                    {error ? (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-800">
                        {error}
                      </p>
                    ) : null}
                  </div>
                </footer>
              </>
            ) : (
              <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
                Selecione uma conversa.
              </div>
            )}
          </section>
          <aside className="hidden border-l bg-card xl:block">
            {active ? (
              <div className="space-y-5 p-5">
                <div>
                  <h2 className="font-display text-base font-semibold">
                    Detalhes do cliente
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lead desde{' '}
                    {new Intl.DateTimeFormat('pt-BR').format(
                      new Date(active.created_at),
                    )}
                  </p>
                </div>
                <CommercialDetails
                  key={active.id}
                  item={active}
                  onSaved={() => void loadConversations()}
                />
                <Info label="Telefone" value={active.phone_e164} />
                <Info
                  label="Origem"
                  value={sourceNames[active.lead_source] ?? active.lead_source}
                />
                <Info
                  label="Interesse"
                  value={active.interest ?? 'Ainda não identificado'}
                />
                <Info
                  label="Etapa"
                  value={
                    stageNames[active.opportunity_stage ?? 'NEW'] ??
                    active.opportunity_stage ??
                    'Novo contato'
                  }
                />
                {active.summary ? (
                  <Info label="Resumo da IA" value={active.summary} />
                ) : null}
                <Info
                  label="Janela de atendimento"
                  value={windowLabel(
                    active.customer_service_window_expires_at,
                    whatsapp.provider,
                  )}
                />
                <div className="space-y-2 border-t pt-5">
                  <Button
                    className="w-full justify-start"
                    onClick={() => {
                      setModal('appointment');
                      setService(active.interest ?? '');
                    }}
                    variant="outline"
                  >
                    <CalendarDays /> Criar agendamento
                  </Button>
                  <Button
                    className="w-full justify-start"
                    onClick={() => setModal('followup')}
                    variant="outline"
                  >
                    <Clock3 /> Agendar follow-up
                  </Button>
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      </div>
      {modal && active ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
          onMouseDown={() => setModal(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
            role="presentation"
          >
            <h2 className="font-display text-lg font-semibold">
              {modal === 'appointment' ? 'Novo agendamento' : 'Novo follow-up'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Cliente: {active.client_name}
            </p>
            <div className="mt-4 space-y-3">
              {modal === 'appointment' ? (
                <>
                  <Input
                    aria-label="Serviço"
                    list="catalog-services"
                    onChange={(event) => setService(event.target.value)}
                    placeholder="Escolha um serviço"
                    value={service}
                  />
                  <datalist id="catalog-services">
                    {catalogServices.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.startingAt ? 'A partir de ' : ''}
                        {new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        }).format(item.priceCents / 100)}{' '}
                        · {item.durationMinutes} min
                      </option>
                    ))}
                  </datalist>
                  <Input
                    aria-label="Profissional"
                    list="catalog-professionals"
                    onChange={(event) => setProfessional(event.target.value)}
                    placeholder="Escolha um profissional"
                    value={professional}
                  />
                  <datalist id="catalog-professionals">
                    {catalogProfessionals.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </datalist>
                </>
              ) : (
                <Textarea
                  aria-label="Mensagem do follow-up"
                  onChange={(event) => setFollowUpMessage(event.target.value)}
                  placeholder="Mensagem que será enviada"
                  value={followUpMessage}
                />
              )}
              <Input
                aria-label="Data e hora"
                min={localDateTimeMin()}
                onChange={(event) => setScheduledFor(event.target.value)}
                type="datetime-local"
                value={scheduledFor}
              />
              <div className="flex justify-end gap-2">
                <Button onClick={() => setModal(null)} variant="ghost">
                  Cancelar
                </Button>
                <Button
                  disabled={
                    busy ||
                    !scheduledFor ||
                    (modal === 'appointment'
                      ? !professional.trim() || !service.trim()
                      : !followUpMessage.trim())
                  }
                  onClick={() =>
                    void (modal === 'appointment'
                      ? saveAppointment()
                      : saveFollowUp())
                  }
                >
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function NavItem({
  active,
  count,
  href,
  icon,
  label,
}: {
  active?: boolean;
  count?: number;
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? 'bg-[#e8ece7] font-medium text-[#263a34]' : 'text-muted-foreground hover:bg-[#eeeeea]'}`}
      href={href}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      {label}
      {count ? (
        <span className="ml-auto grid size-5 place-items-center rounded-full bg-card text-[10px]">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-7 rounded-full px-3 text-xs"
      onClick={onClick}
      size="sm"
      variant={active ? 'default' : 'outline'}
    >
      {children}
    </Button>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed">{value}</p>
    </div>
  );
}
