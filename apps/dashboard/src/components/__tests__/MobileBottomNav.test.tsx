import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileBottomNav from '../MobileBottomNav';
import { triggerHaptic } from '@/lib/utils';

const pathnameState = vi.hoisted(() => ({ value: '/dashboard' }));
const searchParamsState = vi.hoisted(() => ({ value: '' }));
const routerState = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameState.value,
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
  useRouter: () => routerState,
}));

vi.mock('@/features/theme/dashboard-theme', () => ({
  useDashboardTheme: () => ({
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/lib/utils', () => ({
  triggerHaptic: vi.fn(),
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      overview: 'Pilotage',
      service: 'Service',
      live: 'Live',
      edition: 'Édition',
      calls: 'Appels',
      reservations: 'Réservations',
      customers: 'Clients',
      more: 'Plus',
      close: 'Fermer',
      marketing: 'Campagnes',
      reputation: 'Avis',
      loyalty: 'Fidélité',
      reactivation: 'Relances',
      experiences: 'Offres',
      events: 'Événements',
      giftCards: 'Cartes cadeaux',
      connect: 'Connect',
      widget: 'Widget',
      distribution: 'Partenaires',
      agentic: 'Agent IA',
      settings: 'Réglages',
      themeTooltipLight: 'Passer en mode sombre',
      themeTooltipDark: 'Passer en mode clair',
    };
    return map[key] ?? key;
  },
}));

describe('MobileBottomNav', () => {
  beforeEach(() => {
    pathnameState.value = '/dashboard';
    searchParamsState.value = '';
    vi.clearAllMocks();

    // Mock ResizeObserver
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  it('renders the Copilot navigation without a Service tab', () => {
    const { container } = render(<MobileBottomNav />);

    expect(screen.getByRole('link', { name: /Pilotage/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Réservations/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Clients/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plus/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Service/i })).not.toBeInTheDocument();

    expect(container.querySelector('.dashboard-mobile-nav__svg')).not.toBeInTheDocument();
    expect(
      container.querySelector('.dashboard-mobile-nav__active-indicator'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pilotage/i })).toHaveClass('is-active');
  });

  it('activates overview on /dashboard and triggers haptic feedback', () => {
    render(<MobileBottomNav />);

    const pilotageLink = screen.getByRole('link', { name: /Pilotage/i });
    expect(pilotageLink).toHaveAttribute('aria-current', 'page');

    fireEvent.click(pilotageLink);
    expect(triggerHaptic).toHaveBeenCalledWith(12);
  });

  it('scrubs the liquid indicator with a touch drag and navigates on release', () => {
    const { container } = render(<MobileBottomNav />);
    const nav = container.querySelector('.dashboard-mobile-nav__inner');
    const items = Array.from(container.querySelectorAll('.dashboard-mobile-nav__item'));

    expect(nav).toBeInTheDocument();
    expect(items).toHaveLength(4);
    if (!nav) throw new Error('Mobile navigation container is missing');
    expect(screen.getByRole('link', { name: /Clients/i })).toHaveAttribute('draggable', 'false');
    expect(screen.getByRole('button', { name: /Plus/i })).toHaveAttribute('draggable', 'false');

    Object.defineProperty(nav, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 350, height: 56 }),
    });
    items.forEach((item, index) => {
      Object.defineProperty(item, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: index * 70, top: 0, width: 70, height: 56 }),
      });
    });

    fireEvent.pointerDown(nav, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 35,
      clientY: 20,
      button: 0,
    });
    fireEvent.pointerMove(nav, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 175,
      clientY: 20,
    });
    fireEvent.pointerUp(nav, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 175,
      clientY: 20,
    });

    expect(routerState.push).toHaveBeenCalledWith('/dashboard/customers');
  });

  it('keeps the lens on a tapped destination while the route changes', () => {
    const { container, rerender } = render(<MobileBottomNav />);
    const nav = container.querySelector('.dashboard-mobile-nav__inner');
    const items = Array.from(container.querySelectorAll('.dashboard-mobile-nav__item'));
    const liquid = container.querySelector('.dashboard-mobile-nav__liquid-indicator');

    expect(nav).toBeInTheDocument();
    expect(liquid).toBeInTheDocument();
    if (!nav || !liquid) throw new Error('Mobile navigation elements are missing');

    Object.defineProperty(nav, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 350, height: 56 }),
    });
    items.forEach((item, index) => {
      Object.defineProperty(item, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: index * 70, top: 0, width: 70, height: 56 }),
      });
    });

    fireEvent.pointerDown(nav, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 105,
      clientY: 20,
      button: 0,
    });
    fireEvent.pointerUp(nav, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 105,
      clientY: 20,
    });

    // The lens is centred on 105px and is 75.6px wide, so its left edge is
    // approximately 67.2px. A return to Pilotage would put it near -2.8px.
    const leftEdge = liquid.getAttribute('style')?.match(/translate3d\(([-\d.]+)px/)?.[1];
    expect(Number(leftEdge)).toBeCloseTo(67.2, 1);
    expect(routerState.push).not.toHaveBeenCalled();

    pathnameState.value = '/dashboard/reservations';
    rerender(<MobileBottomNav />);
    expect(liquid.getAttribute('style')).toContain(
      'transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
    );
  });

  it('uses Live and Édition as the only Salle destinations', () => {
    pathnameState.value = '/dashboard/floor-plan';
    const { rerender } = render(<MobileBottomNav />);

    const liveLink = screen.getByRole('link', { name: 'Live' });
    const editionLink = screen.getByRole('link', { name: 'Édition' });
    expect(screen.getByRole('navigation', { name: 'Navigation Salle' })).toBeInTheDocument();
    expect(liveLink).toHaveAttribute('aria-current', 'page');
    expect(editionLink).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('button', { name: /Plus/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Service/i })).not.toBeInTheDocument();

    searchParamsState.value = 'view=edit-plan';
    rerender(<MobileBottomNav />);
    expect(liveLink).not.toHaveAttribute('aria-current');
    expect(editionLink).toHaveAttribute('aria-current', 'page');
  });

  it('navigates from Live to Édition with the Salle gesture', () => {
    pathnameState.value = '/dashboard/floor-plan';
    const { container } = render(<MobileBottomNav />);
    const nav = container.querySelector('.dashboard-mobile-nav__inner');
    const items = Array.from(container.querySelectorAll('.dashboard-mobile-nav__item'));

    expect(nav).toBeInTheDocument();
    expect(items).toHaveLength(2);
    if (!nav) throw new Error('Mobile navigation container is missing');

    Object.defineProperty(nav, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 350, height: 56 }),
    });
    items.forEach((item, index) => {
      Object.defineProperty(item, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: index * 175, top: 0, width: 175, height: 56 }),
      });
    });

    fireEvent.pointerDown(nav, {
      pointerId: 3,
      pointerType: 'touch',
      clientX: 35,
      clientY: 20,
      button: 0,
    });
    fireEvent.pointerMove(nav, {
      pointerId: 3,
      pointerType: 'touch',
      clientX: 260,
      clientY: 20,
    });
    fireEvent.pointerUp(nav, {
      pointerId: 3,
      pointerType: 'touch',
      clientX: 260,
      clientY: 20,
    });

    expect(routerState.push).toHaveBeenCalledWith('/dashboard/floor-plan?view=edit-plan');
  });

  it('opens and closes the more menu dialog', () => {
    render(<MobileBottomNav />);

    const moreButton = screen.getByRole('button', { name: /Plus/i });
    expect(moreButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(moreButton);
    expect(moreButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: /Plus/i })).toBeInTheDocument();
    expect(screen.getByText('Campagnes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Réglages/i })).toHaveClass(
      'col-span-2',
      'md:col-span-3',
    );

    // Close menu
    const closeButtons = screen.getAllByRole('button', { name: /Fermer/i });
    fireEvent.click(closeButtons[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps primary items visible and closes the menu when navigating', () => {
    pathnameState.value = '/dashboard/customers';
    render(<MobileBottomNav />);

    const moreButton = screen.getByRole('button', { name: /Plus/i });
    const clientsLink = screen.getByRole('link', { name: /Clients/i });

    fireEvent.click(moreButton);

    // The page tab stays visible while Plus owns the active indicator.
    expect(clientsLink).not.toHaveClass('is-active');

    fireEvent.click(screen.getByRole('link', { name: /Appels/i }));
    expect(screen.queryByRole('dialog', { name: /Plus/i })).not.toBeInTheDocument();
  });

  it('closes the menu when the route changes outside the bottom nav', () => {
    pathnameState.value = '/dashboard';
    const { rerender } = render(<MobileBottomNav />);

    fireEvent.click(screen.getByRole('button', { name: /Plus/i }));
    expect(screen.getByRole('dialog', { name: /Plus/i })).toBeInTheDocument();

    pathnameState.value = '/dashboard/reservations';
    rerender(<MobileBottomNav />);
    expect(screen.queryByRole('dialog', { name: /Plus/i })).not.toBeInTheDocument();
  });
});
