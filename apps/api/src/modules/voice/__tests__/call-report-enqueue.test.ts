import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}));

import { enqueueCallReport } from '../call-report/job-runtime';

describe('enqueueCallReport', () => {
  afterEach(() => {
    delete process.env.CALL_REPORT_ENABLED;
  });

  it('ne met rien en file quand la fonction est désactivée (défaut)', async () => {
    const add = vi.fn();
    await enqueueCallReport('leg-1', { add });
    expect(add).not.toHaveBeenCalled();
  });

  it('met la tâche en file avec une seule tentative et un identifiant stable', async () => {
    process.env.CALL_REPORT_ENABLED = 'true';
    const add = vi.fn().mockResolvedValue(undefined);
    await enqueueCallReport('leg-1', { add });
    expect(add).toHaveBeenCalledWith(
      'build-call-report',
      { callLegId: 'leg-1' },
      expect.objectContaining({ attempts: 1, jobId: 'telnyx_build-call-report_leg-1' }),
    );
  });

  it("n'échoue jamais, même quand la file est indisponible", async () => {
    process.env.CALL_REPORT_ENABLED = 'true';
    const add = vi.fn().mockRejectedValue(new Error('redis down'));
    await expect(enqueueCallReport('leg-1', { add })).resolves.toBeUndefined();
  });
});
