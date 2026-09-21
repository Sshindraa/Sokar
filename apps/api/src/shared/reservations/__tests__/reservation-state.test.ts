import { describe, expect, it } from 'vitest';
import { ReservationState, ReservationStatus } from '@prisma/client';
import {
  STATE_FOR_STATUS,
  STATUS_FOR_STATE,
  isConfirmedReservation,
  isReservationState,
  stateForStatus,
  statusForState,
  creationProjection,
  transitionProjection,
} from '../reservation-state';

/**
 * La projection `state` ↔ `status` existait en trois exemplaires avant R1-4.
 * Ces tests verrouillent les propriétés qui manquaient : couverture exhaustive
 * des deux énumérations, aller-retour stable, et lecture qui n'utilise jamais
 * `status` seul.
 */

describe('projection canonique state ↔ status', () => {
  it('couvre exactement les valeurs de l’énumération historique', () => {
    expect(Object.keys(STATE_FOR_STATUS).sort()).toEqual(Object.values(ReservationStatus).sort());
  });

  it('couvre exactement les valeurs agentic', () => {
    expect(Object.keys(STATUS_FOR_STATE).sort()).toEqual(Object.values(ReservationState).sort());
  });

  it('aller-retour : status → state → status est l’identité', () => {
    for (const status of Object.values(ReservationStatus)) {
      expect(statusForState(stateForStatus(status))).toBe(status);
    }
  });

  it('projette les quatre états qui ont un équivalent historique', () => {
    expect(statusForState('CONFIRMED')).toBe('CONFIRMED');
    expect(statusForState('SEATED')).toBe('SEATED');
    expect(statusForState('CANCELLED')).toBe('CANCELLED');
    expect(statusForState('NO_SHOW')).toBe('NO_SHOW');
  });

  it('ne projette pas les quatre états sans équivalent historique', () => {
    // `null` et non `CONFIRMED` : inventer un statut ici est précisément le bug
    // qui faisait passer une validation manuelle pour une réservation ferme.
    expect(statusForState('PENDING')).toBeNull();
    expect(statusForState('HONORED')).toBeNull();
    expect(statusForState('FAILED')).toBeNull();
    expect(statusForState('EXPIRED')).toBeNull();
  });
});

describe('isReservationState', () => {
  it('accepte les huit états de l’énumération', () => {
    for (const state of Object.values(ReservationState)) {
      expect(isReservationState(state)).toBe(true);
    }
  });

  it('refuse une valeur inconnue ou absente', () => {
    expect(isReservationState('BOOKED')).toBe(false);
    expect(isReservationState('')).toBe(false);
    expect(isReservationState(null)).toBe(false);
    expect(isReservationState(undefined)).toBe(false);
    expect(isReservationState(3)).toBe(false);
  });
});

describe('isConfirmedReservation', () => {
  it('accepte une réservation ferme sur les deux colonnes', () => {
    expect(isConfirmedReservation({ status: 'CONFIRMED', state: 'CONFIRMED' })).toBe(true);
  });

  it('refuse une validation manuelle en attente', () => {
    // Cas historique : le worker de rappel a dû ajouter le test sur `state`
    // parce qu'un `status = CONFIRMED` seul laissait passer une résa PENDING.
    expect(isConfirmedReservation({ status: 'CONFIRMED', state: 'PENDING' })).toBe(false);
  });

  it('refuse un client déjà installé ou honoré', () => {
    expect(isConfirmedReservation({ status: 'CONFIRMED', state: 'SEATED' })).toBe(false);
    expect(isConfirmedReservation({ status: 'CONFIRMED', state: 'HONORED' })).toBe(false);
  });

  it('refuse une ligne dérivée où `status` a bougé seul', () => {
    expect(isConfirmedReservation({ status: 'CANCELLED', state: 'CONFIRMED' })).toBe(false);
    expect(isConfirmedReservation({ status: 'NO_SHOW', state: 'CONFIRMED' })).toBe(false);
  });

  it('refuse une colonne absente', () => {
    expect(isConfirmedReservation({ status: 'CONFIRMED', state: null })).toBe(false);
    expect(isConfirmedReservation({ status: null, state: 'CONFIRMED' })).toBe(false);
    expect(isConfirmedReservation({ status: undefined, state: undefined })).toBe(false);
  });
});

describe('creationProjection', () => {
  it('écrit les deux colonnes pour un état projetable', () => {
    expect(creationProjection('CONFIRMED')).toEqual({
      state: 'CONFIRMED',
      status: 'CONFIRMED',
    });
    expect(creationProjection('SEATED')).toEqual({ state: 'SEATED', status: 'SEATED' });
  });

  it('crée une validation manuelle en PENDING sans la déclarer annulée', () => {
    // Règle lossy assumée : l'énumération historique ne sait pas dire
    // « en attente ». C'est `state` qui tranche, jamais `status` seul.
    expect(creationProjection('PENDING')).toEqual({ state: 'PENDING', status: 'CONFIRMED' });
  });
});

describe('transitionProjection', () => {
  it('projette un état qui a un équivalent historique', () => {
    expect(transitionProjection('CANCELLED', 'CONFIRMED')).toEqual({
      state: 'CANCELLED',
      status: 'CANCELLED',
    });
    expect(transitionProjection('SEATED', 'CONFIRMED')).toEqual({
      state: 'SEATED',
      status: 'SEATED',
    });
  });

  it('conserve le statut précédent quand l’état cible n’a pas d’équivalent', () => {
    expect(transitionProjection('HONORED', 'CONFIRMED')).toEqual({
      state: 'HONORED',
      status: 'CONFIRMED',
    });
  });

  it('ne ressuscite jamais une annulation en CONFIRMED', () => {
    // Le bug que la règle évite : écrire `CONFIRMED` par défaut sur une ligne
    // déjà annulée ferait réapparaître la réservation dans les lectures legacy.
    expect(transitionProjection('PENDING', 'CANCELLED').status).toBe('CANCELLED');
    expect(transitionProjection('EXPIRED', 'CANCELLED').status).toBe('CANCELLED');
    expect(transitionProjection('FAILED', 'NO_SHOW').status).toBe('NO_SHOW');
  });
});
