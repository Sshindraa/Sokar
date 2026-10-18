import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), eval: vi.fn() }));
vi.mock('ioredis', () => ({
  default: class {
    connect = mocks.connect;
    eval = mocks.eval;
    on() {
      return this;
    }
  },
}));
vi.unmock('../rate-limit');

afterEach(() => vi.unstubAllEnvs());

it('shares startup readiness between simultaneous first requests', async () => {
  vi.stubEnv('RESEND_RATE_LIMIT_REDIS_URL', 'redis://localhost:6379/1');
  let connected!: () => void;
  mocks.connect.mockReturnValue(
    new Promise<void>((resolve) => {
      connected = resolve;
    }),
  );
  mocks.eval.mockResolvedValue(0);
  const { waitForResendSlot } = await import('../rate-limit');
  const requests = [waitForResendSlot(), waitForResendSlot(), waitForResendSlot()];
  expect(mocks.connect).toHaveBeenCalledTimes(1);
  expect(mocks.eval).not.toHaveBeenCalled();
  connected();
  await Promise.all(requests);
  expect(mocks.eval).toHaveBeenCalledTimes(3);
});
