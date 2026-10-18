/**
 * Identité de l'assistant au téléphone. L'appelant doit savoir dès le décroché qu'il parle à une IA
 * (règlement européen sur l'IA, article 50, applicable depuis le 2 août 2026) : l'accueil le dit,
 * et l'assistant le confirme si on le lui demande. Le prénom suit la voix actuelle, féminine.
 */
export const AGENT_NAME = 'Léa';
export const AGENT_TITLE = "l'assistante IA";

/** Accueil fixe, court : le nom du restaurant, le prénom, l'annonce IA. */
export function buildFixedGreeting(restaurantName: string): string {
  return `Bonjour, ici ${restaurantName}, je suis ${AGENT_NAME}, ${AGENT_TITLE}. Je vous écoute.`;
}
