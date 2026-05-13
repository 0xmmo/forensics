export type BuildRequestParams = {
  model: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  streaming: boolean;
  thinkingBudget?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};

export type NormalizedUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  raw?: unknown;
};

export type HttpRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

export type ParsedEvent = {
  text: string | null;
  finishReason: string | null;
  usage: NormalizedUsage | null;
  modelVersion: string | null;
  responseId: string | null;
  raw: unknown;
};

export type ProviderAdapter = {
  name: string;
  apiVersion?: string;
  buildRequest(params: BuildRequestParams): HttpRequest;
  parseStreamEvent(eventBlock: string): ParsedEvent | null;
  parseFinalResponse(body: string): Partial<ParsedEvent>;
};
