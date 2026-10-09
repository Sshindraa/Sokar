'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Une mesure qui change de moins que cela n'est pas appliquée : évite de vibrer autour de la bonne taille. */
const ZOOM_TOLERANCE = 0.005;

/**
 * L'interface n'est jamais agrandie : au-delà de sa taille de base, le texte et les champs deviennent
 * démesurés sur un grand écran. Le contenu reste calé en haut et l'espace en trop reste libre en bas.
 */
export const BASE_ZOOM = 1;

function supportsZoom() {
  return (
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1.2')
  );
}

/**
 * Adapte le contenu à l'espace réellement offert, quel que soit l'écran : on mesure la hauteur
 * disponible et on applique un seul facteur, au lieu de fixer des tailles par paliers d'écran.
 *
 * L'interface garde sa taille de base sur un grand écran (`maxZoom` = 1) : elle n'est réduite que si
 * l'écran est trop petit pour tout afficher sans défiler. Le facteur est celui du `zoom` CSS, qui réduit
 * aussi la mise en page : le texte, les champs, les espacements et la largeur de retour à la ligne
 * suivent ensemble. Sans prise en charge de `zoom` (anciens Firefox), le contenu reste à sa taille de
 * base. Sous `minZoom`, la zone défile. Le contenu reste calé en haut de la zone.
 */
export function FitToHeight({
  children,
  minZoom = 0.8,
  maxZoom = BASE_ZOOM,
  className,
}: {
  children: ReactNode;
  minZoom?: number;
  maxZoom?: number;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content || !supportsZoom()) return;
    const available = frame.clientHeight;
    if (available <= 0) return;

    // La hauteur ne varie pas exactement avec le facteur (les lignes se recoupent à une autre
    // largeur) : on converge en quelques passes, puis on réduit tant que ça déborde.
    let next = zoomRef.current;
    for (let pass = 0; pass < 6; pass += 1) {
      content.style.zoom = String(next);
      const height = content.getBoundingClientRect().height;
      if (height <= 0) return;
      const target = Math.min(maxZoom, Math.max(minZoom, (next * available) / height));
      if (Math.abs(target - next) < ZOOM_TOLERANCE) break;
      next = target;
    }
    content.style.zoom = String(next);
    for (
      let guard = 0;
      guard < 30 && next > minZoom && content.getBoundingClientRect().height > available + 0.5;
      guard += 1
    ) {
      next = Math.max(minZoom, next - 0.02);
      content.style.zoom = String(next);
    }

    if (Math.abs(next - zoomRef.current) >= ZOOM_TOLERANCE) {
      zoomRef.current = next;
      setZoom(next);
    }
  }, [maxZoom, minZoom]);

  // À chaque rendu : le contenu peut changer sans que sa taille change (sections superposées dont la
  // plus haute fixe la hauteur), donc l'observateur seul ne suffit pas.
  useIsomorphicLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let frameId = 0;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
      frameId = requestAnimationFrame(measure);
      // Filet : un onglet ou un volet masqué suspend `requestAnimationFrame`.
      timerId = setTimeout(measure, 100);
    };
    const observer = new ResizeObserver(schedule);
    // La fenêtre change de taille, ou le contenu change (autre section, option dépliée…).
    if (frameRef.current) observer.observe(frameRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
      observer.disconnect();
    };
  }, [measure]);

  return (
    <div ref={frameRef} className={cn('flex min-h-0 flex-col overflow-y-auto', className)}>
      <div ref={contentRef} style={{ zoom }} className="shrink-0">
        {children}
      </div>
    </div>
  );
}
