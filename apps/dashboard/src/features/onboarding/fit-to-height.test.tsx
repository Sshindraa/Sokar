import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BASE_ZOOM, FitToHeight } from './fit-to-height';

const NATURAL_HEIGHT = 400;
let frameHeight = 800;

beforeEach(() => {
  frameHeight = 800;
  vi.stubGlobal('CSS', { supports: () => true });
  // jsdom ne fait pas de mise en page : on simule un contenu dont la hauteur suit le facteur.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => frameHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const zoom = Number.parseFloat(this.style.zoom || '1');
    // Seul le conteneur du contenu porte un `zoom` : sa hauteur suit le facteur, celle du cadre non.
    const height = this.style.zoom ? NATURAL_HEIGHT * zoom : frameHeight;
    return {
      height,
      width: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderFit(props: { minZoom?: number; maxZoom?: number } = {}) {
  render(
    <FitToHeight {...props}>
      <span>Contenu</span>
    </FitToHeight>,
  );
  return screen.getByText('Contenu').parentElement as HTMLElement;
}

it('affiche son contenu', () => {
  renderFit();
  expect(screen.getByText('Contenu')).toBeInTheDocument();
});

it('réduit le contenu quand la hauteur mesurée est trop petite, sans valeur fixée', () => {
  // Le contenu mesure 400 à taille de base, l'espace n'en offre que 320 : facteur 0,8.
  frameHeight = 320;
  const wrapper = renderFit({ minZoom: 0.5 });
  expect(Number.parseFloat(wrapper.style.zoom)).toBeCloseTo(0.8, 2);
});

it('s’adapte à un autre écran : un peu moins de place, facteur un peu plus petit', () => {
  frameHeight = 360;
  const wrapper = renderFit();
  expect(Number.parseFloat(wrapper.style.zoom)).toBeCloseTo(0.9, 2);
});

it('n’agrandit jamais l’interface sur un grand écran : elle garde sa taille de base', () => {
  // L'espace offre 800 pour un contenu de 400 (facteur 2) : on reste à la taille de base.
  const wrapper = renderFit();
  expect(Number.parseFloat(wrapper.style.zoom)).toBeCloseTo(BASE_ZOOM, 2);
});

it('peut être autorisé à agrandir, sans dépasser le facteur maximal demandé', () => {
  frameHeight = 3000;
  const wrapper = renderFit({ maxZoom: 1.5 });
  expect(Number.parseFloat(wrapper.style.zoom)).toBeCloseTo(1.5, 2);
});

it('ne descend jamais sous le facteur minimal : la zone défile alors', () => {
  frameHeight = 100;
  const wrapper = renderFit({ minZoom: 0.8 });
  expect(Number.parseFloat(wrapper.style.zoom)).toBeCloseTo(0.8, 2);
});

it('laisse le contenu à sa taille de base quand le navigateur ne gère pas zoom', () => {
  vi.stubGlobal('CSS', { supports: () => false });
  const wrapper = renderFit();
  expect(wrapper.style.zoom).toBe('1');
});
