/**
 * Ce que l'appelant a réellement entendu d'une réponse qu'il a coupée. Le modèle génère sa
 * réponse en ~1 s, la voix la dit en plusieurs secondes : au barge-in, l'historique contient
 * donc toute la phrase alors que l'appelant n'en a entendu que le début. L'audio est envoyé à
 * Telnyx au rythme du temps réel : les trames envoyées mesurent ce qui a été joué.
 */

/** Tampon Telnyx et réseau : l'audio « envoyé » est joué un peu plus tard. */
const PLAYBACK_LAG_MS = 200;
/** Débit de parole de repli tant que la durée totale de la réponse n'est pas connue. */
const FALLBACK_CHARS_PER_SECOND = 14;

export interface InterruptedReply {
  /** Réponse complète, telle que poussée à la synthèse. */
  said: string;
  heard: string;
  unheard: string;
}

export function splitHeardReply(
  said: string,
  playedMs: number,
  totalMs: number | null,
): InterruptedReply {
  const text = said.trim();
  // Toutes les trames sont parties : au plus le tampon Telnyx restait à jouer, l'appelant a tout entendu.
  if (totalMs !== null && playedMs >= totalMs) return { said: text, heard: text, unheard: '' };
  const charsPerSecond = totalMs && totalMs > 0 ? (text.length / totalMs) * 1000 : null;
  const heardChars = Math.floor(
    (Math.max(0, playedMs - PLAYBACK_LAG_MS) / 1000) *
      (charsPerSecond ?? FALLBACK_CHARS_PER_SECOND),
  );
  if (heardChars >= text.length) return { said: text, heard: text, unheard: '' };
  // Coupe sur une frontière de mot : « entendu » ne contient jamais la moitié d'un mot.
  const cut = heardChars <= 0 ? 0 : Math.max(0, text.lastIndexOf(' ', heardChars));
  return { said: text, heard: text.slice(0, cut).trim(), unheard: text.slice(cut).trim() };
}

/** Fin du contenu de la réponse : ce qui précède son dernier segment (la question de clôture). */
function contentEnd(text: string): number {
  let end = 0;
  for (const match of text.matchAll(/[.,;:!?…]\s+/gu)) {
    const punctuationEnd = (match.index ?? 0) + 1;
    if (punctuationEnd + match[0].length - 1 < text.length) end = punctuationEnd;
  }
  return end;
}

/**
 * Le contenu de la réponse (avant sa question de clôture) n'a pas été entendu en entier.
 * Pour un récapitulatif, un « oui » ne confirme alors pas ce que l'appelant n'a pas entendu.
 */
export function replyContentNotFullyHeard(reply: InterruptedReply): boolean {
  return reply.unheard !== '' && reply.heard.length < contentEnd(reply.said);
}
