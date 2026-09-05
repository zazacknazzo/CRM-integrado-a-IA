'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LockKeyhole, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setLoading(false);
    if (!response.ok) { setError(result.error ?? 'Não foi possível entrar'); return; }
    const next = search.get('next');
    router.replace(next?.startsWith('/') ? next : '/');
  }

  return <main className="grid min-h-screen place-items-center bg-[#f3f3ee] p-5"><Card className="w-full max-w-sm shadow-lg"><CardHeader className="text-center"><div className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-5" /></div><CardTitle>Entrar no Atende</CardTitle><CardDescription>Use a senha privada configurada no PC do salão.</CardDescription></CardHeader><CardContent><form className="space-y-3" onSubmit={submit}><div className="relative"><LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Senha de acesso" className="pl-9" onChange={(event) => setPassword(event.target.value)} placeholder="Senha de acesso" type="password" value={password} /></div><Button className="w-full" disabled={loading || !password}>{loading ? 'Entrando…' : 'Entrar'}</Button>{error ? <p className="rounded-lg bg-red-50 p-2 text-center text-xs text-red-700">{error}</p> : null}</form></CardContent></Card></main>;
}
