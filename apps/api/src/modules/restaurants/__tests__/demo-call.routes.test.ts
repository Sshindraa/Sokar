import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

// Mock cartesia-synth pour ne pas dépendre de l'API Cartesia réelle.
// On contrôle isCartesiaConfigured + synthesizeText par test.
vi.mock('../../voice/cartesia-synth', () => ({
  isCartesiaConfigured: vi.fn(() => false),
  synthesizeText: vi.fn(),
  DEFAULT_WEB_FORMAT: { container: 'mp3', encoding: 'mp3', sampleRate: 24000 },
}));

import { isCartesiaConfigured, synthesizeText } from '../../voice/cartesia-synth';

const baseRestaurant = {
  id: 'test-rest-1',
  name: 'Le Bistrot',
  managerPhone: '+33612345678',
  managerEmail: 'restaurant@sokar.tech',
  phoneNumber: '+33123456789',
  personality: { speakingRate: 1.0 },
};

describe('restaurant.routes — POST /restaurant/onboarding/demo-call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCartesiaConfigured).mockReturnValue(false);
    vi.mocked(synthesizeText).mockReset();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('retourne le transcript seul (fallback) quand Cartesia n’est pas configurée', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      baseRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );
    vi.mocked(isCartesiaConfigured).mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/demo-call',
      headers: { authorization: 'Bearer test' },
      payload: { scriptId: 'reservation' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.audio).toBeNull();
    expect(body.fallback).toBe(true);
    expect(body.transcript).toContain('Le Bistrot');
    expect(body.transcript).toMatch(/table pour quatre/i);
    expect(body.scriptId).toBe('reservation');
    expect(synthesizeText).not.toHaveBeenCalled();
  });

  it('retourne un MP3 binaire quand Cartesia est configurée et synthétise avec succès', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      baseRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );
    vi.mocked(isCartesiaConfigured).mockReturnValue(true);
    const fakeMp3 = Buffer.from('fake-mp3-bytes');
    vi.mocked(synthesizeText).mockResolvedValue(fakeMp3);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/demo-call',
      headers: { authorization: 'Bearer test' },
      payload: { scriptId: 'cancellation' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.body).toBe(fakeMp3.toString('binary'));
    expect(synthesizeText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Le Bistrot'),
        speed: 1.0,
      }),
    );
  });

  it('retourne 502 + code CARTESIA_FAILED quand la synthèse throw', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      baseRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );
    vi.mocked(isCartesiaConfigured).mockReturnValue(true);
    vi.mocked(synthesizeText).mockRejectedValue(new Error('Cartesia TTS 503: Service Unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/demo-call',
      headers: { authorization: 'Bearer test' },
      payload: { scriptId: 'menu' },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.code).toBe('CARTESIA_FAILED');
    expect(body.transcript).toContain('Le Bistrot');
  });

  it('utilise le script "reservation" par défaut si scriptId est absent', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      baseRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );
    vi.mocked(isCartesiaConfigured).mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/demo-call',
      headers: { authorization: 'Bearer test' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().scriptId).toBe('reservation');
  });

  it('rejette un scriptId invalide (400 Zod)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/demo-call',
      headers: { authorization: 'Bearer test' },
      payload: { scriptId: 'invalid-script' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('passe la speakingRate du restaurant à synthesizeText', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
      ...baseRestaurant,
      personality: { speakingRate: 1.3 },
    } as any);
    vi.mocked(isCartesiaConfigured).mockReturnValue(true);
    vi.mocked(synthesizeText).mockResolvedValue(Buffer.from('mp3'));

    await app.inject({
      method: 'POST',
      url: '/restaurant/onboarding/demo-call',
      headers: { authorization: 'Bearer test' },
      payload: { scriptId: 'reservation' },
    });

    expect(synthesizeText).toHaveBeenCalledWith(expect.objectContaining({ speed: 1.3 }));
  });
});
