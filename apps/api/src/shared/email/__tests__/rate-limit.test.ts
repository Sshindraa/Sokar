import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../rate-limit');
import { waitForResendSlot } from '../rate-limit';

describe('Resend request admission', () => {
  afterEach(() => vi.useRealTimers());

  it('admits an available slot', async () => {
    await expect(waitForResendSlot(async () => 0)).resolves.toBeUndefined();
  });

  it('waits then checks the shared slot again', async () => {
    vi.useFakeTimers();
    const grant = vi.fn().mockResolvedValueOnce(150).mockResolvedValueOnce(0);
    const pending = waitForResendSlot(grant);
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(grant).toHaveBeenCalledTimes(2);
  });

  it('rejects saturation before any provider call can start', async () => {
    await expect(waitForResendSlot(async () => 5_001)).rejects.toMatchObject({
      notificationResult: 'failure_certain',
    });
  });

  it.each([null, undefined, -1, NaN])('rejects an invalid grant %s', async (value) => {
    await expect(waitForResendSlot(async () => value)).rejects.toMatchObject({
      notificationResult: 'failure_certain',
    });
  });

  it('fails closed when coordination is unavailable', async () => {
    await expect(
      waitForResendSlot(async () => {
        throw new Error('offline');
      }),
    ).rejects.toMatchObject({
      notificationResult: 'failure_certain',
    });
  });

  it('does not continue after a timed out Redis grant', async () => {
    vi.useFakeTimers();
    let resolve!: (value: number) => void;
    const grant = vi.fn(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const rejected = expect(waitForResendSlot(grant)).rejects.toMatchObject({
      notificationResult: 'failure_certain',
    });
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    resolve(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(grant).toHaveBeenCalledTimes(1);
  });
});
