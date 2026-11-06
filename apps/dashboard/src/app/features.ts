// Les fonctions présentées sur l'accueil : chacune correspond à une heure de la journée animée.
// `scene` est l'indice de l'heure dans HeroServiceDay ; `id` sert d'ancre (/#telephone).
export const FEATURES = [
  {
    id: 'briefing',
    scene: 0,
    hour: '11 h',
    label: 'Briefing du service',
    text: 'Réservations, couverts et allergies.',
  },
  {
    id: 'telephone',
    scene: 1,
    hour: '12 h 40',
    label: 'Réponse au téléphone',
    text: 'Léa prend l’appel, le carnet se remplit.',
  },
  {
    id: 'salle',
    scene: 2,
    hour: '20 h',
    label: 'Plan de salle',
    text: 'Chaque table a sa place.',
  },
  {
    id: 'fiche-client',
    scene: 3,
    hour: '23 h 30',
    label: 'Fiche client',
    text: 'Ce que vous avez appris reste.',
  },
] as const;
