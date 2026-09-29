import { Logger } from '@nestjs/common';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProvider {
  /** Name used for logging/metrics. */
  readonly name: string;
  /**
   * Returns the assistant's answer for the given building-scoped context.
   * Implementations must not leak data across buildings — the context is
   * already filtered by the caller.
   */
  complete(system: string, user: string): Promise<string>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/**
 * Console/offline provider (Feature 17 default). Renders the context so a
 * developer can see exactly what would be sent to a hosted model. Returns a
 * deterministic Greek placeholder so the UI stays functional without keys.
 */
export class ConsoleLlmProvider implements LlmProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleLlmProvider.name);

  async complete(_system: string, user: string): Promise<string> {
    this.logger.log(`[assistant][mock] query: ${user}`);
    // Greek placeholder keeps the UI functional when no local LLM is running.
    // In production with AI_LOCAL_ONLY=true this is never shown — Ollama (Meltemi)
    // answers instead. Message mirrors FEATURE_PLAN.md:17 fallback.
    return (
      'Η απάντηση δεν είναι διαθέσιμη από το τοπικό μοντέλο αυτή τη στιγμή. ' +
      'Δοκιμάστε ξανά ή συμβουλευτείτε τις Ανακοινώσεις του κτιρίου και τη σελίδα FAQ. ' +
      '(Λειτουργία τοπικού AI — τα δεδομένα σας δεν στάλθηκαν εκτός ΕΕ.)'
    );
  }
}

/**
 * Native OpenAI Chat Completions provider.
 * Env: OPENAI_API_KEY (required), OPENAI_MODEL (default gpt-4o-mini),
 * OPENAI_BASE_URL (optional; e.g. an OpenAI-compatible gateway or Azure URL).
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiLlmProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const messages: LlmMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`OpenAI request failed (${res.status}): ${detail}`);
      throw new Error(`OpenAI request failed (${res.status})`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      throw new Error('OpenAI returned an empty response');
    }
    return text;
  }
}

/**
 * Native Anthropic Messages API provider.
 * Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (default
 * claude-3-5-sonnet-20241022).
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicLlmProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = 'https://api.anthropic.com/v1',
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        system,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`Anthropic request failed (${res.status}): ${detail}`);
      throw new Error(`Anthropic request failed (${res.status})`);
    }
    const data = (await res.json()) as {
      content?: { type?: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text as string)
      .join('\n')
      .trim();
    if (!text) {
      throw new Error('Anthropic returned an empty response');
    }
    return text;
  }
}

/**
 * Generic OpenAI-compatible endpoint (self-hosted/one/api/ollama/vLLM gateway).
 * Env: LLM_API_URL (required), LLM_API_KEY, LLM_MODEL.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly url: string,
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      this.logger.warn(`LLM request failed (${res.status})`);
      throw new Error(`LLM request failed (${res.status})`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      throw new Error('LLM returned an empty response');
    }
    return text;
  }
}

export type LlmProviderKind = 'console' | 'openai' | 'anthropic' | 'openai-compatible';

/**
 * Selects a provider from configuration. Explicit `LLM_PROVIDER` wins; when set
 * to `auto` (default) we pick the first fully-configured provider. A requested
 * provider whose key is missing logs a loud warning and falls back to console
 * rather than crashing the module at boot.
 */
export function createLlmProvider(): LlmProvider {
  const logger = new Logger('LlmProvider');
  const explicit = (process.env.LLM_PROVIDER ?? 'auto')
    .toLowerCase()
    .trim() as LlmProviderKind | 'auto';
  const localOnly = (process.env.AI_LOCAL_ONLY ?? '').toLowerCase() === 'true';

  const openaiKey = process.env.OPENAI_API_KEY ?? '';
  const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';

  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  const anthropicModel =
    process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20241022';

  const compatUrl = process.env.LLM_API_URL ?? '';
  const compatKey = process.env.LLM_API_KEY ?? '';
  const compatModel = process.env.LLM_MODEL ?? 'meltemi:7b';

  const pick = (): LlmProvider => {
    if (localOnly) {
      if (compatUrl) return new OpenAiCompatibleProvider(compatKey, compatModel, compatUrl);
      logger.log('AI_LOCAL_ONLY=true — hosted LLM disabled, using console/local fallback');
      return new ConsoleLlmProvider();
    }
    if (anthropicKey) return new AnthropicLlmProvider(anthropicKey, anthropicModel);
    if (openaiKey) return new OpenAiLlmProvider(openaiKey, openaiModel, openaiBaseUrl);
    if (compatUrl) return new OpenAiCompatibleProvider(compatKey, compatModel, compatUrl);
    return new ConsoleLlmProvider();
  };

  switch (explicit) {
    case 'console':
      return new ConsoleLlmProvider();
    case 'openai':
      if (localOnly) {
        logger.warn('AI_LOCAL_ONLY=true — hosted openai disabled, using local/console');
        return compatUrl ? new OpenAiCompatibleProvider(compatKey, compatModel, compatUrl) : new ConsoleLlmProvider();
      }
      if (openaiKey) return new OpenAiLlmProvider(openaiKey, openaiModel, openaiBaseUrl);
      logger.warn('LLM_PROVIDER=openai but OPENAI_API_KEY is missing; using console mock');
      return new ConsoleLlmProvider();
    case 'anthropic':
      if (localOnly) {
        logger.warn('AI_LOCAL_ONLY=true — hosted anthropic disabled, using local/console');
        return compatUrl ? new OpenAiCompatibleProvider(compatKey, compatModel, compatUrl) : new ConsoleLlmProvider();
      }
      if (anthropicKey) {
        return new AnthropicLlmProvider(anthropicKey, anthropicModel);
      }
      logger.warn('LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing; using console mock');
      return new ConsoleLlmProvider();
    case 'openai-compatible':
      if (compatUrl) return new OpenAiCompatibleProvider(compatKey, compatModel, compatUrl);
      logger.warn('LLM_PROVIDER=openai-compatible but LLM_API_URL is missing; using console mock');
      return new ConsoleLlmProvider();
    case 'auto':
    default:
      return pick();
  }
}