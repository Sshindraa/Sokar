import { describe, it, expect, afterAll, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';

// Mock telnyx guard — bypass signature verification in tests
vi.mock('../telnyx.guard', () => ({
  telnyxWebhookGuard: vi.fn(async (_req: any, _reply: any) => {
    // No-op: always pass in tests
  }),
}));

const SAMPLE_RESTAURANT = {
  id: 'rest-1',
  name: 'Chez Test',
  phoneNumber: 'pn-test',
  managerPhone: '+336****0000',
  managerEmail: 'manager@test.fr',
  openingHours: {
    mon: { open: '12:00', close: '14:30' },
    tue: { open: '12:00', close: '14:30' },
    wed: { open: '12:00', close: '14:30' },
    thu: { open: '12:00', close: '14:30' },
    fri: { open: '12:00', close: '14:30' },
    sat: { open: '19:00', close: '23:00' },
    sun: null,
  },
  personality: null,
};

describe('Voice Pipeline — Function Calls', () => {
  it.skip('POST /voice/telnyx/function-call avec createReservation devrait retourner une confirmation', async () => {
    // OBSOLETE: Cette route n'existe plus depuis le refactor WebSocket
    // L'architecture voice utilise maintenant WebSocket et media stream
    // au lieu de REST endpoints pour les function calls
  });

  it.skip('POST /voice/telnyx/function-call avec une fonction inconnue devrait retourner 400', async () => {
    // OBSOLETE: Cette route n'existe plus depuis le refactor WebSocket
    // L'architecture voice utilise maintenant WebSocket et media stream
    // au lieu de REST endpoints pour les function calls
  });
});

afterAll(async () => {
  await closeApp();
});
