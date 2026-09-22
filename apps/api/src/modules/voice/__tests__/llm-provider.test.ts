import { afterEach, describe, expect, it } from 'vitest';
import { getVoiceLlmModel, getVoiceLlmProvider, getVoiceLlmRuntimeInfo } from '../llm-provider';

describe('voice LLM runtime identity', () => {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  });

  it('expose le provider et le modèle réellement actifs', () => {
    const runtime = getVoiceLlmRuntimeInfo();

    expect(runtime.provider).toBe(getVoiceLlmProvider());
    expect(runtime.model).toBe(getVoiceLlmModel());
    expect(runtime.provider).toBe('groq');
    expect(runtime.openrouterUsed).toBe(false);
  });

  it('distingue une clé OpenRouter configurée de son utilisation vocale', () => {
    process.env.OPENROUTER_API_KEY = 'set';

    expect(getVoiceLlmRuntimeInfo()).toMatchObject({
      openrouterKeyConfigured: true,
      openrouterUsed: false,
      provider: 'groq',
    });
  });
});
