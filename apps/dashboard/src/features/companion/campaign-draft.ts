/** Brouillon de relance rédigé par Companion, à reprendre dans l'éditeur de campagne. Aucun nom ni destinataire. */
export interface CompanionCampaignDraft {
  channel: 'SMS' | 'EMAIL';
  name: string;
  objective: string;
  subject?: string;
  body: string;
}

/** Le brouillon passe par la session du navigateur, jamais par l'URL. */
export const CAMPAIGN_DRAFT_KEY = 'sokar:campaign-draft';

export function isCampaignDraft(value: unknown): value is CompanionCampaignDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<CompanionCampaignDraft>;
  return (
    (draft.channel === 'SMS' || draft.channel === 'EMAIL') &&
    typeof draft.name === 'string' &&
    typeof draft.objective === 'string' &&
    typeof draft.body === 'string' &&
    (draft.subject === undefined || typeof draft.subject === 'string')
  );
}

/** Le stockage peut être refusé : le brouillon n'est alors pas repris, sans erreur affichée. */
export function storeCampaignDraft(draft: CompanionCampaignDraft): void {
  try {
    window.sessionStorage.setItem(CAMPAIGN_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Stockage refusé : l'éditeur s'ouvre vide.
  }
}

/** Lit puis efface le brouillon : il n'est repris qu'une fois. */
export function takeCampaignDraft(): CompanionCampaignDraft | null {
  try {
    const raw = window.sessionStorage.getItem(CAMPAIGN_DRAFT_KEY);
    window.sessionStorage.removeItem(CAMPAIGN_DRAFT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isCampaignDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
