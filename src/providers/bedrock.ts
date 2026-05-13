import { createHash, createHmac } from 'node:crypto';
import type {
  BuildRequestParams,
  HttpRequest,
  NormalizedUsage,
  ParsedEvent,
  ProviderAdapter,
} from './types.js';

const BEDROCK_ANTHROPIC_VERSION = 'bedrock-2023-05-31';
const SERVICE = 'bedrock';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function buildRequest(params: BuildRequestParams): HttpRequest {
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  if (!accessKey || !secretKey) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set');
  }

  // Streaming uses binary event-stream framing which this adapter doesn't parse.
  // Force non-streaming; the runner spec should also set streaming: false.
  const action = 'invoke';
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const encodedModel = encodeURIComponent(params.model);
  const path = `/model/${encodedModel}/${action}`;
  const url = `https://${host}${path}`;
  // SigV4 canonical URI requires path segments to be URI-encoded a second time
  // (every service except S3). The `:` in Bedrock model IDs becomes %253A here.
  const canonicalPath = `/model/${encodeURIComponent(encodedModel)}/${action}`;

  const body = JSON.stringify({
    anthropic_version: BEDROCK_ANTHROPIC_VERSION,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    messages: [{ role: 'user', content: params.prompt }],
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const signedHeaderNames = ['content-type', 'host', 'x-amz-date'];
  if (sessionToken) signedHeaderNames.push('x-amz-security-token');
  signedHeaderNames.sort();

  const headerValues: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-amz-date': amzDate,
  };
  if (sessionToken) headerValues['x-amz-security-token'] = sessionToken;

  const canonicalHeaders = signedHeaderNames.map(n => `${n}:${headerValues[n]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    'POST',
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = signingKey(secretKey, dateStamp, region, SERVICE);
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-amz-date': amzDate,
    authorization,
  };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;

  return { url, method: 'POST', headers, body };
}

function normalizeUsage(u: any): NormalizedUsage | null {
  if (!u) return null;
  const out: NormalizedUsage = { raw: u };
  if (typeof u.input_tokens === 'number') out.input_tokens = u.input_tokens;
  if (typeof u.output_tokens === 'number') out.output_tokens = u.output_tokens;
  if (typeof u.cache_read_input_tokens === 'number') out.cache_read_tokens = u.cache_read_input_tokens;
  if (typeof u.cache_creation_input_tokens === 'number') out.cache_write_tokens = u.cache_creation_input_tokens;
  return out;
}

function parseStreamEvent(_eventBlock: string): ParsedEvent | null {
  return null;
}

function parseFinalResponse(body: string): Partial<ParsedEvent> {
  try {
    const obj = JSON.parse(body);
    const text = Array.isArray(obj.content)
      ? obj.content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('')
      : null;
    return {
      text: text && text.length > 0 ? text : null,
      finishReason: obj.stop_reason ?? null,
      usage: normalizeUsage(obj.usage),
      modelVersion: obj.model ?? null,
      responseId: obj.id ?? null,
      raw: obj,
    };
  } catch {
    return {};
  }
}

export const bedrock: ProviderAdapter = {
  name: 'bedrock',
  apiVersion: BEDROCK_ANTHROPIC_VERSION,
  buildRequest,
  parseStreamEvent,
  parseFinalResponse,
};
