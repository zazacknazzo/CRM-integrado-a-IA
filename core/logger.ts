const secretKeyPattern = /token|secret|authorization|api[_-]?key/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKeyPattern.test(key) ? '[REDACTED]' : sanitize(item)]));
  }
  return value;
}

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  const safeFields = sanitize(fields) as Record<string, unknown>;
  console.info(JSON.stringify({ level: 'info', event, at: new Date().toISOString(), ...safeFields }));
}

export function logError(event: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const safeFields = sanitize(fields) as Record<string, unknown>;
  console.error(JSON.stringify({ level: 'error', event, at: new Date().toISOString(), error: message, ...safeFields }));
}
