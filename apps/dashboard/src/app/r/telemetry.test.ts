import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
vi.mock('@sentry/nextjs', () => ({ init: vi.fn(), captureRouterTransitionStart: vi.fn() }));
describe('private reservation page telemetry', () => {
  afterEach(() => vi.restoreAllMocks());
  it('disables the SDK on the private fragment-bearing page', async () => {
    window.history.replaceState(null, '', '/r#private-fixture');
    await import('../../../instrumentation-client');
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
