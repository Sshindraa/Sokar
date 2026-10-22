import { afterEach, describe, expect, it } from 'vitest';
import { voiceConfig } from '../../../env';
import {
  getVoiceLlmModel,
  getVoiceLlmProvider,
  getVoiceLlmRuntimeInfo,
  isOpenRouterPrimaryFor,
} from '../llm-provider';

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
    expect(runtime.provider).toBe('cerebras');
    expect(runtime.openrouterUsed).toBe(false);
  });

  it('distingue une clé OpenRouter configurée de son utilisation vocale', () => {
    process.env.OPENROUTER_API_KEY = 'set';

    expect(getVoiceLlmRuntimeInfo()).toMatchObject({
      openrouterKeyConfigured: true,
      openrouterUsed: false,
      provider: 'cerebras',
    });
  });
});

describe('isOpenRouterPrimaryFor', () => {
  const previousKey = voiceConfig.OPENROUTER_API_KEY;

  afterEach(() => {
    Object.assign(voiceConfig, { OPENROUTER_API_KEY: previousKey });
  });

  it('GPT-6 Luna en principal pour tout restaurant dès que la clé OpenRouter est présente', () => {
    Object.assign(voiceConfig, { OPENROUTER_API_KEY: ['test', 'openrouter', 'key'].join('-') });

    expect(isOpenRouterPrimaryFor('rest-1')).toBe(true);
    expect(isOpenRouterPrimaryFor('nouveau-resto')).toBe(true);
    expect(isOpenRouterPrimaryFor(null)).toBe(false);
    expect(isOpenRouterPrimaryFor(undefined)).toBe(false);
  });

  it('sans clé OpenRouter, Cerebras reste en principal', () => {
    Object.assign(voiceConfig, { OPENROUTER_API_KEY: ' ' });
    expect(isOpenRouterPrimaryFor('rest-1')).toBe(false);
  });
});
