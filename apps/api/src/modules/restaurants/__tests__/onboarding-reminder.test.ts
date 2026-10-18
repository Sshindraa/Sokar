import { describe, expect, it } from 'vitest';
import { computeOnboardingState, type OnboardingTask } from '../onboarding.service';
import {
  buildReminderEmail,
  formatSokarNumber,
  resolveReminderAction,
} from '../onboarding-reminder';

const ROOM: OnboardingTask[] = ['restaurant', 'hours', 'floor'];
const PHONE: OnboardingTask[] = ['knowledge', 'phone'];
const ONLINE: OnboardingTask[] = ['connect-identity', 'connect-activation'];

function stateWith(completed: OnboardingTask[], phoneNumber = '+33451221999') {
  const onboardingTasks = Object.fromEntries(
    completed.map((key) => [key, { status: 'completed' as const }]),
  );
  return {
    phoneNumber,
    state: computeOnboardingState({
      name: 'Chez Sokar',
      phoneNumber,
      onboardingTasks,
    }),
  };
}

const URL_BASE = 'https://sokar.tech';

describe('resolveReminderAction', () => {
  it('pointe la première étape de la salle qui manque', () => {
    const { state, phoneNumber } = stateWith(['restaurant']);
    expect(resolveReminderAction(state, phoneNumber)).toEqual({ kind: 'room', step: 'hours' });
  });

  it('une salle sans numéro Sokar n’est pas relancée : c’est à Sokar d’agir', () => {
    const { state, phoneNumber } = stateWith([...ROOM], '+000chez-sokar');
    expect(resolveReminderAction(state, phoneNumber)).toEqual({ kind: 'waiting-number' });
  });

  it('une salle prête sans numéro n’est pas relancée, même si la page en ligne reste à faire', () => {
    const { state, phoneNumber } = stateWith([...ROOM, ...ONLINE.slice(0, 1)], '+000chez-sokar');
    expect(resolveReminderAction(state, phoneNumber)).toEqual({ kind: 'waiting-number' });
  });

  it('salle prête et numéro attribué : les deux canaux restent à activer', () => {
    // Le numéro attribué complète tout seul l'étape « phone » mais pas « knowledge ».
    const { state, phoneNumber } = stateWith([...ROOM]);
    expect(resolveReminderAction(state, phoneNumber)).toEqual({
      kind: 'channels',
      remaining: ['phone', 'online'],
      step: null,
    });
  });

  it('un seul canal restant : l’étape à rouvrir est la première non terminée', () => {
    const phoneOnly = stateWith([...ROOM, ...ONLINE]);
    expect(resolveReminderAction(phoneOnly.state, phoneOnly.phoneNumber)).toEqual({
      kind: 'channels',
      remaining: ['phone'],
      step: 'knowledge',
    });
    const onlineOnly = stateWith([...ROOM, ...PHONE, 'connect-identity']);
    expect(resolveReminderAction(onlineOnly.state, onlineOnly.phoneNumber)).toEqual({
      kind: 'channels',
      remaining: ['online'],
      step: 'connect-activation',
    });
  });

  it('les sept tâches terminées : rien à relancer', () => {
    const { state, phoneNumber } = stateWith([...ROOM, ...PHONE, ...ONLINE]);
    expect(resolveReminderAction(state, phoneNumber)).toEqual({ kind: 'complete' });
  });

  it('une étape reportée ne compte pas comme terminée', () => {
    const { state, phoneNumber } = stateWith([...ROOM, ...ONLINE]);
    state.steps.find((step) => step.key === 'knowledge')!.status = 'skipped';
    expect(resolveReminderAction(state, phoneNumber)).toMatchObject({
      kind: 'channels',
      remaining: ['phone'],
    });
  });
});

describe('buildReminderEmail', () => {
  const build = (
    kind: 'stalled' | 'inactive',
    action: Parameters<typeof buildReminderEmail>[0]['action'],
    extra: { restaurantName?: string; sokarNumber?: string | null } = {},
  ) =>
    buildReminderEmail({
      kind,
      action,
      restaurantName: extra.restaurantName ?? 'Chez Sokar',
      sokarNumber: extra.sokarNumber,
      dashboardUrl: URL_BASE,
    });

  it('relance de la salle : étape suivante et lien vers la reprise', () => {
    const email = build('stalled', { kind: 'room', step: 'hours' })!;
    expect(email.subject).toBe('Chez Sokar : terminez la configuration de votre salle');
    expect(email.html).toContain('vos horaires de réservation');
    expect(email.html).toContain('href="https://sokar.tech/onboarding"');
  });

  it('deux canaux restants : renvoie vers l’écran des canaux', () => {
    const email = build('stalled', {
      kind: 'channels',
      remaining: ['phone', 'online'],
      step: null,
    })!;
    expect(email.subject).toBe('Chez Sokar : il vous reste deux canaux à activer');
    expect(email.html).toContain('le téléphone et la réservation en ligne');
    expect(email.html).toContain('href="https://sokar.tech/onboarding?step=canaux"');
  });

  it('un canal restant : renvoie vers son étape', () => {
    const email = build('stalled', {
      kind: 'channels',
      remaining: ['online'],
      step: 'connect-identity',
    })!;
    expect(email.subject).toBe('Chez Sokar : il vous reste un canal à activer');
    expect(email.html).toContain('href="https://sokar.tech/onboarding?step=connect-identity"');
    expect(email.html).not.toContain('le téléphone');
  });

  it('n’envoie rien tant que le restaurateur attend son numéro', () => {
    expect(build('stalled', { kind: 'waiting-number' })).toBeNull();
    expect(build('inactive', { kind: 'waiting-number' })).toBeNull();
  });

  it('parcours terminé : seule la relance « inactive » part, avec le numéro Sokar', () => {
    expect(build('stalled', { kind: 'complete' })).toBeNull();
    const email = build('inactive', { kind: 'complete' }, { sokarNumber: '+33451221999' })!;
    expect(email.subject).toBe('Chez Sokar : entendez votre assistant');
    expect(email.html).toContain('04 51 22 19 99');
    expect(email.html).toContain('href="https://sokar.tech/dashboard"');
  });

  it('ne promet plus d’appel, ne cite plus Google Agenda ni « 5 étapes »', () => {
    const emails = [
      build('stalled', { kind: 'room', step: 'floor' }),
      build('stalled', { kind: 'channels', remaining: ['phone'], step: 'knowledge' }),
      build('inactive', { kind: 'complete' }, { sokarNumber: '+33451221999' }),
    ].map((email) => `${email!.subject} ${email!.html}`);
    for (const text of emails) {
      expect(text).not.toMatch(/dans la minute|on vous appelle|agenda|sur 5|\b5 étapes/i);
      expect(text).not.toMatch(/\btu\b|\btoi\b|\bton\b|\bta\b/i);
    }
  });

  it('échappe le nom du restaurant dans le corps HTML', () => {
    const email = build(
      'stalled',
      { kind: 'room', step: 'restaurant' },
      { restaurantName: '<img src=x onerror=alert(1)> & Fils' },
    )!;
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; Fils');
  });
});

describe('formatSokarNumber', () => {
  it('met un numéro français au format national', () => {
    expect(formatSokarNumber('+33451221999')).toBe('04 51 22 19 99');
    expect(formatSokarNumber('+33102030405')).toBe('01 02 03 04 05');
  });

  it('laisse un autre format tel quel', () => {
    expect(formatSokarNumber('+4915112345678')).toBe('+4915112345678');
  });
});
