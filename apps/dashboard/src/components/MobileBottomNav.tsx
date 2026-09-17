'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Award,
  BarChart3,
  CalendarCheck,
  Code,
  Gift,
  HeartHandshake,
  Megaphone,
  Moon,
  MoreHorizontal,
  Radio,
  Settings,
  Share2,
  Sparkles,
  Star,
  Sun,
  Ticket,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDashboardTheme } from '@/features/theme/dashboard-theme';
import { cn, triggerHaptic } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', key: 'overview' as const, icon: BarChart3 },
  { href: '/dashboard/calls', key: 'service' as const, icon: Radio },
  { href: '/dashboard/reservations', key: 'reservations' as const, icon: CalendarCheck },
  { href: '/dashboard/customers', key: 'customers' as const, icon: Users },
];

const moreItems = [
  { href: '/dashboard/marketing', key: 'marketing', icon: Megaphone },
  { href: '/dashboard/reputation', key: 'reputation', icon: Star },
  { href: '/dashboard/loyalty', key: 'loyalty', icon: Award },
  { href: '/dashboard/reactivation', key: 'reactivation', icon: HeartHandshake },
  { href: '/dashboard/experiences', key: 'experiences', icon: CalendarCheck },
  { href: '/dashboard/events', key: 'events', icon: Ticket },
  { href: '/dashboard/gift-cards', key: 'giftCards', icon: Gift },
  { href: '/dashboard/connect', key: 'connect', icon: Zap },
  { href: '/dashboard/widget', key: 'widget', icon: Code },
  { href: '/dashboard/distribution', key: 'distribution', icon: Share2 },
  { href: '/dashboard/agentic', key: 'agentic', icon: Sparkles },
  { href: '/dashboard/settings', key: 'settings', icon: Settings },
];

function isMobileNavActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === href;
  if (href === '/dashboard/gift-cards') return pathname.startsWith('/dashboard/gift-card');
  return pathname.startsWith(href);
}

function isPrimaryNavActive(pathname: string, item: (typeof navItems)[number]) {
  if (item.key === 'service') {
    return ['/dashboard/calls', '/dashboard/floor-plan'].some((href) => pathname.startsWith(href));
  }

  return isMobileNavActive(pathname, item.href);
}

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  previewIndex: number;
  moved: boolean;
};

const DRAG_THRESHOLD = 6;
const LIQUID_SETTLE_TRANSITION =
  'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), width 240ms cubic-bezier(0.22, 1, 0.36, 1)';

export default function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const tNav = useTranslations('nav');
  const tDashboard = useTranslations('dashboard');
  const { theme, toggleTheme } = useDashboardTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isNavMinimized, setIsNavMinimized] = useState(false);
  const [dragPreviewIndex, setDragPreviewIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const liquidRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const moreActive = moreOpen || moreItems.some((item) => isMobileNavActive(pathname, item.href));
  const committedIndex = moreActive
    ? navItems.length
    : Math.max(
        0,
        navItems.findIndex((item) => isPrimaryNavActive(pathname, item)),
      );

  const getGeometry = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();
    const centers = itemRefs.current.map((item) => {
      if (!item) return null;
      const rect = item.getBoundingClientRect();
      return rect.left - containerRect.left + rect.width / 2;
    });

    if (centers.some((center): center is null => center === null)) return null;

    const resolvedCenters = centers as number[];
    const itemWidth = itemRefs.current[0]?.getBoundingClientRect().width ?? 64;

    return {
      containerRect,
      centers: resolvedCenters,
      itemWidth,
    };
  }, []);

  const nearestIndex = useCallback((localX: number, centers: number[]) => {
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    centers.forEach((center, index) => {
      const distance = Math.abs(center - localX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  }, []);

  const setLiquidPosition = useCallback(
    (localX: number, animate: boolean, stretch = 0) => {
      const liquid = liquidRef.current;
      const geometry = getGeometry();
      if (!liquid || !geometry) return;

      // The lens is intentionally wider than a tab: it overlaps the adjacent
      // labels just enough to create the same magnifying-glass silhouette as
      // the reference interaction while remaining clipped to the bar edges.
      const baseWidth = Math.max(56, geometry.itemWidth * 1.08);
      const width = Math.min(geometry.itemWidth * 1.42, baseWidth + stretch);
      liquid.style.width = `${width}px`;
      const tilt = Number.parseFloat(liquid.style.getPropertyValue('--liquid-tilt') || '0');
      const pressure = Number.parseFloat(liquid.style.getPropertyValue('--liquid-pressure') || '0');
      const verticalScale = 1 + Math.min(0.035, Math.max(0, pressure) * 0.018);
      liquid.style.transform = `translate3d(${localX - width / 2}px, -50%, 0) rotate(${tilt}deg) scaleY(${verticalScale})`;
      liquid.style.transition = animate ? LIQUID_SETTLE_TRANSITION : 'none';
    },
    [getGeometry],
  );

  const setLiquidInteraction = useCallback(
    (localX: number, animate: boolean, stretch = 0, tilt = 0, pressure = 0) => {
      const liquid = liquidRef.current;
      if (!liquid) return;

      liquid.style.setProperty('--liquid-tilt', `${tilt}deg`);
      liquid.style.setProperty('--liquid-pressure', `${pressure}`);
      setLiquidPosition(localX, animate, stretch);
    },
    [setLiquidPosition],
  );

  const resetLiquidInteraction = useCallback(() => {
    const liquid = liquidRef.current;
    if (!liquid) return;
    liquid.style.setProperty('--liquid-tilt', '0deg');
    liquid.style.setProperty('--liquid-pressure', '0');
  }, []);

  const settleLiquid = useCallback(
    (index: number, animate: boolean) => {
      const geometry = getGeometry();
      if (!geometry) return;
      const center = geometry.centers[index] ?? geometry.centers[0];
      if (center !== undefined) setLiquidPosition(center, animate);
    },
    [getGeometry, setLiquidPosition],
  );

  useEffect(() => {
    settleLiquid(committedIndex, false);

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
      settleLiquid(committedIndex, false);
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [committedIndex, settleLiquid]);

  // Apple reduces the tab bar while the user scrolls down and restores it as
  // soon as the user scrolls up. Keep the transition local to touch surfaces;
  // the desktop sidebar never mounts this component visually.
  useEffect(() => {
    let lastScrollY = window.scrollY;
    let ticking = false;

    const updateVisibility = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;

      if (Math.abs(delta) >= 8) {
        if (currentScrollY <= 8 || delta < 0 || moreOpen) {
          setIsNavMinimized(false);
        } else {
          setIsNavMinimized(true);
        }
        lastScrollY = currentScrollY;
      }

      ticking = false;
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateVisibility);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [moreOpen]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const geometry = getGeometry();
    if (!geometry) return;

    const localX = Math.min(
      geometry.centers[geometry.centers.length - 1],
      Math.max(geometry.centers[0], event.clientX - geometry.containerRect.left),
    );
    const previewIndex = nearestIndex(localX, geometry.centers);

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: performance.now(),
      previewIndex,
      moved: false,
    };
    suppressClickRef.current = false;
    setIsDragging(true);
    setIsPressed(true);
    setDragPreviewIndex(previewIndex);
    setLiquidInteraction(localX, false, 0, 0, 1);
    // Pointer capture is needed for a finger that leaves the bar while
    // scrubbing. On a mouse click it would retarget the native click to the
    // container and prevent the underlying Link/button from receiving it.
    if (event.pointerType !== 'mouse') {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < DRAG_THRESHOLD) return;
    drag.moved = true;

    const geometry = getGeometry();
    if (!geometry) return;

    const now = performance.now();
    const elapsed = Math.max(16, now - drag.lastTime);
    const velocity = (event.clientX - drag.lastX) / elapsed;
    drag.lastX = event.clientX;
    drag.lastTime = now;

    const firstCenter = geometry.centers[0];
    const lastCenter = geometry.centers[geometry.centers.length - 1];
    const localX = Math.min(
      lastCenter,
      Math.max(firstCenter, event.clientX - geometry.containerRect.left),
    );
    const previewIndex = nearestIndex(localX, geometry.centers);
    const stretch = Math.min(
      44,
      Math.abs(event.clientX - drag.startX) * 0.16 + Math.abs(velocity) * 14,
    );
    const tilt = Math.max(-7, Math.min(7, velocity * 20));

    setLiquidInteraction(localX, false, stretch, tilt, 1);
    if (previewIndex !== drag.previewIndex) {
      drag.previewIndex = previewIndex;
      setDragPreviewIndex(previewIndex);
      triggerHaptic(6);
    }
    event.preventDefault();
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const didMove = drag.moved && !cancelled;
    const targetIndex = drag.previewIndex;
    dragRef.current = null;
    setIsDragging(false);
    setIsPressed(false);
    setDragPreviewIndex(null);

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    if (!didMove) {
      resetLiquidInteraction();
      settleLiquid(committedIndex, true);
      return;
    }

    event.preventDefault();
    suppressClickRef.current = true;
    resetLiquidInteraction();
    settleLiquid(targetIndex, true);

    if (targetIndex === navItems.length) {
      setIsNavMinimized(false);
      setMoreOpen(true);
      return;
    }

    setMoreOpen(false);
    router.push(navItems[targetIndex].href);
  };

  // Le panneau « Plus » appartient au shell du dashboard et reste donc
  // monté pendant une navigation entre les onglets principaux. On le ferme
  // dès que l'URL change afin de ne jamais laisser le voile/modal au-dessus
  // d'une nouvelle page.
  useEffect(() => {
    setMoreOpen(false);
    setIsNavMinimized(false);
  }, [pathname]);

  // Lock scroll when more menu is open
  useEffect(() => {
    if (!moreOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [moreOpen]);

  return (
    <>
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label={tNav('close')}
            onClick={() => setMoreOpen(false)}
            className="dashboard-mobile-only fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            id="mobile-more-menu"
            aria-label={tNav('more')}
            className="dashboard-mobile-more-menu dashboard-mobile-only fixed left-1/2 z-[60] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 overflow-y-auto rounded-[1.6rem] border border-border bg-background p-3 shadow-2xl shadow-background/40"
          >
            <div className="mb-3 border-b border-border px-1 pb-3">
              <span
                aria-hidden="true"
                className="mx-auto mb-2 block h-1 w-10 rounded-full bg-muted-foreground/30"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-semibold text-foreground">{tNav('more')}</span>
                <button
                  type="button"
                  aria-label={tNav('close')}
                  title={tNav('close')}
                  onClick={() => setMoreOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isMobileNavActive(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'group flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card/35 px-2.5 py-1.5 text-left text-sm font-medium leading-tight text-muted-foreground transition-all duration-200 hover:border-foreground/20 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2 sm:px-3',
                      active && 'border-primary/40 bg-primary/10 text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary/70 text-muted-foreground transition-colors duration-200 group-hover:bg-background group-hover:text-foreground',
                        active && 'bg-primary/15 text-primary',
                      )}
                    >
                      <Icon size={16} strokeWidth={active ? 2.2 : 1.7} />
                    </span>
                    <span className="break-words">{tNav(item.key)}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="group flex min-h-10 w-full items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-left text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2 sm:px-3"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary/70 transition-colors duration-200 group-hover:bg-background">
                  {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                </span>
                <span>
                  {theme === 'light'
                    ? tDashboard('themeTooltipLight')
                    : tDashboard('themeTooltipDark')}
                </span>
              </button>
            </div>
          </div>
        </>
      )}

      <nav
        aria-label="Navigation principale"
        className={cn('dashboard-mobile-nav', isNavMinimized && !moreOpen && 'is-minimized')}
      >
        <div
          ref={containerRef}
          className={cn(
            'dashboard-mobile-nav__inner',
            isDragging && 'is-dragging',
            isPressed && 'is-pressed',
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={(event) => finishDrag(event, true)}
        >
          <span
            ref={liquidRef}
            className="dashboard-mobile-nav__liquid-indicator"
            aria-hidden="true"
          />
          <div className="dashboard-mobile-nav__items">
            {navItems.map((item) => {
              const Icon = item.icon;
              // Quand « Plus » est ouvert, son indicateur devient l'onglet
              // actif. L'onglet de la page courante doit garder son icône et
              // son libellé normaux (notamment « Clients »), sans second
              // état actif visuel sous le panneau.
              const active = !moreOpen && isPrimaryNavActive(pathname, item);
              const visualActive = isDragging
                ? dragPreviewIndex === navItems.indexOf(item)
                : active;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={tNav(item.key)}
                  draggable={false}
                  ref={(element) => {
                    itemRefs.current[navItems.indexOf(item)] = element;
                  }}
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      event.preventDefault();
                      suppressClickRef.current = false;
                      return;
                    }
                    triggerHaptic(12);
                    setMoreOpen(false);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={cn('dashboard-mobile-nav__item', visualActive && 'is-active')}
                >
                  <span className="dashboard-mobile-nav__icon" aria-hidden="true">
                    <Icon size={20} strokeWidth={1.8} />
                  </span>
                  <span className="dashboard-mobile-nav__label">
                    <span className="dashboard-mobile-nav__label-full">{tNav(item.key)}</span>
                    <span className="dashboard-mobile-nav__label-compact" aria-hidden="true">
                      {item.key === 'reservations' ? 'Résas' : tNav(item.key)}
                    </span>
                  </span>
                </Link>
              );
            })}

            <button
              type="button"
              draggable={false}
              ref={(element) => {
                itemRefs.current[navItems.length] = element;
              }}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              aria-controls="mobile-more-menu"
              aria-label={tNav('more')}
              aria-current={moreActive ? 'page' : undefined}
              onClick={(event) => {
                if (suppressClickRef.current) {
                  event.preventDefault();
                  suppressClickRef.current = false;
                  return;
                }
                triggerHaptic(12);
                setMoreOpen((current) => !current);
              }}
              className={cn(
                'dashboard-mobile-nav__item',
                (isDragging ? dragPreviewIndex === navItems.length : moreActive) && 'is-active',
              )}
            >
              <span className="dashboard-mobile-nav__icon" aria-hidden="true">
                <MoreHorizontal size={20} strokeWidth={1.8} />
              </span>
              <span className="dashboard-mobile-nav__label">
                <span className="dashboard-mobile-nav__label-full">{tNav('more')}</span>
                <span className="dashboard-mobile-nav__label-compact" aria-hidden="true">
                  {tNav('more')}
                </span>
              </span>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}
