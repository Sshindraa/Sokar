import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_DRAFT_KEY,
  isCampaignDraft,
  storeCampaignDraft,
  takeCampaignDraft,
} from './campaign-draft';

const DRAFT = {
  channel: 'SMS' as const,
  name: 'Relance midi',
  objective: 'Remplir le service',
  body: 'Bonjour, il reste des tables ce midi. {{unsubscribeUrl}}',
};

describe('brouillon de relance', () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('accepte un brouillon SMS, et un e-mail avec objet ; refuse une forme incomplète', () => {
    expect(isCampaignDraft(DRAFT)).toBe(true);
    expect(isCampaignDraft({ ...DRAFT, channel: 'EMAIL', subject: 'Votre table' })).toBe(true);
    expect(isCampaignDraft({ ...DRAFT, channel: 'FAX' })).toBe(false);
    expect(isCampaignDraft({ ...DRAFT, body: 12 })).toBe(false);
    expect(isCampaignDraft(null)).toBe(false);
  });

  it('se reprend une seule fois depuis la session, sans passer par l’URL', () => {
    storeCampaignDraft(DRAFT);
    expect(takeCampaignDraft()).toEqual(DRAFT);
    expect(window.sessionStorage.getItem(CAMPAIGN_DRAFT_KEY)).toBeNull();
    expect(takeCampaignDraft()).toBeNull();
  });

  it('ignore une valeur stockée abîmée', () => {
    window.sessionStorage.setItem(CAMPAIGN_DRAFT_KEY, '{pas du json');
    expect(takeCampaignDraft()).toBeNull();
  });

  it('n’échoue pas quand la session refuse le stockage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => storeCampaignDraft(DRAFT)).not.toThrow();
  });
});
