export function normalizePhone(input: string, defaultCountry = 'BR'): string | null {
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!hadPlus && defaultCountry === 'BR') {
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    else if (!digits.startsWith('55') || (digits.length !== 12 && digits.length !== 13)) return null;
  }
  if (digits.length < 10 || digits.length > 15) return null;

  return `+${digits}`;
}
