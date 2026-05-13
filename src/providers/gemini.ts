import type { BuildRequestParams, HttpRequest, ParsedEvent, ProviderAdapter } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function buildRequest(params: BuildRequestParams): HttpRequest {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const action = params.streaming ? 'streamGenerateContent' : 'generateContent';
  const qs = new URLSearchParams();
  if (params.streaming) qs.set('alt', 'sse');
  qs.set('key', apiKey);
  const url = `${BASE}/models/${encodeURIComponent(params.model)}:${action}?${qs.toString()}`;

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: params.maxTokens,
    temperature: params.temperature,
  };
  if (typeof params.thinkingBudget === 'number') {
    generationConfig.thinkingConfig = { thinkingBudget: params.thinkingBudget };
  }
  const body = {
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
    generationConfig,
  };

  return {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function extractFromObject(obj: any): ParsedEvent {
  const candidate = obj?.candidates?.[0];
  const parts: any[] = candidate?.content?.parts ?? [];
  const text = parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('') || null;
  const u = obj?.usageMetadata;
  const usage = u
    ? {
        input_tokens: u.promptTokenCount,
        output_tokens: u.candidatesTokenCount,
        cache_read_tokens: u.cachedContentTokenCount,
        reasoning_tokens: u.thoughtsTokenCount,
        raw: u,
      }
    : null;
  return {
    text,
    finishReason: candidate?.finishReason ?? null,
    usage,
    modelVersion: obj?.modelVersion ?? null,
    responseId: obj?.responseId ?? null,
    raw: obj,
  };
}

function parseStreamEvent(eventBlock: string): ParsedEvent | null {
  const dataLines = eventBlock
    .split('\n')
    .filter(l => l.startsWith('data:'))
    .map(l => l.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const joined = dataLines.join('\n');
  if (joined === '[DONE]') return null;
  try {
    return extractFromObject(JSON.parse(joined));
  } catch {
    return null;
  }
}

function parseFinalResponse(body: string): Partial<ParsedEvent> {
  try {
    return extractFromObject(JSON.parse(body));
  } catch {
    return {};
  }
}

export const gemini: ProviderAdapter = {
  name: 'gemini',
  apiVersion: 'v1beta',
  buildRequest,
  parseStreamEvent,
  parseFinalResponse,
};
