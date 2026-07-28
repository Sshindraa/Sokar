import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import ReservationWidget from './page';
import { getParentOrigin } from './post-message-security';

// ---------------------------------------------------------------------------
// Mocks next/navigation + next/link (le widget embarqué les utilise).
// ---------------------------------------------------------------------------

const navMocks = vi.hoisted(() => {
  let params: Record<string, string> = {};
  let search = '';
  return {
    setParams: (p: Record<string, string>) => {
      params = p;
    },
    setSearch: (s: string) => {
      search = s;
    },
    useParams: () => params,
    useSearchParams: () => new URLSearchParams(search),
  };
});

vi.mock('next/navigation', () => ({
  useParams: navMocks.useParams,
  useSearchParams: navMocks.useSearchParams,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Polyfills jsdom (ResizeObserver n'existe pas en jsdom).
// ---------------------------------------------------------------------------

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock `document.referrer` (lecture seule en jsdom). */
function setReferrer(referrer: string): void {
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    value: referrer,
  });
}

/** Réponse restaurant minimale pour le fetch du widget. */
function restaurantResponse() {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        id: 'r1',
        name: 'Chez Sokar',
        openingHours: { mon: { open: '12:00', close: '22:00' } },
      }),
  } as unknown as Response;
}

/** Réponse disponibilités (vide) pour le fetch availability. */
function availabilityResponse() {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        restaurantId: 'r1',
        date: '2030-01-15',
        partySize: 2,
        slots: [],
      }),
  } as unknown as Response;
}

/** fetch spy qui route selon l'URL (restaurant vs availability). */
function makeFetchSpy() {
  return vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/availability')) {
      return availabilityResponse();
    }
    return restaurantResponse();
  });
}

/** Configure un render du widget embarqué avec referrer + spy postMessage. */
async function setupEmbedded(referrer: string) {
  navMocks.setParams({ restaurantId: 'r1' });
  navMocks.setSearch('embedded=1');
  setReferrer(referrer);

  const postMessageSpy = vi.fn();
  vi.spyOn(window.parent, 'postMessage').mockImplementation(postMessageSpy);

  const fetchSpy = makeFetchSpy();
  vi.stubGlobal('fetch', fetchSpy);

  const utils = render(<ReservationWidget />);

  await waitFor(() => {
    expect(fetchSpy).toHaveBeenCalled();
  });
  // Laisse un tick pour les effets post-render (ResizeObserver, sendHeight).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  return { postMessageSpy, fetchSpy, ...utils };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setReferrer('');
  vi.restoreAllMocks();
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  setReferrer('');
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. getParentOrigin()
// ---------------------------------------------------------------------------

describe('getParentOrigin', () => {
  it("retourne l'origin du referrer quand il est valide", () => {
    setReferrer('https://resto.example.com/reservations');
    expect(getParentOrigin()).toBe('https://resto.example.com');
  });

  it("retourne l'origin avec un port explicite", () => {
    setReferrer('http://localhost:5173/booking');
    expect(getParentOrigin()).toBe('http://localhost:5173');
  });

  it("retourne '' quand le referrer est vide", () => {
    setReferrer('');
    expect(getParentOrigin()).toBe('');
  });

  it("retourne '' quand le referrer est invalide", () => {
    setReferrer('not-a-valid-url');
    expect(getParentOrigin()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. postMessage sortant n'est pas appelé quand parentOrigin est vide
// ---------------------------------------------------------------------------

describe('widget embarqué — postMessage sortant', () => {
  it("n'appelle pas window.parent.postMessage quand le referrer est vide", async () => {
    const { postMessageSpy } = await setupEmbedded('');

    const resizeCalls = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    );
    expect(resizeCalls).toHaveLength(0);
  });

  it("cible l'origine du referrer (pas '*') quand le referrer est valide", async () => {
    const { postMessageSpy } = await setupEmbedded('https://resto.example.com/');

    const resizeCalls = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    );
    expect(resizeCalls.length).toBeGreaterThan(0);
    for (const call of resizeCalls) {
      const targetOrigin = call[1] as string;
      expect(targetOrigin).toBe('https://resto.example.com');
      expect(targetOrigin).not.toBe('*');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Listener entrant rejette event.origin !== window.location.origin
// ---------------------------------------------------------------------------

describe('widget embarqué — listener entrant', () => {
  it("ignore les messages dont l'origin diffère de window.location.origin", async () => {
    const { postMessageSpy } = await setupEmbedded('https://resto.example.com/');

    const resizeCallsBefore = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    ).length;

    // Message depuis une origine étrangère : ne doit rien déclencher.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://evil.example.com',
          data: { type: 'sokar-widget-resize', height: 999 },
        }),
      );
    });

    const resizeCallsAfterHostile = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    ).length;
    expect(resizeCallsAfterHostile).toBe(resizeCallsBefore);
  });

  it("ignore les messages same-origin sans source correspondant à l'iframe gift-card", async () => {
    const { postMessageSpy } = await setupEmbedded('https://resto.example.com/');

    const resizeCallsBefore = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    ).length;

    // Message same-origin mais sans source (l'iframe gift-card n'est pas ouverte) :
    // ne doit rien déclencher.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: null,
          data: { type: 'sokar-widget-resize', height: 4242 },
        }),
      );
    });

    const resizeCallsAfter = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    ).length;
    expect(resizeCallsAfter).toBe(resizeCallsBefore);
  });

  it('ignore les messages same-origin dont la source est une fenêtre étrangère', async () => {
    const { postMessageSpy } = await setupEmbedded('https://resto.example.com/');

    const resizeCallsBefore = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    ).length;

    // Message same-origin mais la source est une autre fenêtre (pas l'iframe gift-card).
    const fakeWindow = {} as Window;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: fakeWindow,
          data: { type: 'sokar-widget-resize', height: 4242 },
        }),
      );
    });

    const resizeCallsAfter = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    ).length;
    expect(resizeCallsAfter).toBe(resizeCallsBefore);
  });
});
