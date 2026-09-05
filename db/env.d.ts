declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
    WHATSAPP_VERIFY_TOKEN?: string;
    META_APP_SECRET?: string;
    WHATSAPP_GRAPH_API_VERSION?: string;
    WHATSAPP_PROVIDER?: 'meta' | 'baileys';
    WHATSAPP_WEB_GATEWAY_URL?: string;
    WHATSAPP_WEB_GATEWAY_SECRET?: string;
    APP_URL?: string;
    DATABASE_URL?: string;
    MESSAGE_DEBOUNCE_MS?: string;
    WHATSAPP_WINDOW_HOURS?: string;
    MAX_PROMOTIONAL_FOLLOWUPS?: string;
    LOG_LEVEL?: string;
    CRM_ACCESS_PASSWORD?: string;
    CRM_SESSION_SECRET?: string;
    INTERNAL_JOB_SECRET?: string;
    ALLOW_LOCAL_PASSWORDLESS?: string;
    FOLLOWUP_LIMIT_WINDOW_DAYS?: string;
    BACKUP_ENCRYPTION_KEY?: string;
    BACKUP_COPY_DIRECTORY?: string;
  }
}
