import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, formatOpeningHours } from '../prompts';
import {
  buildStructuredTurnMessages,
  describeCalendar,
  describeDate,
} from '../stream/structured-turn/prompt';
import {
  createStructuredTurnState,
  dayPartInTimezone,
} from '../stream/structured-turn/fact-guards';

describe('buildSystemPrompt', () => {
  const baseCtx = {
    name: 'Chez Michel',
    openingHours: {
      mon: { open: '12:00', close: '14:30' },
      tue: { open: '12:00', close: '14:30' },
      wed: { open: '12:00', close: '14:30' },
      thu: { open: '12:00', close: '14:30' },
      fri: { open: '12:00', close: '14:30' },
      sat: { open: '19:00', close: '23:00' },
      sun: null,
    },
    personality: null,
  };

  it.each([
    [undefined, 8],
    [7, 8],
    [10, 11],
  ])('cite le seuil de groupe du restaurant (maxPartySize %s)', (maxPartySize, threshold) => {
    const prompt = buildSystemPrompt(
      { ...baseCtx, maxPartySize },
      new Date('2026-07-22T10:00:00Z'),
    );

    expect(prompt).toContain(`groupe de ${threshold} personnes ou plus`);
    expect(prompt).not.toContain('8+');
  });

  it('liste un jour absent des horaires comme fermé, dans l’ordre de la semaine', () => {
    const hours = formatOpeningHours({
      fri: { open: '12:00', close: '23:00' },
      tue: { open: '12:00', close: '22:00' },
    });
    expect(hours.split('\n')).toEqual([
      'Lundi : fermé',
      'Mardi : 12:00–22:00',
      'Mercredi : fermé',
      'Jeudi : fermé',
      'Vendredi : 12:00–23:00',
      'Samedi : fermé',
      'Dimanche : fermé',
    ]);
  });

  it('lit aussi les formats longs et schema.org, comme le calcul des créneaux', () => {
    expect(formatOpeningHours({ sunday: { opens: '12:00', closes: '15:00' } })).toContain(
      'Dimanche : 12:00–15:00',
    );
    expect(
      formatOpeningHours([{ dayOfWeek: 'Monday', opens: '18:00', closes: '23:00' }]),
    ).toContain('Lundi : 18:00–23:00');
  });

  it('n’affirme aucun jour quand les horaires ne sont pas renseignés', () => {
    expect(formatOpeningHours({})).toContain('Horaires non renseignés');
    expect(formatOpeningHours({})).not.toContain('fermé');
  });

  it('calcule le jour et les horaires de la date réservée (appel 0d49230d)', () => {
    const hours = { tue: { open: '12:00', close: '22:00' } };
    expect(describeDate('2026-09-28', hours)).toEqual({
      date: '2026-09-28',
      weekday: 'lundi',
      hours: 'FERMÉ ce jour-là',
    });
    expect(describeDate('2026-09-29', hours)?.hours).toBe('ouvert 12:00–22:00');
    expect(describeDate('2026-09-29', {})?.hours).toBe('horaires non renseignés');

    const state = createStructuredTurnState();
    state.draft.date = '2026-09-28';
    const [system] = buildStructuredTurnMessages({
      systemPrompt: 'Prompt',
      history: [],
      transcript: 'vous êtes ouvert à quelle heure',
      state,
      openingHours: hours,
    });
    expect(system.content).toContain(
      '"dateFacts":{"date":"2026-09-28","weekday":"lundi","hours":"FERMÉ ce jour-là"}',
    );
  });

  it("interdit d'annoncer une disponibilité avant le nombre de personnes (appel c5d6b07d)", () => {
    const [system] = buildStructuredTurnMessages({
      systemPrompt: 'Prompt',
      history: [],
      transcript: "est-ce que c'est possible de venir à 18 heures",
      state: createStructuredTurnState(),
    });
    // Rejeu Qwen du 28/09 : « Oui, 18 heures c'est possible » dans 7 à 8 tirages sur 10
    // sans nombre de personnes ; 0 sur 10 avec cette consigne.
    expect(system.content).toContain('tant que draft.partySize vaut 0');
    // Principe, pas de formule à imiter : l'horaire est retenu sans être annoncé comme acquis.
    expect(system.content).toContain("Retiens l'horaire dans draft sans l'annoncer comme acquis");
    expect(system.content).not.toContain("« 18 heures, c'est noté »");
    // Une valeur contenue dans une question n'est retenue que si elle est dite clairement.
    expect(system.content).toContain("ses mots suffisent à savoir de quelle information il s'agit");
    // Groupe connu : lire la ligne de sa taille, refuser un horaire absent (1–2/10 → 9/10).
    expect(system.content).toContain('« 9-12 » contient 10');
  });

  it('donne au modèle des principes de conversation, pas des phrases (appel b686b241)', () => {
    const [system] = buildStructuredTurnMessages({
      systemPrompt: 'Prompt',
      history: [],
      transcript: 'je voudrais bien venir',
      state: createStructuredTurnState(),
      dayPart: '15 h, après-midi',
    });
    // Rejeu Qwen sur les tours réels du 29/09 (20 tirages) : phrase d'intention sans
    // information, attente 14/20 → 20/20 ; nom épelé au récapitulatif 5/20 → 0/20 ;
    // récapitulatif 23,7 → 17 mots ; redemande à vide (60 tirages) 52/60 → 26/60 ;
    // « bonne soirée » à 15 h (40 tirages) 20/40 → 4/40.
    expect(system.content).toContain("sans donner encore l'information que tu attends");
    expect(system.content).toContain('ne repose jamais à vide la question');
    expect(system.content).toContain('dis-le comme un nom, pas lettre par lettre');
    // Le moment de la journée est un fait, placé en dernier au plus près de la formulation.
    const moment = system.content.indexOf('MOMENT DE LA JOURNÉE');
    expect(moment).toBeGreaterThan(system.content.indexOf('ÉTAT VÉRIFIÉ'));
    expect(system.content).toContain('15 h, après-midi');
  });

  it('attend une correction annoncée et prend congé après la réservation (appel 8ae1e63e)', () => {
    const [system] = buildStructuredTurnMessages({
      systemPrompt: 'Prompt',
      history: [],
      transcript: 'demain à 14 heures non',
      state: createStructuredTurnState(),
    });
    // Rejeu Qwen sur les tours réels du 29/09 (18 h 39) : une valeur suivie d'un rejet
    // n'était jamais jugée inachevée (0/20) → 25/30 ; « salut » après « Bonne soirée »
    // rouvrait un accueil 13/20 → 0/20 (fin d'appel 7/20 → 20/20) ; témoins inchangés.
    expect(system.content).toContain('est une correction en cours');
    expect(system.content).toContain("N'agis pas sur la valeur rejetée");
    expect(system.content).toContain('sa façon de prendre congé, pas un nouvel appel');
    expect(system.content).toContain('action=end_call');
  });

  it("n'ajoute aucun moment de la journée quand il n'est pas fourni", () => {
    const [system] = buildStructuredTurnMessages({
      systemPrompt: 'Prompt',
      history: [],
      transcript: 'bonjour',
      state: createStructuredTurnState(),
    });
    expect(system.content).not.toContain('MOMENT DE LA JOURNÉE (heure locale');
  });

  it("calcule l'heure locale pleine et le moment de la journée dans le fuseau du restaurant", () => {
    const at = (iso: string) => dayPartInTimezone('Europe/Paris', new Date(iso));
    expect(at('2026-09-29T13:09:00Z')).toBe('15 h, après-midi');
    expect(at('2026-09-29T05:30:00Z')).toBe('7 h, matin');
    expect(at('2026-09-29T16:00:00Z')).toBe('18 h, soir');
    expect(at('2026-09-29T01:00:00Z')).toBe('3 h, nuit');
    // Une minute plus tard, le fait reste identique : la requête spéculative aussi.
    expect(at('2026-09-29T13:10:00Z')).toBe(at('2026-09-29T13:09:00Z'));
  });

  it('interdit de recopier une question restée sans réponse (appel c5d6b07d)', () => {
    const [system] = buildStructuredTurnMessages({
      systemPrompt: 'Prompt',
      history: [],
      transcript: 'et vous avez une terrasse',
      state: createStructuredTurnState(),
    });
    // Rejeu Qwen du 29/09, question à côté (« terrasse ») : 8/10 répétaient
    // « Vous voulez venir vers quelle heure ? » mot pour mot ; 2/10 avec cette consigne.
    expect(system.content).toContain('ne recopie jamais ta dernière phrase');
    expect(system.content).toContain("reprends-la plus brièvement et avec d'autres mots");
  });

  it('donne un calendrier calculé de 14 jours, jours fermés compris (appel 88921164)', () => {
    const hours = { tue: { open: '12:00', close: '22:00' } };
    const calendar = describeCalendar('2026-09-27', hours).split('\n');
    expect(calendar).toHaveLength(14);
    expect(calendar[0]).toBe("2026-09-27 dimanche (aujourd'hui) : FERMÉ ce jour-là");
    expect(calendar[1]).toBe('2026-09-28 lundi (demain) : FERMÉ ce jour-là');
    expect(calendar[2]).toBe('2026-09-29 mardi (après-demain) : ouvert 12:00–22:00');

    const [system] = buildStructuredTurnMessages({
      systemPrompt: 'Prompt',
      history: [],
      transcript: 'on serait ouvert demain',
      state: createStructuredTurnState(),
      openingHours: hours,
      today: '2026-09-27',
    });
    expect(system.content).toContain('CALENDRIER (calculé');
    expect(system.content).toContain('2026-09-28 lundi (demain) : FERMÉ ce jour-là');
  });

  it('devrait generer le prompt de base sans CRM ni prompt extra', () => {
    const prompt = buildSystemPrompt(baseCtx, new Date('2026-07-22T10:00:00Z'));

    expect(prompt).toContain("Tu es l'assistant vocal chaleureux de Chez Michel.");
    expect(prompt).toContain("L'accueil a déjà été prononcé");
    expect(prompt).toContain('appelle checkAvailability immédiatement dans le même tour');
    expect(prompt).toContain('Tu évites le ton administratif');
    expect(prompt).toContain('SITUATIONS (des principes');
    expect(prompt).toContain('Non, plutôt 21 h 15.');
    expect(prompt).toContain("Merci, c'est tout.");
    expect(prompt).toContain('mercredi 22 juillet 2026, fuseau Europe/Paris');
    expect(prompt).not.toContain('Au tout début de chaque appel');
    expect(prompt).toContain('Lundi : 12:00–14:30');
    expect(prompt).toContain('Dimanche : fermé');
    // Ne doit pas contenir d'extra ni de CRM
    expect(prompt).toContain("handoffToManager : transférer l'appel au gérant");
    expect(prompt).toContain('purchaseGiftCard : vendre une carte cadeau');
    expect(prompt).toContain('recommendGiftCardAmount : conseiller un montant de carte cadeau');
    expect(
      prompt.trim().endsWith('recommendGiftCardAmount : conseiller un montant de carte cadeau'),
    ).toBe(true);
  });

  it('devrait inclure customerExtra quand fourni dans le contexte', () => {
    const customerExtra = "Le client s'appelle Jean-Pierre. C'est sa 5e visite. ⭐ Client VIP.";
    const prompt = buildSystemPrompt({
      ...baseCtx,
      customerExtra,
    });

    expect(prompt).toContain('Jean-Pierre');
    expect(prompt).toContain('5e visite');
    expect(prompt).toContain('⭐ Client VIP.');
    expect(prompt).toContain(customerExtra);
  });

  it('devrait inclure systemPromptExtra de la personnalité quand fourni', () => {
    const systemPromptExtra = 'Sois très jovial et plaisante sur les plats du jour.';
    const prompt = buildSystemPrompt({
      ...baseCtx,
      personality: {
        fillerStyle: 'CASUAL',
        systemPromptExtra,
      },
    });

    expect(prompt).toContain(systemPromptExtra);
    expect(prompt.trim().endsWith(systemPromptExtra)).toBe(true);
  });

  it('devrait inclure a la fois customerExtra et systemPromptExtra dans le bon ordre', () => {
    const customerExtra = "Le client s'appelle Alice.";
    const systemPromptExtra = "Parle avec l'accent marseillais.";
    const prompt = buildSystemPrompt({
      ...baseCtx,
      customerExtra,
      personality: {
        fillerStyle: 'CASUAL',
        systemPromptExtra,
      },
    });

    expect(prompt).toContain(customerExtra);
    expect(prompt).toContain(systemPromptExtra);

    const lines = prompt
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const lastLine = lines[lines.length - 1];
    const secondLastLine = lines[lines.length - 2];

    expect(lastLine).toBe(systemPromptExtra);
    expect(secondLastLine).toBe(customerExtra);
  });

  it('devrait injecter le customerGreeting VIP dans les instructions de continuité', () => {
    const customerGreeting = ', content de vous revoir M. Jean';
    const prompt = buildSystemPrompt({
      ...baseCtx,
      customerGreeting,
    });

    expect(prompt).toContain('CLIENT RECONNU');
    expect(prompt).toContain(customerGreeting);
    const ruleIdx = prompt.indexOf('CLIENT RECONNU');
    const greetIdx = prompt.indexOf(customerGreeting);
    expect(greetIdx).toBeGreaterThan(ruleIdx);
    expect(greetIdx).toBeLessThan(ruleIdx + 200);
  });
});
describe('phrases à dire : des principes, pas des formules', () => {
  const hours = { tue: { open: '12:00', close: '22:00' } };
  const base = buildSystemPrompt({ name: 'Chez Test', openingHours: hours, structuredTurn: true });
  const [system] = buildStructuredTurnMessages({
    systemPrompt: base,
    history: [],
    transcript: 'bonjour',
    state: createStructuredTurnState(),
  });
  const prompt = String(system.content);

  it("ne donne plus de phrase de l'agent à imiter ni de formule d'accusé de réception nommée", () => {
    for (const formula of [
      'Oui, bien sûr. Vous serez combien ?',
      'Avec plaisir. Bonne soirée.',
      "D'accord, je garde",
      "Je n'ai aucun autre créneau vérifié",
      'Et vers quelle heure ?',
      'Alors, quelle heure vous arrange ?',
      'Donc, vous serez combien ?',
      'Vous voulez venir vers quelle heure ?',
      '« Parfait », « Très bien »',
      "« c'est noté »",
      '« ça marche »',
      '16 heures, parfait',
      'lundi 28 septembre',
    ]) {
      expect(prompt).not.toContain(formula);
    }
  });

  it("garde des exemples d'interprétation de l'entrée, avec des valeurs absentes du banc", () => {
    // Ce que dit l'appelant : on garde, pour apprendre à le comprendre.
    for (const heard of [
      '« allô ? »',
      '« oui »',
      '« merci »',
      '« attendez »',
      '« il reste de la place ? »',
    ]) {
      expect(prompt).toContain(heard);
    }
    // « six » valait la valeur 6 du banc, « K I F » les lettres de AKKIF : remplacés.
    expect(prompt).toContain('« trois »');
    expect(prompt).not.toContain('« six »');
    expect(prompt).not.toContain('K I F');
  });
});

describe('buildSystemPrompt : base commune et section propre au mode à outils', () => {
  const hours = { tue: { open: '12:00', close: '22:00' } };
  const base = { name: 'Chez Test', openingHours: hours, giftCardMinimumAmount: 25 };
  const tools = buildSystemPrompt(base);
  const structured = buildSystemPrompt({ ...base, structuredTurn: true });

  it('garde le mode à outils complet, section outils séparée de la base', () => {
    expect(buildSystemPrompt({ ...base, structuredTurn: false })).toBe(tools);
    for (const kept of [
      'RÈGLES DU MODE À OUTILS',
      'OUTILS DISPONIBLES',
      'appelle checkAvailability immédiatement',
      'handoffToManager',
      'purchaseGiftCard',
      'reportDelay',
      'le montant minimum est 25€',
      'Transfert :',
    ]) {
      expect(tools).toContain(kept);
    }
    // La base commune vient d'abord, la section outils ensuite.
    expect(tools.indexOf('COMPORTEMENT :')).toBeLessThan(tools.indexOf('RÈGLES DU MODE À OUTILS'));
  });

  it('le tour structuré ne reçoit que la base commune, sans aucun outil', () => {
    for (const name of [
      'RÈGLES DU MODE À OUTILS',
      'OUTILS DISPONIBLES',
      'checkAvailability',
      'createReservation',
      'cancelReservation',
      'reportDelay',
      'takeMessage',
      'handoffToManager',
      'purchaseGiftCard',
      'recommendGiftCardAmount',
      'lien de paiement',
    ]) {
      expect(structured).not.toContain(name);
    }
    for (const common of ['DATE COURANTE', 'COMPORTEMENT :', 'HORAIRES', 'Mardi : 12:00–22:00']) {
      expect(structured).toContain(common);
    }
    expect(structured.length).toBeLessThan(tools.length - 1500);
  });

  it('supprime la contradiction « Parfait » dans les deux modes', () => {
    expect(tools).not.toContain('« Parfait, donc… »');
    expect(structured).not.toContain('« Parfait, donc… »');
  });

  it('la personnalisation du restaurant reste en fin de prompt dans les deux modes', () => {
    const custom = {
      ...base,
      customerExtra: 'EXTRA-CLIENT',
      personality: { systemPromptExtra: 'EXTRA-PERSO' },
    };
    expect(buildSystemPrompt(custom).trimEnd().endsWith('EXTRA-PERSO')).toBe(true);
    expect(
      buildSystemPrompt({ ...custom, structuredTurn: true })
        .trimEnd()
        .endsWith('EXTRA-PERSO'),
    ).toBe(true);
  });

  it("les consignes du tour structuré disent ce qu'il ne peut pas faire, sans « prioritaire sur la section OUTILS »", () => {
    const [system] = buildStructuredTurnMessages({
      systemPrompt: structured,
      history: [],
      transcript: 'bonjour',
      state: createStructuredTurnState(),
    });
    expect(system.content).not.toContain('prioritaire sur la section OUTILS');
    expect(system.content).toContain(
      'Tu ne peux ni annuler une réservation, ni signaler un retard, ni vendre une carte cadeau',
    );
  });
});
