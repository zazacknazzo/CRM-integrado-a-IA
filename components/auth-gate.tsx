'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(pathname === '/login');

  useEffect(() => {
    if (pathname === '/login') return;
    let cancelled = false;
    void fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      const result = await response.json().catch(() => ({ authenticated: false })) as { authenticated?: boolean };
      if (cancelled) return;
      if (result.authenticated) setReady(true);
      else router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });
    return () => { cancelled = true; };
  }, [pathname, router]);

  if (!ready) return <main className="grid min-h-screen place-items-center bg-[#f6f6f2] text-sm text-muted-foreground">Abrindo o Atende…</main>;
  return children;
}
