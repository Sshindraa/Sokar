import { describe, expect, it } from 'vitest';
import {
  hasSeatFor,
  isWindowBlocked,
  planUnassignedSeating,
  type SeatingItem,
  type SeatingTable,
} from '../unassigned-seating';

const T = (id: string, capacity: number, minCapacity = 1, sectionId: string | null = null) =>
  ({ id, capacity, minCapacity, sectionId }) satisfies SeatingTable;

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 6, 2, hour, minute));

/** Groupe sans table, de 19 h à 21 h par défaut. */
const loose = (partySize: number, startHour = 19, endHour = 21): SeatingItem => ({
  partySize,
  tableId: null,
  start: at(startHour),
  end: at(endHour),
});

const window = (partySize: number, startHour = 19, endHour = 21) => ({
  partySize,
  start: at(startHour),
  end: at(endHour),
});

describe('planUnassignedSeating', () => {
  it('une réservation sans table n’occupe qu’une table : la plus petite compatible', () => {
    const tables = [T('t-4', 4), T('t-8', 8)];
    const plan = planUnassignedSeating(tables, [loose(2)]);

    expect(plan.busyByTable.get('t-4')).toHaveLength(1);
    expect(plan.busyByTable.get('t-8')).toBeUndefined();
    expect(plan.blocked).toEqual([]);
    // La grande table reste libre pour un groupe de 6.
    expect(hasSeatFor(plan, tables, window(6))).toBe(true);
  });

  it('une réservation sans table ne ferme pas la plage : les autres groupes trouvent une table', () => {
    const tables = [T('t-2', 2), T('t-4', 4)];
    const plan = planUnassignedSeating(tables, [loose(2)]);

    expect(isWindowBlocked(plan, at(19), at(21))).toBe(false);
    expect(hasSeatFor(plan, tables, window(4))).toBe(true);
    expect(hasSeatFor(plan, tables, window(2))).toBe(true);
  });

  it('sature : des groupes sans table se posent jusqu’à épuiser les tables compatibles', () => {
    const tables = [T('t-2', 2), T('t-4', 4), T('t-6', 6)];
    const items = [loose(2), loose(2), loose(2)];
    const plan = planUnassignedSeating(tables, items);

    expect(plan.blocked).toEqual([]);
    expect([...plan.busyByTable.keys()].sort()).toEqual(['t-2', 't-4', 't-6']);
    expect(hasSeatFor(plan, tables, window(2))).toBe(false);
  });

  it('un quatrième groupe de 2 sans table, après saturation, bloque son intervalle', () => {
    const tables = [T('t-2', 2), T('t-4', 4), T('t-6', 6)];
    const items = [loose(2), loose(2), loose(2), loose(2)];
    const plan = planUnassignedSeating(tables, items);

    expect(plan.blocked).toEqual([{ start: at(19), end: at(21) }]);
    expect(isWindowBlocked(plan, at(20), at(22))).toBe(true);
    expect(isWindowBlocked(plan, at(21), at(23))).toBe(false);
  });

  it('aucune table compatible donne un blocage', () => {
    const tables = [T('t-4', 4)];
    const plan = planUnassignedSeating(tables, [loose(6)]);

    expect(plan.blocked).toHaveLength(1);
    expect(isWindowBlocked(plan, at(19), at(21))).toBe(true);
    // Le blocage vise le seul groupe de 6 : un groupe de 4 garde sa table.
    expect(hasSeatFor(plan, tables, window(4))).toBe(true);
    expect(hasSeatFor(plan, tables, window(6))).toBe(false);
  });

  it('une table minCapacity trop haute n’accueille pas le groupe', () => {
    const tables = [T('t-4', 4, 4)];
    const plan = planUnassignedSeating(tables, [loose(2)]);

    expect(plan.blocked).toHaveLength(1);
  });

  it('les éléments avec table occupent leur table avant le placement virtuel', () => {
    const tables = [T('t-2', 2), T('t-4', 4)];
    const fixed: SeatingItem = { partySize: 4, tableId: 't-4', start: at(19), end: at(21) };
    const plan = planUnassignedSeating(tables, [fixed, loose(2)]);

    // Le groupe de 2 ne peut pas prendre la table de 4 (fixée) : il va sur celle de 2.
    expect(plan.busyByTable.get('t-2')).toHaveLength(1);
    expect(plan.blocked).toEqual([]);
    expect(hasSeatFor(plan, tables, window(4))).toBe(false);
  });

  it('suit l’ordre d’arrivée : un groupe arrivé plus tôt prend la table en premier', () => {
    const tables = [T('t-4', 4)];
    const first = planUnassignedSeating(tables, [loose(4), loose(2, 20, 22)]);
    expect(first.blocked).toEqual([{ start: at(20), end: at(22) }]);

    const reversed = planUnassignedSeating(tables, [loose(2, 20, 22), loose(4)]);
    expect(reversed.blocked).toEqual([{ start: at(19), end: at(21) }]);
  });

  it('un groupe qui ne chevauche pas le précédent réutilise la même table', () => {
    const tables = [T('t-2', 2)];
    const plan = planUnassignedSeating(tables, [loose(2, 19, 20), loose(2, 20, 21)]);

    expect(plan.blocked).toEqual([]);
    expect(hasSeatFor(plan, tables, window(2, 21, 22))).toBe(true);
  });

  it('un candidat limité à une section ne voit que les tables de cette section', () => {
    const tables = [T('t-a', 4, 1, 'salle'), T('t-b', 4, 1, 'terrasse')];
    const plan = planUnassignedSeating(tables, []);

    expect(hasSeatFor(plan, tables, { ...window(2), sectionId: 'terrasse' })).toBe(true);
    expect(hasSeatFor(plan, [tables[0]], { ...window(2), sectionId: 'terrasse' })).toBe(false);
    expect(hasSeatFor(plan, tables, { ...window(2), sectionId: 'bar' })).toBe(false);
  });

  it('sans table du tout, chaque élément sans table bloque son intervalle', () => {
    const plan = planUnassignedSeating([], [loose(2)]);

    expect(isWindowBlocked(plan, at(20), at(21))).toBe(true);
    expect(hasSeatFor(plan, [], window(2))).toBe(false);
  });
});
