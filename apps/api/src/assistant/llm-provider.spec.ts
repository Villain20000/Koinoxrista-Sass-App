import {
  AnthropicLlmProvider,
  ConsoleLlmProvider,
  OpenAiCompatibleProvider,
  OpenAiLlmProvider,
  createLlmProvider,
} from './llm-provider';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function stubFetch(resolver: (url: string, init?: RequestInit) => Promise<unknown>) {
  const mock = jest.fn<Promise<unknown>, [string, RequestInit?]>(resolver);
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('createLlmProvider', () => {
  it('uses the console mock when nothing is configured', () => {
    process.env.OPENAI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LLM_API_URL = '';
    expect(createLlmProvider()).toBeInstanceOf(ConsoleLlmProvider);
  });

  it('auto-picks a fully-configured native provider', () => {
    process.env.ANTHROPIC_API_KEY = 'ak-test';
    expect(createLlmProvider()).toBeInstanceOf(AnthropicLlmProvider);
  });

  it('auto-picks OpenAI when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.LLM_API_URL = '';
    expect(createLlmProvider()).toBeInstanceOf(OpenAiLlmProvider);
  });

  it('falls back to console when an explicit provider is missing its key', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = '';
    expect(createLlmProvider()).toBeInstanceOf(ConsoleLlmProvider);
  });

  it('honors an explicit anthropic selection', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'ak-test';
    expect(createLlmProvider()).toBeInstanceOf(AnthropicLlmProvider);
  });
});

describe('OpenAiLlmProvider', () => {
  it('posts chat completions and extracts the assistant message', async () => {
    const fetchMock = stubFetch(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: ' 回答です。' } }] }),
    }));

    const provider = new OpenAiLlmProvider('sk-test', 'gpt-4o-mini');
    const out = await provider.complete('sys', 'user question');

    expect(out).toBe('回答です。');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0].content).toBe('sys');
  });

  it('throws a clear error on a non-2xx response', async () => {
    stubFetch(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));
    const provider = new OpenAiLlmProvider('sk-test', 'gpt-4o-mini');
    await expect(provider.complete('sys', 'q')).rejects.toThrow(/failed \(429\)/);
  });

  it('throws when the response is empty', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ choices: [] }) }));
    const provider = new OpenAiLlmProvider('sk-test', 'gpt-4o-mini');
    await expect(provider.complete('sys', 'q')).rejects.toThrow(/empty/);
  });
});

describe('AnthropicLlmProvider', () => {
  it('posts to the Messages API using x-api-key and joins text blocks', async () => {
    const fetchMock = stubFetch(async () => ({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'part one' },
          { type: 'tool_use', id: 't' },
          { type: 'text', text: 'part two' },
        ],
      }),
    }));

    const provider = new AnthropicLlmProvider('ak-test', 'claude-3-5-sonnet');
    const out = await provider.complete('sys', 'user question');

    expect(out).toBe('part one\npart two');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('ak-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body));
    expect(body.system).toBe('sys');
    expect(body.messages[0].content).toBe('user question');
  });

  it('propagates a non-2xx response as a clear error', async () => {
    stubFetch(async () => ({ ok: false, status: 401, text: async () => 'no' }));
    const provider = new AnthropicLlmProvider('bad', 'claude-3-5-sonnet');
    await expect(provider.complete('sys', 'q')).rejects.toThrow(/failed \(401\)/);
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('uses the configured URL and extracts content', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'compat' } }] }) }));
    const provider = new OpenAiCompatibleProvider(
      '',
      'local-model',
      'http://localhost:11434/v1/chat/completions',
    );
    await expect(provider.complete('sys', 'q')).resolves.toBe('compat');
  });
});