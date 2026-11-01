/**
 * Horloge de référence du banc du Companion et du seed de test : 31 octobre 2026, 12 h à Paris.
 * Le banc et le seed la lisent à la place de l'heure réelle, pour que leurs chiffres ne bougent pas
 * avec le calendrier. La production ne l'utilise pas : elle passe l'heure courante.
 */
export const COMPANION_REFERENCE_NOW = new Date('2026-10-31T11:00:00Z');
