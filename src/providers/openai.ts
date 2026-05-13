import type {
  BuildRequestParams,
  HttpRequest,
  NormalizedUsage,
  ParsedEvent,
  ProviderAdapter,
} from './types.js';

const URL = 'https://api.openai.com/v1/chat/completions';

function buildRequest(params: BuildRequestParams): HttpRequest {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const body: Record<string, unknown> = {
    model: params.model,
    messages: [{ role: 'user', content: params.prompt }],
    max_completion_tokens: params.maxTokens,
    temperature: params.temperature,
    stream: params.streaming,
  };
  if (params.streaming) {
    body.stream_options = { include_usage: true };
  }
  if (params.reasoningEffort) {
    body.reasoning_effort = params.reasoningEffort;
  }

  return {
    url: URL,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  };
}

function normalizeUsage(u: any): NormalizedUsage | null {
  if (!u) return null;
  const out: NormalizedUsage = { raw: u };
  if (typeof u.prompt_tokens === 'number') out.input_tokens = u.prompt_tokens;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (typeof cached === 'number') out.cache_read_tokens = cached;
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoning === 'number') out.reasoning_tokens = reasoning;
  // OpenAI's completion_tokens includes reasoning tokens. Strip them so
  // output_tokens means "visible content tokens" everywhere.
  if (typeof u.completion_tokens === 'number') {
    out.output_tokens = u.completion_tokens - (typeof reasoning === 'number' ? reasoning : 0);
  }
  return out;
}

function parseStreamEvent(eventBlock: string): ParsedEvent | null {
  const dataLines: string[] = [];
  for (const line of eventBlock.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join('\n');
  if (joined === '[DONE]') return null;
  let obj: any;
  try {
    obj = JSON.parse(joined);
  } catch {
    return null;
  }
  const choice = obj.choices?.[0];
  const text = typeof choice?.delta?.content === 'string' ? choice.delta.content : null;
  const finishReason = choice?.finish_reason ?? null;
  return {
    text: text && text.length > 0 ? text : null,
    finishReason,
    usage: normalizeUsage(obj.usage),
    modelVersion: obj.model ?? null,
    responseId: obj.id ?? null,
    raw: obj,
  };
}

function parseFinalResponse(body: string): Partial<ParsedEvent> {
  try {
    const obj = JSON.parse(body);
    const choice = obj.choices?.[0];
    return {
      text: typeof choice?.message?.content === 'string' ? choice.message.content : null,
      finishReason: choice?.finish_reason ?? null,
      usage: normalizeUsage(obj.usage),
      modelVersion: obj.model ?? null,
      responseId: obj.id ?? null,
      raw: obj,
    };
  } catch {
    return {};
  }
}

export const openai: ProviderAdapter = {
  name: 'openai',
  apiVersion: 'v1',
  buildRequest,
  parseStreamEvent,
  parseFinalResponse,
};
