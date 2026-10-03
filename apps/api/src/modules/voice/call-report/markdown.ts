/** Version lisible du rapport d'un appel (Markdown), dérivée du JSON. */
import type { CallReport } from './types';

const sec = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(2)} s`;
const cell = (text: string | null | undefined): string =>
  clip((text ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim(), 220) || '—';
const clip = (text: string, max = 160): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const quote = (text: string): string => `« ${clip(text)} »`;

const CAUSES: Record<string, string> = {
  judge_incomplete: 'verdict « inachevé » du juge',
  spelling_pause: "pause d'épellation",
  guard: 'garde-fou',
  second_pass: 'second passage',
  stt_endpointing: 'fin de tour (transcription)',
  model_latency: 'délai du modèle',
  tts_latency: 'délai de la synthèse',
  unknown: 'cause non identifiée',
  unknown_no_logs: 'journaux indisponibles',
};

const OWNERS: Record<string, string> = {
  agent_owed: "attente de l'appelant avant la réponse",
  caller_owed: "l'agent attend l'appelant",
  agent_pause: "pause de l'agent dans sa réponse",
  caller_pause: "pause de l'appelant dans sa parole",
};

const KINDS: Record<string, string> = {
  isolated_letters: 'lettres isolées',
  number: 'nombre',
  number_form: 'forme du nombre',
  word: 'mot',
};

const AGREEMENTS: Record<string, string> = {
  engine_differs: "l'oreille après coup diffère",
  engines_agree_against_live: 'les deux oreilles après coup contre le direct',
  one_engine_differs: 'une oreille diffère, les deux autres concordent',
  all_differ: 'les trois entendent des choses différentes',
};

export function renderMarkdown(report: CallReport): string {
  const lines: string[] = [];
  const id = report.call.id.slice(0, 8);
  lines.push(
    `# Appel ${id} — rapport automatique`,
    '',
    `Créé ${report.call.createdAt} · durée ${report.call.durationSec ?? '—'} s · issue ${report.call.outcome ?? '—'} · ` +
      `coût des transcriptions ≈ ${report.costUsd.toFixed(4)} $ · journaux : ${report.logs.status}`,
    '',
  );
  if (report.limits.length > 0) {
    lines.push('**Limites de ce rapport**', '', ...report.limits.map((limit) => `- ${limit}`), '');
  }

  lines.push('## Synthèse', '', report.summary.oneLine, '');
  for (const issue of report.summary.issues.slice(0, 3)) {
    lines.push(`- (${issue.score}) ${issue.title}${issue.evidence ? ` — ${issue.evidence}` : ''}`);
  }
  if (report.summary.issues.length > 3) {
    lines.push(
      `- … et ${report.summary.issues.length - 3} autre(s) point(s) plus faibles dans le JSON.`,
    );
  }

  lines.push(
    '',
    '## Chronologie',
    '',
    "Délai = fin de parole de l'appelant → première voix de l'agent, mesuré sur les pistes (entre parenthèses : le journal).",
    '',
    '| # | Direct | Après coup (Nova-3 / Whisper) | `say` du modèle | Envoyé à la voix | Entendu côté agent | Délai |',
    '|---|---|---|---|---|---|---|',
  );
  for (const turn of report.timeline) {
    const heard = [turn.callerHeard.nova, turn.callerHeard.whisper]
      .map((text) => cell(text))
      .join(' / ');
    const delay =
      turn.responseDelaySec === null
        ? '—'
        : `${turn.responseDelaySec.toFixed(2)} s${turn.logDelayMs !== null ? ` (${(turn.logDelayMs / 1000).toFixed(2)})` : ''}`;
    lines.push(
      `| ${turn.sequence} | ${cell(turn.callerLive)} | ${heard} | ${cell(turn.modelSay)} | ${cell(turn.agentSent)} | ${cell(turn.agentHeard)} | ${delay} |`,
    );
  }

  lines.push(
    '',
    "## L'oreille",
    '',
    'Direct contre transcription après coup de la piste appelant.',
    '',
  );
  if (report.ears.length === 0) lines.push('Aucune divergence.');
  for (const item of [...report.ears].sort((a, b) => rank(a.severity) - rank(b.severity))) {
    const engines = Object.entries(item.engines)
      .map(([name, text]) => `${name} ${quote(text ?? '')}`)
      .join(', ');
    lines.push(
      `- **${KINDS[item.kind]}** (${item.severity}${item.strong ? ', signal fort' : ''}) à ${sec(item.atSec)}, tour ${item.turnId?.slice(0, 8) ?? '?'} : ` +
        `direct ${quote(item.live)} ; ${engines} — ${AGREEMENTS[item.agreement]}`,
    );
  }

  lines.push('', '## La bouche', '', 'Texte envoyé à la synthèse vocale contre piste agent.', '');
  if (report.mouth.length === 0) lines.push('Aucun écart.');
  for (const item of [...report.mouth].sort((a, b) => rank(a.severity) - rank(b.severity))) {
    lines.push(
      `- **${KINDS[item.kind]}** (${item.severity}${item.cutByInterruption ? ', réplique coupée' : ''}) à ${sec(item.atSec)}, tour ${item.turnId?.slice(0, 8) ?? '?'} : ` +
        `envoyé ${quote(item.live)} ; entendu ${quote(item.engines.nova ?? '')}`,
    );
  }

  lines.push(
    '',
    '## Silences',
    '',
    'Silences perçus de plus de 1,5 s (aucune des deux pistes ne parle).',
    '',
  );
  if (report.silences.length === 0) lines.push('Aucun.');
  for (const item of report.silences) {
    lines.push(
      `- ${sec(item.startSec)} → ${sec(item.endSec)} (**${item.durationSec.toFixed(2)} s**, ${OWNERS[item.owner]})` +
        (item.cause
          ? ` — ${CAUSES[item.cause] ?? item.cause}${item.detail ? ` : ${item.detail}` : ''}`
          : ''),
    );
  }

  lines.push('', '## Tours de parole', '');
  const { unfinished, overlaps, interruptions } = report.turnTaking;
  lines.push('**Verdicts « inachevé »**', '');
  if (unfinished.length === 0) lines.push('Aucun.');
  for (const item of unfinished) {
    lines.push(
      `- tour ${item.turnId.slice(0, 8)} ${quote(item.callerText)} : ${item.callerResumed ? "l'appelant a repris" : "l'appelant n'a pas repris"}` +
        (item.waitedSec !== null
          ? `, attente ${item.waitedSec.toFixed(2)} s`
          : ', pas de réponse de l’agent'),
    );
  }
  lines.push('', '**Chevauchements de plus de 300 ms**', '');
  if (overlaps.length === 0) lines.push('Aucun.');
  for (const item of overlaps) {
    lines.push(
      `- ${sec(item.startSec)} (${item.durationSec.toFixed(2)} s) : ${item.interrupter === 'agent' ? "l'agent parle sur l'appelant" : "l'appelant parle sur l'agent"}`,
    );
  }
  lines.push('', '**Épellations coupées en plusieurs tours**', '');
  if (report.turnTaking.splitSpellings.length === 0) lines.push('Aucune.');
  for (const spelling of report.turnTaking.splitSpellings) {
    lines.push(
      `- ${spelling.texts.map(quote).join(' → ')} (tours ${spelling.turnIds.map((id) => id.slice(0, 8)).join(', ')})`,
    );
  }
  lines.push('', "**Ré-épellations identiques après relecture (erreur d'oreille probable)**", '');
  if (report.turnTaking.identicalRespellings.length === 0) lines.push('Aucune.');
  for (const respelling of report.turnTaking.identicalRespellings) {
    lines.push(
      `- « ${respelling.letters.join(' ')} » : relecture ${quote(respelling.readbackText)} (tour ${respelling.readbackTurnId.slice(0, 8)}), puis épelé de nouveau à l'identique (tours ${respelling.secondTurnIds.map((id) => id.slice(0, 8)).join(', ')})`,
    );
  }
  lines.push('', '**Interruptions**', '');
  if (interruptions.length === 0) lines.push('Aucune.');
  for (const item of interruptions) {
    const kind = {
      real: 'réelle',
      echo: "déclenchée par l'écho",
      unconfirmed: 'non confirmée (pas de voix appelant)',
    }[item.kind];
    lines.push(
      `- ${sec(item.atSec)}, tour ${item.turnId.slice(0, 8)} : ${kind}${item.callerText ? ` ${quote(item.callerText)}` : ''}`,
    );
  }

  lines.push('', '## Garde-fous', '');
  if (report.guards.length === 0) lines.push('Aucun déclenchement.');
  for (const guard of report.guards) {
    lines.push(
      `- ${guard.type}${guard.detail ? ` (${guard.detail})` : ''}, tour ${guard.turnId.slice(0, 8)} : ${quote(guard.text)}`,
    );
  }
  if (report.counters.noCallerVoice > 0) {
    lines.push(
      `- transcriptions ignorées faute de voix de l'appelant : ${report.counters.noCallerVoice}`,
    );
  }

  lines.push(
    '',
    '## Issue',
    '',
    `Résultat : ${report.outcome.result ?? '—'}${report.outcome.abandoned ? ' — **appel abandonné**' : ''}`,
  );
  if (report.outcome.lastExchanges.length > 0) {
    lines.push('', 'Derniers échanges :', '');
    for (const exchange of report.outcome.lastExchanges) {
      lines.push(
        `- appelant ${quote(exchange.callerText)} → agent ${quote(exchange.agentText ?? '…')}`,
      );
    }
  }
  lines.push(
    '',
    `Horloge des journaux : décalage ${report.clock.offsetSec ?? '—'} s (calé sur ${report.clock.calibratedOnTurns} tour(s)).`,
    '',
  );
  return lines.join('\n');
}

const rank = (severity: string): number => ({ high: 0, medium: 1, low: 2 })[severity] ?? 3;
