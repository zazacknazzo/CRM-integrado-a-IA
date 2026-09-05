import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localVars = Object.fromEntries(
  [
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'WHATSAPP_PROVIDER',
    'WHATSAPP_WEB_GATEWAY_URL',
    'WHATSAPP_WEB_GATEWAY_SECRET',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_BUSINESS_ACCOUNT_ID',
    'WHATSAPP_VERIFY_TOKEN',
    'META_APP_SECRET',
    'WHATSAPP_GRAPH_API_VERSION',
    'APP_URL',
    'MESSAGE_DEBOUNCE_MS',
    'WHATSAPP_WINDOW_HOURS',
    'MAX_PROMOTIONAL_FOLLOWUPS',
    'FOLLOWUP_LIMIT_WINDOW_DAYS',
    'LOG_LEVEL',
    'CRM_ACCESS_PASSWORD',
    'CRM_SESSION_SECRET',
    'INTERNAL_JOB_SECRET',
    'ALLOW_LOCAL_PASSWORDLESS',
  ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
);

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
  vars: localVars,
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      // O domínio público do Cloudflare Tunnel é dinâmico. O CRM continua
      // protegido pela senha e pelo cookie HttpOnly da aplicação.
      allowedHosts: true as const,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
