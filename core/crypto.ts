function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

export async function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=') || !appSecret) return false;
  return verifyHmacSignature(rawBody, signatureHeader.slice('sha256='.length), appSecret);
}

export async function verifyHmacSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  const supplied = signatureHeader?.toLowerCase() ?? '';
  if (!secret) return false;
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  let mismatch = expected.length ^ supplied.length;
  for (let index = 0; index < Math.min(expected.length, supplied.length); index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}
