'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, SendHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function SimulatorPage() {
  const [phone, setPhone] = useState('+55 11 99999-0001');
  const [message, setMessage] = useState('Queria saber os horários para progressiva.');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    const response = await fetch('/api/simulator/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromPhone: phone, text: message }) });
    setResult(await response.json() as Record<string, unknown>); setSending(false);
  }

  return <main className="min-h-screen bg-[#f6f6f2] p-5 text-foreground"><div className="mx-auto max-w-3xl"><div className="mb-6 flex items-center gap-3"><Link aria-label="Voltar para Inbox" className="grid size-8 place-items-center rounded-lg bg-card shadow-sm" href="/"><ArrowLeft className="size-4" /></Link><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ambiente seguro</p><h1 className="font-display text-xl font-semibold">SimulatorChannel</h1></div><Badge className="ml-auto" variant="outline"><Bot /> Mesmo domínio da IA</Badge></div>
    <Card><CardHeader><CardTitle>Enviar mensagem de cliente</CardTitle><CardDescription>Testa persistência, debounce, Professional Gate, agente, verifier, CRM e dispatch sem usar o WhatsApp real.</CardDescription></CardHeader><CardContent className="space-y-4"><label className="block text-xs font-medium" htmlFor="sim-phone">Telefone</label><Input className="mt-1.5" id="sim-phone" onChange={(event) => setPhone(event.target.value)} value={phone} /><label className="block text-xs font-medium" htmlFor="sim-message">Mensagem</label><Textarea className="mt-1.5 min-h-28" id="sim-message" onChange={(event) => setMessage(event.target.value)} value={message} /><Button disabled={sending || !message.trim()} onClick={send}>{sending ? 'Processando…' : <><SendHorizontal /> Enviar pelo simulador</>}</Button>{result ? <pre className="overflow-auto rounded-xl bg-[#263a34] p-4 text-xs text-[#eaf0ec]">{JSON.stringify(result, null, 2)}</pre> : null}<p className="text-[11px] leading-relaxed text-muted-foreground">Dica: teste “meu cabelo está quebrando depois de uma química”. O resultado esperado é PROFESSIONAL_HANDOFF e zero mensagem de saída.</p></CardContent></Card>
  </div></main>;
}
