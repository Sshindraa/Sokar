import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import ReservationWidget, { getGiftCardOrigin } from './page';
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

function dateParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function bookingRestaurantResponse(): Response {
  return jsonResponse({
    id: 'r1',
    name: 'Chez Sokar',
    openingHours: Object.fromEntries(
      ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [
        day,
        { open: '12:00', close: '22:00' },
      ]),
    ),
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

describe('origine du widget carte cadeau', () => {
  it('utilise Connect sur le port local 4002 en développement', () => {
    expect(getGiftCardOrigin('http://localhost:3000', 'development')).toBe('http://localhost:4002');
  });

  it('conserve la même origine derrière le routage de production', () => {
    expect(getGiftCardOrigin('https://sokar.tech', 'production')).toBe('https://sokar.tech');
  });
});

describe('présélection Connect', () => {
  it('ne présente pas une erreur de disponibilité comme un jour complet', async () => {
    navMocks.setParams({ restaurantId: 'chez-sokar' });
    navMocks.setSearch(`date=${dateParam(new Date())}&partySize=2`);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('/availability')
          ? Promise.reject(new Error('réseau'))
          : Promise.resolve(bookingRestaurantResponse()),
      ),
    );
    const widget = render(<ReservationWidget />);
    await waitFor(() => expect(widget.getByText('Disponibilités indisponibles')).toBeTruthy());
    expect(widget.queryByText('Complet')).toBeNull();
  });

  it('permet de réessayer la disponibilité sans promettre une place sur un jour seulement ouvert', async () => {
    const date = dateParam(new Date());
    navMocks.setParams({ restaurantId: 'chez-sokar' });
    navMocks.setSearch(`date=${date}&partySize=2`);
    let availabilityCalls = 0;
    const fetchSpy = vi.fn((url: string) => {
      if (!url.includes('/availability')) return Promise.resolve(bookingRestaurantResponse());
      availabilityCalls += 1;
      return availabilityCalls === 1
        ? Promise.reject(new Error('réseau'))
        : Promise.resolve(
            jsonResponse({ restaurantId: 'r1', date, partySize: 2, slots: ['20:30'] }),
          );
    });
    vi.stubGlobal('fetch', fetchSpy);
    const widget = render(<ReservationWidget />);
    fireEvent.click(await widget.findByRole('button', { name: 'Réessayer' }));
    expect(widget.getAllByRole('button', { name: /ouvert$/ }).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(widget.getByRole('button', { name: 'Choisir le créneau 20h30' })).toBeTruthy(),
    );
    expect(availabilityCalls).toBe(2);
    expect(widget.getByText('Créneaux disponibles')).toBeTruthy();
  });

  it('conserve date et couverts, puis sélectionne le créneau vérifié', async () => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    const dateValue = dateParam(date);
    navMocks.setParams({ restaurantId: 'chez-sokar' });
    navMocks.setSearch(`date=${dateValue}&time=20%3A30&partySize=4`);

    let resolveAvailability!: (response: Response) => void;
    const fetchSpy = vi.fn((url: string) =>
      url.includes('/availability')
        ? new Promise<Response>((resolve) => {
            resolveAvailability = resolve;
          })
        : Promise.resolve(bookingRestaurantResponse()),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const widget = render(<ReservationWidget />);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/proxy/restaurants/r1/availability?date=${dateValue}&partySize=4`,
        expect.any(Object),
      ),
    );
    expect(widget.getByRole('button', { name: '4 personnes' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(widget.queryByRole('button', { name: 'Choisir le créneau 20h30' })).toBeNull();

    await act(async () => {
      resolveAvailability(
        jsonResponse({
          restaurantId: 'r1',
          date: dateValue,
          partySize: 4,
          slots: ['20:00', '20:30'],
        }),
      );
    });

    await waitFor(() =>
      expect(
        widget
          .getByRole('button', { name: 'Choisir le créneau 20h30' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    expect(widget.getByRole('button', { name: /Continuer · 20h30/ })).toBeTruthy();
  });

  it('explique un créneau devenu indisponible sans perdre date et groupe', async () => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    const dateValue = dateParam(date);
    navMocks.setParams({ restaurantId: 'chez-sokar' });
    navMocks.setSearch(`date=${dateValue}&time=20%3A30&partySize=4`);
    const fetchSpy = vi.fn(async (url: string) =>
      url.includes('/availability')
        ? jsonResponse({ restaurantId: 'r1', date: dateValue, partySize: 4, slots: ['20:00'] })
        : bookingRestaurantResponse(),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const widget = render(<ReservationWidget />);

    await waitFor(() =>
      expect(widget.getByRole('status').textContent).toContain(
        'Le créneau de 20h30 n’est plus disponible',
      ),
    );
    expect(widget.getByRole('button', { name: '4 personnes' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/restaurants/r1/availability?date=${dateValue}&partySize=4`,
      expect.any(Object),
    );
    expect(widget.getByRole('button', { name: 'Choisir le créneau 20h00' })).toBeTruthy();
    expect(widget.queryByRole('button', { name: 'Choisir le créneau 20h30' })).toBeNull();
  });

  it('ignore les paramètres invalides et revient aux critères habituels', async () => {
    const today = dateParam(new Date());
    navMocks.setParams({ restaurantId: 'chez-sokar' });
    navMocks.setSearch('date=2026-02-30&time=25%3A00&partySize=99');
    const fetchSpy = vi.fn(async (url: string) =>
      url.includes('/availability')
        ? jsonResponse({ restaurantId: 'r1', date: today, partySize: 2, slots: ['20:30'] })
        : bookingRestaurantResponse(),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const widget = render(<ReservationWidget />);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/proxy/restaurants/r1/availability?date=${today}&partySize=2`,
        expect.any(Object),
      ),
    );
    expect(widget.getByRole('button', { name: '2 personnes' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await waitFor(() =>
      expect(
        widget
          .getByRole('button', { name: 'Choisir le créneau 20h30' })
          .getAttribute('aria-pressed'),
      ).toBe('false'),
    );
  });

  it('ne présélectionne pas un horaire lié à une date passée', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const today = dateParam(new Date());
    navMocks.setParams({ restaurantId: 'chez-sokar' });
    navMocks.setSearch(`date=${dateParam(yesterday)}&time=20%3A30&partySize=4`);
    const fetchSpy = vi.fn(async (url: string) =>
      url.includes('/availability')
        ? jsonResponse({ restaurantId: 'r1', date: today, partySize: 4, slots: ['20:30'] })
        : bookingRestaurantResponse(),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const widget = render(<ReservationWidget />);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/proxy/restaurants/r1/availability?date=${today}&partySize=4`,
        expect.any(Object),
      ),
    );
    await waitFor(() =>
      expect(
        widget
          .getByRole('button', { name: 'Choisir le créneau 20h30' })
          .getAttribute('aria-pressed'),
      ).toBe('false'),
    );
  });

  it('ne réapplique pas une réponse lente après un changement manuel de groupe', async () => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    const dateValue = dateParam(date);
    navMocks.setParams({ restaurantId: 'chez-sokar' });
    navMocks.setSearch(`date=${dateValue}&time=20%3A30&partySize=4`);
    let resolveFirst!: (response: Response) => void;
    const fetchSpy = vi.fn((url: string) => {
      if (!url.includes('/availability')) return Promise.resolve(bookingRestaurantResponse());
      if (url.includes('partySize=4')) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(
        jsonResponse({ restaurantId: 'r1', date: dateValue, partySize: 2, slots: ['20:00'] }),
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
    const widget = render(<ReservationWidget />);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/proxy/restaurants/r1/availability?date=${dateValue}&partySize=4`,
        expect.any(Object),
      ),
    );
    fireEvent.click(widget.getByRole('button', { name: '2 personnes' }));
    await waitFor(() =>
      expect(widget.getByRole('button', { name: 'Choisir le créneau 20h00' })).toBeTruthy(),
    );

    await act(async () => {
      resolveFirst(
        jsonResponse({ restaurantId: 'r1', date: dateValue, partySize: 4, slots: ['20:30'] }),
      );
    });

    expect(widget.queryByRole('button', { name: 'Choisir le créneau 20h30' })).toBeNull();
    expect(widget.getByRole('button', { name: '2 personnes' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
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

  it('utilise explicitParentOrigin en priorité sur le referrer', () => {
    setReferrer('https://referrer.example.com/');
    expect(getParentOrigin('https://explicit.example.com')).toBe('https://explicit.example.com');
  });

  it('retombe sur le referrer quand explicitParentOrigin est invalide', () => {
    setReferrer('https://referrer.example.com/');
    expect(getParentOrigin('not-a-url')).toBe('https://referrer.example.com');
  });

  it("retourne '' quand explicitParentOrigin est file:// (non-HTTP)", () => {
    setReferrer('');
    expect(getParentOrigin('file:///path/to/page.html')).toBe('');
  });

  it("retourne '' quand explicitParentOrigin et referrer sont tous deux vides", () => {
    setReferrer('');
    expect(getParentOrigin(null)).toBe('');
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

  it("accepte un message same-origin dont la source est l'iframe gift-card et forward au parent", async () => {
    const { postMessageSpy, container } = await setupEmbedded('https://resto.example.com/');

    // Ouvre la modal gift-card pour que l'iframe soit rendue et le ref assigné.
    const giftCardButton = container.querySelector('button[class*="gift"], button[class*="carte"]');
    // Fallback : cherche par texte
    const button =
      giftCardButton ??
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('carte cadeau'),
      );
    expect(button).toBeTruthy();
    await act(async () => {
      fireEvent.click(button!);
    });

    // Récupère l'iframe renderée et son contentWindow.
    const iframe = container.querySelector('iframe') as HTMLIFrameElement | null;
    expect(iframe).toBeTruthy();
    const iframeWindow = iframe!.contentWindow;
    expect(iframeWindow).toBeTruthy();

    const resizeCallsBefore = postMessageSpy.mock.calls.filter(
      ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
    ).length;

    // Message same-origin avec source === iframe.contentWindow : doit être accepté.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: iframeWindow,
          data: { type: 'sokar-widget-resize', height: 5555 },
        }),
      );
    });

    // Le message doit être forwardé au parent (resizeCalls augmente).
    await waitFor(() => {
      const resizeCallsAfter = postMessageSpy.mock.calls.filter(
        ([msg]) => (msg as { type?: string })?.type === 'sokar-widget-resize',
      ).length;
      expect(resizeCallsAfter).toBeGreaterThan(resizeCallsBefore);
    });
  });
});
