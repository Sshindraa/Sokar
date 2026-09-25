import { describe, expect, it } from 'vitest';
import { filterAssistantEcho, hasBargeInWordThreshold } from '../stream/assistant-echo';
import type { CallSession } from '../stream/types';

function makeSession(): CallSession {
  return {
    recentAgentSpeechText: 'Avec plaisir. Pour combien de personnes souhaitez-vous réserver ?',
    agentAudioActive: true,
  } as CallSession;
}

describe('assistant echo suppression', () => {
  it('suppresses a transcript contained in currently playing agent speech', () => {
    const result = filterAssistantEcho(
      makeSession(),
      'Avec plaisir, pour combien de personnes',
      'partial',
    );

    expect(result).toMatchObject({ suppressed: true, transcript: '' });
  });

  it('strips the echoed prefix and retains caller words', () => {
    const result = filterAssistantEcho(
      makeSession(),
      'Avec plaisir pour combien de personnes allô bonjour',
      'committed',
    );

    expect(result).toMatchObject({
      suppressed: false,
      strippedPrefix: true,
      transcript: 'allô bonjour',
      nonEchoWordCount: 2,
    });
    expect(hasBargeInWordThreshold(result)).toBe(true);
  });

  it('does not suppress after the one-second echo window', () => {
    const session = makeSession();
    session.agentAudioActive = false;
    session.agentAudioEndedAt = 1_000;

    expect(
      filterAssistantEcho(session, 'Pour combien de personnes', 'committed', 2_001),
    ).toMatchObject({
      suppressed: false,
      transcript: 'Pour combien de personnes',
    });
  });
});
