'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { actionNames } from '@/core/commercial';
type Details = {
  id: string;
  client_id: string;
  next_best_action?: string;
  estimated_value_cents?: number | null;
  objection?: string | null;
  last_attended_at?: string | null;
  last_professional?: string | null;
  preferred_professional?: string | null;
  client_notes?: string | null;
  lead_source: string;
  name_source?: string;
  pending_follow_up_at?: string | null;
};
export function CommercialDetails({
  item,
  onSaved,
}: {
  item: Details;
  onSaved: () => void;
}) {
  const fieldId = useId();
  const [source, setSource] = useState(item.lead_source),
    [professional, setProfessional] = useState(
      item.preferred_professional ?? '',
    ),
    [notes, setNotes] = useState(item.client_notes ?? ''),
    [reason, setReason] = useState(''),
    [message, setMessage] = useState('');
  async function save(lost = false) {
    try {
      const r = await fetch(
        lost
          ? `/api/conversations/${item.id}/commercial`
          : `/api/clients/${item.client_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            lost
              ? { stage: 'LOST', reason }
              : {
                  leadSource: source,
                  preferredProfessional: professional,
                  notes,
                },
          ),
        },
      );
      const body = (await r.json()) as { error?: string };
      setMessage(r.ok ? 'Atualizado.' : (body.error ?? 'Falha ao salvar.'));
      if (r.ok) onSaved();
    } catch {
      setMessage('Sem conexão. Tente novamente.');
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg bg-muted p-3">
        <p className="text-muted-foreground">Próxima ação</p>
        <p className="mt-1 font-semibold">
          {actionNames[item.next_best_action ?? ''] ?? 'Responder à cliente'}
        </p>
      </div>
      {item.estimated_value_cents != null && (
        <p>
          Valor potencial:{' '}
          {new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          }).format(item.estimated_value_cents / 100)}{' '}
          (estimativa)
        </p>
      )}
      {item.objection && (
        <p>Objeção: {item.objection === 'PRICE' ? 'Preço' : item.objection}</p>
      )}
      <p>
        {item.last_attended_at
          ? 'Último atendimento: ' +
            new Date(item.last_attended_at).toLocaleDateString('pt-BR')
          : item.name_source === 'IMPORT'
            ? 'Cliente da base importada; histórico de atendimento não informado.'
            : 'Sem atendimento anterior registrado.'}
      </p>
      {item.last_professional && (
        <p>Último profissional: {item.last_professional}</p>
      )}
      {item.pending_follow_up_at && (
        <p>
          Retorno: {new Date(item.pending_follow_up_at).toLocaleString('pt-BR')}
        </p>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          Origem e observações
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block">
            Origem
            <select
              aria-label="Origem do lead"
              className="mt-1 w-full rounded-md border bg-background p-2"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              {Object.entries({
                UNKNOWN: 'Não identificada',
                WHATSAPP: 'WhatsApp direto',
                GOOGLE_ADS: 'Google Ads',
                META_REFERRAL: 'Anúncio Meta',
                INDICATION: 'Indicação',
                ORGANIC: 'Orgânico',
                IMPORT: 'Importação',
              }).map(([v, label]) => (
                <option value={v} key={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block" htmlFor={fieldId + '-professional'}>
            Profissional preferido
            <Input
              id={fieldId + '-professional'}
              value={professional}
              onChange={(e) => setProfessional(e.target.value)}
              placeholder="Nome cadastrado"
            />
          </label>
          <label className="block" htmlFor={fieldId + '-notes'}>
            Observações
            <Textarea
              id={fieldId + '-notes'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </label>
          <Button onClick={() => void save()} size="sm">
            Salvar
          </Button>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-muted-foreground">
          Encerrar oportunidade perdida
        </summary>
        <div className="mt-2 space-y-2">
          <Input
            aria-label="Motivo da perda"
            placeholder="Motivo da perda"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={!reason.trim()}
            variant="outline"
            onClick={() => void save(true)}
          >
            Registrar perda
          </Button>
        </div>
      </details>
      {message && <output>{message}</output>}
    </div>
  );
}
