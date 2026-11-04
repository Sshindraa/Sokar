import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Les lectures échouent : seul le nombre d'appels compte ici, pas le rendu du planning.
const get = vi.fn(() => Promise.reject(new Error('offline')));
const api = { get, patch: vi.fn() };
vi.mock('@/lib/api', () => ({ useApi: () => api }));

import { PlanningTab } from './PlanningTab';

let hidden = false;

function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  get.mockClear();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.useRealTimers();
});

const READS_PER_LOAD = 3;

it('ne relit pas le planning quand l’onglet est ouvert en arrière-plan', async () => {
  hidden = true;
  render(<PlanningTab orgId="rest-1" />);
  await act(async () => undefined);
  expect(get).toHaveBeenCalledTimes(READS_PER_LOAD);

  await act(async () => vi.advanceTimersByTime(90_000));
  expect(get).toHaveBeenCalledTimes(READS_PER_LOAD);

  // Retour au premier plan : relecture immédiate, puis toutes les 30 s.
  await act(async () => setHidden(false));
  expect(get).toHaveBeenCalledTimes(2 * READS_PER_LOAD);
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(get).toHaveBeenCalledTimes(3 * READS_PER_LOAD);
});

it('suspend les lectures quand l’onglet passe en arrière-plan', async () => {
  render(<PlanningTab orgId="rest-1" />);
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(get).toHaveBeenCalledTimes(2 * READS_PER_LOAD);

  await act(async () => setHidden(true));
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(get).toHaveBeenCalledTimes(2 * READS_PER_LOAD);
});
