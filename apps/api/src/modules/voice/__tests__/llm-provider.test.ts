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
  const previousIds = voiceConfig.VOICE_LLM_OPENROUTER_PRIMARY_RESTAURANT_IDS;

  afterEach(() => {
    Object.assign(voiceConfig, { VOICE_LLM_OPENROUTER_PRIMARY_RESTAURANT_IDS: previousIds });
  });

  const withIds = (ids: string | undefined) =>
    Object.assign(voiceConfig, { VOICE_LLM_OPENROUTER_PRIMARY_RESTAURANT_IDS: ids });

  it('`*` envoie tous les restaurants chez OpenRouter, même un restaurant créé après le réglage', () => {
    withIds('*');

    expect(isOpenRouterPrimaryFor('rest-1')).toBe(true);
    expect(isOpenRouterPrimaryFor('nouveau-resto')).toBe(true);
    expect(isOpenRouterPrimaryFor(null)).toBe(false);
    expect(isOpenRouterPrimaryFor(undefined)).toBe(false);
  });

  it('une liste explicite ne vaut que pour les restaurants listés', () => {
    withIds('rest-1,rest-2');

    expect(isOpenRouterPrimaryFor('rest-1')).toBe(true);
    expect(isOpenRouterPrimaryFor('rest-2')).toBe(true);
    expect(isOpenRouterPrimaryFor('rest-3')).toBe(false);
  });

  it('une valeur vide ou absente garde Cerebras en principal partout', () => {
    withIds('');
    expect(isOpenRouterPrimaryFor('rest-1')).toBe(false);

    withIds(undefined);
    expect(isOpenRouterPrimaryFor('rest-1')).toBe(false);
  });

  it('tolère les espaces autour des identifiants et de `*`', () => {
    withIds(' rest-1 , rest-2 ');
    expect(isOpenRouterPrimaryFor('rest-2')).toBe(true);
    expect(isOpenRouterPrimaryFor('rest-3')).toBe(false);

    withIds(' rest-1 ,  * ');
    expect(isOpenRouterPrimaryFor('rest-3')).toBe(true);
  });
});
