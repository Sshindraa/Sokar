/**
 * Les problèmes les plus graves d'un appel, classés. Le barème est explicite : un écart sur une lettre
 * ou un nombre dans ce que l'agent a dit (ou ce que le direct a compris de travers) passe avant un
 * silence, qui passe avant un chevauchement.
 */
import type { Guard } from './guards';
import type { SplitSpelling } from './spelling';
import type { Overlap, UnfinishedVerdict } from './turn-taking';
import type {
  EarsReport,
  InterruptionReport,
  Issue,
  MouthDivergence,
  SilenceReport,
} from './types';

export interface IssueParts {
  mouth: readonly MouthDivergence[];
  ears: readonly EarsReport[];
  silences: readonly SilenceReport[];
  unfinished: readonly UnfinishedVerdict[];
  overlaps: readonly Overlap[];
  interruptions: readonly InterruptionReport[];
  guards: readonly Guard[];
  splitSpellings: readonly SplitSpelling[];
  outcome: {
    result: string | null;
    abandoned: boolean;
    lastExchanges: ReadonlyArray<{ callerText: string; agentText: string | null }>;
  };
}

const EXCERPT_MAX = 70;
/** Extrait lisible : le texte entier reste dans le JSON, les titres n'en gardent que le début. */
const clip = (text: string): string =>
  text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text;
const quote = (text: string): string => `« ${clip(text)} »`;
const engineText = (item: { engines: Partial<Record<string, string>> }): string =>
  Object.values(item.engines).find(Boolean) ?? '';

export function rankIssues(parts: IssueParts): Issue[] {
  const issues: Issue[] = [];

  for (const item of parts.mouth) {
    if (item.cutByInterruption || item.severity !== 'high') continue;
    issues.push({
      kind: item.kind === 'number' ? 'mouth_number' : 'mouth_isolated_letters',
      score: item.kind === 'number' ? 95 : 100,
      title: `Prononciation : ${quote(item.live)} a été dit ${quote(engineText(item))}`,
      evidence: 'texte envoyé à la synthèse vocale comparé à la piste agent',
      turnId: item.turnId,
      atSec: item.atSec,
    });
  }

  for (const item of parts.ears) {
    if (item.severity !== 'high') continue;
    const heard = Object.entries(item.engines)
      .filter(([name]) => item.differing.includes(name as 'nova' | 'whisper'))
      .map(([name, text]) => (text ? `${name} ${quote(text)}` : `${name} (rien)`))
      .join(', ');
    const liveWrong = item.agreement === 'engines_agree_against_live';
    issues.push({
      kind: liveWrong ? 'ears_live_wrong' : 'ears_strong',
      score: item.strong ? 95 : liveWrong ? 90 : 80,
      title: `Compréhension : le direct a entendu ${quote(item.live)}, après coup ${heard}`,
      evidence: `${
        item.strong
          ? 'les deux oreilles après coup se contredisent sur une lettre ou un nombre'
          : liveWrong
            ? 'les deux oreilles après coup entendent la même chose, contre le direct'
            : 'une oreille après coup diffère du direct'
      }${item.duringInterruption ? ' ; pendant une interruption' : ''}`,
      turnId: item.turnId,
      atSec: item.atSec,
    });
  }

  const falseUnfinished = new Set(
    parts.unfinished.filter((verdict) => !verdict.callerResumed).map((verdict) => verdict.turnId),
  );
  for (const silence of parts.silences) {
    if (silence.owner !== 'agent_owed' || silence.durationSec < 1.5) continue;
    const isFalseVerdict =
      silence.cause === 'judge_incomplete' &&
      silence.turnId !== null &&
      falseUnfinished.has(silence.turnId);
    if (isFalseVerdict) {
      issues.push({
        kind: 'silence_false_unfinished',
        score: 88,
        title: `Silence de ${silence.durationSec.toFixed(2)} s après un verdict « inachevé » : l'appelant n'a pas repris`,
        evidence: silence.detail ?? '',
        turnId: silence.turnId,
        atSec: silence.startSec,
      });
    } else if (silence.durationSec >= 2) {
      issues.push({
        kind: 'silence_long',
        score: Math.min(80, 60 + Math.round((silence.durationSec - 2) * 5)),
        title: `Silence de ${silence.durationSec.toFixed(2)} s avant la réponse de l'agent`,
        evidence: `${silence.cause ?? 'cause inconnue'}${silence.detail ? ` — ${silence.detail}` : ''}`,
        turnId: silence.turnId,
        atSec: silence.startSec,
      });
    } else {
      issues.push({
        kind: 'silence_long',
        score: 35,
        title: `Silence de ${silence.durationSec.toFixed(2)} s avant la réponse de l'agent`,
        evidence: `${silence.cause ?? 'cause inconnue'}${silence.detail ? ` — ${silence.detail}` : ''}`,
        turnId: silence.turnId,
        atSec: silence.startSec,
      });
    }
  }

  if (parts.outcome.abandoned) {
    const [previous, last] = parts.outcome.lastExchanges.slice(-2);
    const trail = [previous, last]
      .filter((exchange): exchange is { callerText: string; agentText: string | null } =>
        Boolean(exchange),
      )
      .map((exchange) => `${quote(exchange.callerText)} → ${quote(exchange.agentText ?? '…')}`)
      .join(' puis ');
    issues.push({
      kind: 'abandoned',
      score: 70,
      title: `Appel sans réservation (${parts.outcome.result ?? 'issue inconnue'})${last ? ` après ${quote(last.callerText)}` : ''}`,
      evidence: trail ? `derniers échanges : ${trail}` : 'sans issue',
      turnId: null,
      atSec: null,
    });
  }

  for (const spelling of parts.splitSpellings) {
    issues.push({
      kind: 'spelling_split',
      score: 75,
      title: `Épellation coupée en ${spelling.turnIds.length} tours : ${spelling.texts.map(quote).join(' → ')}`,
      evidence: 'une lettre peut se perdre ou se recoller entre deux fragments',
      turnId: spelling.turnIds[0],
      atSec: null,
    });
  }

  for (const overlap of parts.overlaps) {
    if (overlap.interrupter !== 'agent') continue;
    issues.push({
      kind: 'agent_over_caller',
      score: 55,
      title: `L'agent parle sur l'appelant pendant ${overlap.durationSec.toFixed(2)} s`,
      evidence: `à ${overlap.startSec.toFixed(1)} s`,
      turnId: null,
      atSec: overlap.startSec,
    });
  }
  for (const interruption of parts.interruptions) {
    if (interruption.kind !== 'echo') continue;
    issues.push({
      kind: 'interruption_echo',
      score: 58,
      title: "Interruption déclenchée par l'écho de l'agent",
      evidence: interruption.callerText ? quote(interruption.callerText) : '',
      turnId: interruption.turnId,
      atSec: interruption.atSec,
    });
  }
  for (const guard of parts.guards) {
    if (guard.type === 'echo_stripped') {
      issues.push({
        kind: 'echo_stripped_words',
        score: 62,
        title: `Le filtre d'écho a retiré des mots de l'appelant : ${quote(guard.text)}`,
        evidence: '',
        turnId: guard.turnId,
        atSec: null,
      });
    } else if (guard.type === 'spelled_name_mismatch') {
      issues.push({
        kind: 'guard_name_refused',
        score: 50,
        title: `Relecture du nom refusée : ${quote(guard.text)}`,
        evidence: '',
        turnId: guard.turnId,
        atSec: null,
      });
    }
  }

  return issues.sort((a, b) => b.score - a.score || (a.atSec ?? Infinity) - (b.atSec ?? Infinity));
}

export function oneLineSummary(issues: readonly Issue[]): string {
  if (issues.length === 0) return 'Aucun problème détecté.';
  return issues
    .slice(0, 3)
    .map((issue, index) => `${index + 1}) ${issue.title}`)
    .join(' ; ');
}
