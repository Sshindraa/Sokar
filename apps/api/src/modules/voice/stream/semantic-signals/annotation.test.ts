import { describe, expect, it } from 'vitest';
import { buildAnnotationItems } from './annotation';
import { renderAnnotationPage } from './annotation-page';
import { buildEvalDecisionRequest, buildEvalState } from './eval-request';
import { BEHAVIORS, CHOICE_QUESTIONS } from './behaviors';

const turn = (sequence: number, callerText: string | null, agentText: string | null) => ({
  callId: 'call-1',
  turnId: `turn-${sequence}`,
  sequence,
  callerText,
  agentText,
});

describe('buildAnnotationItems', () => {
  it('builds one item per turn with the caller message last and the agent reply as output', () => {
    const items = buildAnnotationItems(
      [
        turn(2, 'Pour quatre personnes.', 'Très bien, à quelle heure ?'),
        turn(1, 'Bonjour, je voudrais réserver.', 'Pour combien de personnes ?'),
      ],
      6,
    );
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      id: 'call-1:turn-2',
      input: [
        { role: 'user', content: 'Bonjour, je voudrais réserver.' },
        { role: 'assistant', content: 'Pour combien de personnes ?' },
        { role: 'user', content: 'Pour quatre personnes.' },
      ],
      output: { role: 'assistant', content: 'Très bien, à quelle heure ?' },
    });
  });

  it('skips turns without caller speech or agent reply and limits history', () => {
    const items = buildAnnotationItems(
      [
        turn(1, 'Un', 'A'),
        turn(2, 'Deux', 'B'),
        turn(3, null, 'C'),
        turn(4, 'Quatre', null),
        turn(5, 'Cinq', 'E'),
      ],
      1,
    );
    expect(items.map((item) => item.id)).toEqual([
      'call-1:turn-1',
      'call-1:turn-2',
      'call-1:turn-5',
    ]);
    // Historique limité au tour 4, qui n'a pas de réponse d'agent.
    expect(items[2].input).toEqual([
      { role: 'user', content: 'Quatre' },
      { role: 'user', content: 'Cinq' },
    ]);
  });

  it('masks phone numbers and emails', () => {
    const [item] = buildAnnotationItems(
      [turn(1, 'Mon numéro est le 06 12 34 56 78, mail alice@example.com', 'Merci.')],
      6,
    );
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('06 12 34 56 78');
    expect(serialized).not.toContain('alice@example.com');
    expect(item.input[0].content).toBe('Mon numéro est le <PHONE>, mail <EMAIL>');
  });
});

describe('buildEvalDecisionRequest', () => {
  it('asks every noul behavior and every choice question on the span state', () => {
    const example = {
      input: [
        { role: 'assistant' as const, content: 'Je confirme ?' },
        { role: 'user' as const, content: 'Oui.' },
      ],
      output: { role: 'assistant' as const, content: 'C’est noté.' },
    };
    const request = buildEvalDecisionRequest(example, 'typesafe/jev-1.13-20260917');
    expect(request.state).toBe(buildEvalState(example));
    expect(request.state).toBe(
      'Agent : Je confirme ?\nClient : Oui.\nAgent (réponse évaluée) : C’est noté.',
    );
    expect(Object.keys(request.questions).sort()).toEqual(
      [...BEHAVIORS.map((b) => b.id), ...CHOICE_QUESTIONS.map((c) => c.id)].sort(),
    );
  });
});

describe('renderAnnotationPage', () => {
  it('embeds items safely so caller text cannot close the script tag', () => {
    const html = renderAnnotationPage({
      items: [
        {
          id: 'call-1:turn-1',
          input: [{ role: 'user', content: '</script><img src=x onerror=alert(1)>' }],
          output: { role: 'assistant', content: 'Réponse & suite' },
          priority: 1,
        },
      ],
      behaviors: [{ id: 'b', instructions: 'Question ?', present: 'Oui', absent: 'Non' }],
      behaviorSetVersion: 'v-test',
    });
    const scriptBody = html.slice(html.indexOf('const DATA ='));
    expect(scriptBody).not.toContain('</script><img');
    expect(scriptBody).toContain('\\u003c/script\\u003e');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('<html lang="fr">');
  });
});
