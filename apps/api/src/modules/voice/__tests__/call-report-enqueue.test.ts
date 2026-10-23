import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}));

import { enqueueCallReport } from '../call-report/job-runtime';

describe('enqueueCallReport', () => {
  it('met la tâche en file avec une seule tentative et un identifiant stable', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    await enqueueCallReport('leg-1', { add });
    expect(add).toHaveBeenCalledWith(
      'build-call-report',
      { callLegId: 'leg-1' },
      expect.objectContaining({ attempts: 1, jobId: 'telnyx_build-call-report_leg-1' }),
    );
  });

  it("n'échoue jamais, même quand la file est indisponible", async () => {
    const add = vi.fn().mockRejectedValue(new Error('redis down'));
    await expect(enqueueCallReport('leg-1', { add })).resolves.toBeUndefined();
  });
});
