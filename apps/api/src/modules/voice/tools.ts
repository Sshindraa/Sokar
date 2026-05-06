const TIME_PATTERN = '^([0-1]\\d|2[0-3]):[0-5]\\d$';

export function getRestaurantTools(_restaurantId: string) {
  return [
    {
      type: 'function',
      function: {
        name:        'createReservation',
        description: 'Crée une réservation. À appeler uniquement après avoir confirmé date, heure, nombre de personnes et nom du client.',
        parameters: {
          type: 'object',
          properties: {
            date:          { type: 'string', format: 'date', description: 'Date au format YYYY-MM-DD' },
            time:          { type: 'string', pattern: TIME_PATTERN, description: 'Heure au format HH:MM (ex: 19:30)' },
            partySize:     { type: 'integer', minimum: 1, maximum: 7, description: 'Nombre de personnes — ≥8 déclenche handoffToManager' },
            customerName:  { type: 'string', description: 'Nom complet du client' },
            customerPhone: { type: 'string', description: 'Téléphone du client (optionnel)' },
          },
          required: ['date', 'time', 'partySize', 'customerName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name:        'checkAvailability',
        description: 'Vérifie si le restaurant est ouvert pour un créneau donné.',
        parameters: {
          type: 'object',
          properties: {
            date:      { type: 'string', format: 'date' },
            time:      { type: 'string', pattern: TIME_PATTERN },
            partySize: { type: 'integer', minimum: 1 },
          },
          required: ['date', 'time', 'partySize'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name:        'getOpeningHours',
        description: "Retourne les horaires d'ouverture formatés pour être lus à voix haute.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name:        'handoffToManager',
        description: "Transfère l'appel au gérant. Utiliser si : groupe ≥8 personnes, demande complexe, client mécontent, ou incompréhension après 2 essais.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ];
}
