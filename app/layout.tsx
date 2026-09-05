import type { Metadata } from 'next';
import { DM_Sans, Manrope } from 'next/font/google';
import './globals.css';
import { AuthGate } from '@/components/auth-gate';

const body = DM_Sans({ variable: '--font-body', subsets: ['latin'] });
const display = Manrope({ variable: '--font-display', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: 'Atende — CRM inteligente no WhatsApp',
  description: 'Inbox, CRM e automação comercial segura para WhatsApp.',
  openGraph: {
    title: 'Atende — CRM inteligente no WhatsApp',
    description: 'Inbox, CRM e automação comercial segura para WhatsApp.',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'Atende — CRM inteligente no WhatsApp' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Atende — CRM inteligente no WhatsApp',
    description: 'Inbox, CRM e automação comercial segura para WhatsApp.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${body.variable} ${display.variable} antialiased`}><AuthGate>{children}</AuthGate></body></html>;
}
