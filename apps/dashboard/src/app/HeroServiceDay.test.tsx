import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroServiceDay, { FRAME_VH, TIMELINE } from './HeroServiceDay';

const hour = (name: string) => screen.getByRole('button', { name });
const span = () => (TIMELINE.length * FRAME_VH * window.innerHeight) / 100;

// jsdom ne fait aucune mise en page : on simule la position du repère de départ du hero.
let startTop = 0;

function scrollToFrame(index: number) {
  startTop = -(index + 0.5) * ((FRAME_VH * window.innerHeight) / 100);
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

describe('HeroServiceDay', () => {
  beforeEach(() => {
    startTop = 0;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({ top: startTop, bottom: startTop, left: 0, right: 0, width: 0, height: 0 }) as DOMRect,
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('affiche 11 h complet à l’arrivée', () => {
    render(<HeroServiceDay />);
    expect(hour('11 h')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('n’a plus de bouton pause ni de défilement automatique', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    render(<HeroServiceDay />);
    expect(screen.queryByRole('button', { name: /pause|reprendre/i })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(hour('11 h')).toHaveAttribute('aria-pressed', 'true');
    vi.useRealTimers();
  });

  it('remplit la réservation au fil du défilement', () => {
    render(<HeroServiceDay />);
    const first = TIMELINE.findIndex((item) => item.scene === 1);

    scrollToFrame(first);
    expect(hour('12 h 40')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Appel entrant')).toBeInTheDocument();
    expect(screen.queryByText('Camille Robert')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirmée')).not.toBeInTheDocument();

    scrollToFrame(first + 4);
    expect(screen.queryByText('Appel entrant')).not.toBeInTheDocument();
    expect(screen.getByText('Camille Robert')).toBeInTheDocument();
    expect(screen.getByText('Confirmée')).toBeInTheDocument();
  });

  it('arrive à 23 h 30 en bas de la frise et ne va pas plus loin', () => {
    render(<HeroServiceDay />);
    startTop = -span() * 3;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(hour('23 h 30')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Sans noix')).toBeInTheDocument();
  });

  it('revient à 11 h en remontant', () => {
    render(<HeroServiceDay />);
    scrollToFrame(TIMELINE.length - 1);
    expect(hour('23 h 30')).toHaveAttribute('aria-pressed', 'true');
    startTop = 0;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(hour('11 h')).toHaveAttribute('aria-pressed', 'true');
  });

  it('cliquer sur une heure fait défiler jusqu’à elle', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    render(<HeroServiceDay />);
    fireEvent.click(hour('20 h'));
    const first = TIMELINE.findIndex((item) => item.scene === 2);
    const frameHeight = (FRAME_VH * window.innerHeight) / 100;
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: (first + 0.5) * frameHeight }),
    );
  });
  describe('lecteur de l’appel (12 h 40)', () => {
    const toAnsweredCall = () => {
      render(<HeroServiceDay />);
      scrollToFrame(TIMELINE.findIndex((item) => item.scene === 1) + 1);
    };

    it('propose de suivre l’appel sans prétendre jouer un son', () => {
      toAnsweredCall();
      expect(screen.getByRole('button', { name: 'Suivre l’appel' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Écouter l’appel' })).not.toBeInTheDocument();
      expect(document.querySelector('audio')).toBeNull();
    });

    it('ne démarre jamais seul', () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
      toAnsweredCall();
      act(() => vi.advanceTimersByTime(20_000));
      expect(screen.getByRole('button', { name: 'Suivre l’appel' })).toBeInTheDocument();
      expect(screen.queryByText(/Bonjour, ici Léa/)).not.toBeInTheDocument();
      vi.useRealTimers();
    });

    it('affiche les sous-titres, se met en pause et se termine', () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
      toAnsweredCall();
      fireEvent.click(screen.getByRole('button', { name: 'Suivre l’appel' }));

      act(() => vi.advanceTimersByTime(500));
      expect(screen.getAllByText(/Bonjour, ici Léa/).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByRole('button', { name: 'Reprendre' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
      act(() => vi.advanceTimersByTime(20_000));
      expect(screen.getByRole('button', { name: 'Revoir l’appel' })).toBeInTheDocument();
      expect(screen.getAllByText('C’est réservé.').length).toBeGreaterThan(0);
      vi.useRealTimers();
    });

    it('s’arrête quand on défile vers l’heure suivante', () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
      toAnsweredCall();
      fireEvent.click(screen.getByRole('button', { name: 'Suivre l’appel' }));
      act(() => vi.advanceTimersByTime(500));

      scrollToFrame(TIMELINE.findIndex((item) => item.scene === 2));
      expect(screen.queryByText(/Bonjour, ici Léa/)).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    });
  });
});
