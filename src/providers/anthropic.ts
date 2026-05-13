import type {
  BuildRequestParams,
  HttpRequest,
  NormalizedUsage,
  ParsedEvent,
  ProviderAdapter,
} from './types.js';

const URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

function buildRequest(params: BuildRequestParams): HttpRequest {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const body = {
    model: params.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    stream: params.streaming,
    messages: [{ role: 'user', content: params.prompt }],
  };

  return {
    url: URL,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify(body),
  };
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

function parseStreamEvent(eventBlock: string): ParsedEvent | null {
  let dataStr = '';
  let hasData = false;
  for (const line of eventBlock.split('\n')) {
    if (line.startsWith('data:')) {
      dataStr += line.slice(5).trimStart();
      hasData = true;
    }
  }
  if (!hasData || dataStr.length === 0) return null;
  let obj: any;
  try {
    obj = JSON.parse(dataStr);
  } catch {
    return null;
  }

  let text: string | null = null;
  let finishReason: string | null = null;
  let usage: NormalizedUsage | null = null;
  let modelVersion: string | null = null;
  let responseId: string | null = null;

  const type = obj.type;
  if (type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
    text = typeof obj.delta.text === 'string' ? obj.delta.text : null;
  }
  if (type === 'message_start' && obj.message) {
    modelVersion = obj.message.model ?? null;
    responseId = obj.message.id ?? null;
    usage = normalizeUsage(obj.message.usage);
  }
  if (type === 'message_delta') {
    if (obj.delta?.stop_reason) finishReason = obj.delta.stop_reason;
    usage = normalizeUsage(obj.usage);
  }

  return { text, finishReason, usage, modelVersion, responseId, raw: obj };
}

function parseFinalResponse(body: string): Partial<ParsedEvent> {
  try {
    const obj = JSON.parse(body);
    const text =
      Array.isArray(obj.content)
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

export const anthropic: ProviderAdapter = {
  name: 'anthropic',
  apiVersion: VERSION,
  buildRequest,
  parseStreamEvent,
  parseFinalResponse,
};
