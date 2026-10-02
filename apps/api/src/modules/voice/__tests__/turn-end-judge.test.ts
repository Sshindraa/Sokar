import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildJudgeRequest,
  buildJudgeRequests,
  isJudgeCase,
  JUDGE_DRAWS,
  JUDGE_INSTRUCTIONS,
  judgeAsTurn,
  turnCompleteOnly,
} from '../behavior-eval/judge';
import { scoreAll } from '../behavior-eval/score';
import type { BehaviorCasesFile } from '../behavior-eval/types';

const file = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../../scripts/fixtures/voice-behavior/cases.json'),
    'utf8',
  ),
) as BehaviorCasesFile;

describe('juge de fin de tour (prototype de banc)', () => {
  it('ne voit que la dernière question de l’agent et la parole de l’appelant', () => {
    const testCase = file.cases.find((entry) => entry.id === 'attend-annonce-intention')!;
    const request = buildJudgeRequest(testCase, file);
    expect(request.messages).toHaveLength(2);
    const user = String(request.messages[1].content);
    expect(user).toContain(testCase.transcript);
    expect(user).toContain('Vers quelle heure');
    // Pas le reste du dialogue, ni état, calendrier ou règles de réservation.
    expect(user).not.toContain('bonjour je souhaite');
    expect(JSON.stringify(request.messages)).not.toMatch(/ÉTAT VÉRIFIÉ|CALENDRIER|draft|action/);
    expect(request.format.json_schema.schema).toEqual({
      type: 'object',
      properties: { complete: { type: 'boolean' } },
      required: ['complete'],
      additionalProperties: false,
    });
  });

  it('la consigne ne contient ni exemple, ni mot de l’appelant du banc, ni les principes du prompt actuel', () => {
    const spoken = file.cases.map((entry) => entry.transcript).filter(Boolean);
    for (const transcript of spoken) expect(JUDGE_INSTRUCTIONS).not.toContain(transcript);
    expect(JUDGE_INSTRUCTIONS).not.toMatch(/annonce|rejet|nie|réserv|« /iu);
  });

  it('couvre la famille « attente » et ses témoins, aux tirages du plan chiffré', () => {
    const requests = buildJudgeRequests(file);
    const cases = file.cases.filter(isJudgeCase);
    expect(requests.map((request) => request.id)).toEqual(cases.map((entry) => entry.id));
    expect(cases.every((entry) => entry.family === 'attente')).toBe(true);
    const controls = cases.filter((entry) => entry.origin === 'control').length;
    expect(requests.reduce((sum, request) => sum + request.samples, 0)).toBe(
      controls * JUDGE_DRAWS.control + (cases.length - controls) * JUDGE_DRAWS.defect,
    );
  });

  it('se note sur le seul contrôle turnComplete, comme le tour structuré', () => {
    const testCase = file.cases.find((entry) => entry.id === 'repond-reponse-complete')!;
    expect(testCase.checks.length).toBeGreaterThan(1);
    const [only] = [testCase].map(turnCompleteOnly);
    expect(only.checks).toHaveLength(1);
    const raw = {
      model: 'm',
      responses: {
        [testCase.id]: [{ complete: true }, { complete: true }, { complete: false }, null],
      },
    };
    const [result] = scoreAll([only], judgeAsTurn(raw));
    // Une réponse invalide (null) est écartée du taux : 2 réussis sur 3 valides.
    expect(result.valid).toBe(3);
    expect(result.checks[0].rate).toBeCloseTo(2 / 3);
  });
});
