export function salonDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
export function salonTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
export function slotLabel(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
export function requestedDay(text: string, now = new Date()): string | null {
  const local = salonDate(now.toISOString());
  const date = new Date(local + 'T12:00:00-03:00');
  const weekdays = [
    'domingo',
    'segunda',
    'terça',
    'quarta',
    'quinta',
    'sexta',
    'sábado',
  ];
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  let offset: number | null = /\bamanha\b/.test(normalized)
    ? 1
    : /\bhoje\b/.test(normalized)
      ? 0
      : null;
  const dayIndex = weekdays.findIndex((day) =>
    normalized.includes(day.normalize('NFD').replace(/[\u0300-\u036f]/g, '')),
  );
  if (dayIndex >= 0) offset = (dayIndex - date.getUTCDay() + 7) % 7;
  if (offset !== null) {
    date.setUTCDate(date.getUTCDate() + offset);
    return salonDate(date.toISOString());
  }
  const explicit = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (!explicit) return null;
  return `${explicit[3] ?? local.slice(0, 4)}-${explicit[2].padStart(2, '0')}-${explicit[1].padStart(2, '0')}`;
}
export function chosenTime(text: string): string | null {
  // Only explicit selection/consent; mentioning a time is not consent.
  const chosen = text
    .trim()
    .match(
      /^(?:(?:quero|pode ser|pode marcar|pode reservar|reserva|marca|prefiro|fico com)\s+)?(?:[àa]s\s+|o de\s+)?([01]?\d|2[0-3])(?:\s*h(?:oras)?\s*([0-5]\d)?|:([0-5]\d))?(?:\s*(?:por favor|mesmo|pra mim|para mim))?[.!]?$/i,
    );
  return chosen
    ? chosen[1].padStart(2, '0') + ':' + (chosen[2] ?? chosen[3] ?? '00')
    : null;
}
