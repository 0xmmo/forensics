const SECRET_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'anthropic-api-key',
  'x-goog-api-key',
  'api-key',
  'openai-api-key',
  'cookie',
  'set-cookie',
]);

const REDACTED = 'REDACTED';

export function redactHeaders(input: Record<string, string> | Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = input instanceof Headers ? [...input.entries()] : Object.entries(input);
  for (const [k, v] of entries) {
    out[k] = SECRET_HEADER_KEYS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|api[-_]?key|access[-_]?token)=)[^&]+/gi, `$1${REDACTED}`);
}
