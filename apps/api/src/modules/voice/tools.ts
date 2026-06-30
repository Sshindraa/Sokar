const TIME_PATTERN = '^([0-1]\\d|2[0-3]):[0-5]\\d$';

export function getRestaurantTools(_restaurantId: string) {
  return [
    {
      type: 'function',
      function: {
        name: 'createReservation',
        description:
          'Crée une réservation. À appeler uniquement après avoir confirmé date, heure, nombre de personnes et nom du client.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date', description: 'Date au format YYYY-MM-DD' },
            time: {
              type: 'string',
              pattern: TIME_PATTERN,
              description: 'Heure au format HH:MM (ex: 19:30)',
            },
            partySize: {
              type: 'integer',
              minimum: 1,
              maximum: 7,
              description: 'Nombre de personnes — ≥8 déclenche handoffToManager',
            },
            customerName: { type: 'string', description: 'Nom complet du client' },
            customerPhone: { type: 'string', description: 'Téléphone du client (optionnel)' },
          },
          required: ['date', 'time', 'partySize', 'customerName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'checkAvailability',
        description:
          'Vérifie les créneaux disponibles pour une date donnée. À appeler quand le client demande si une table est disponible sans vouloir réserver tout de suite, ou pour proposer des alternatives si un créneau demandé est pris.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date', description: 'Date au format YYYY-MM-DD' },
            partySize: {
              type: 'integer',
              minimum: 1,
              maximum: 7,
              description: 'Nombre de personnes',
            },
          },
          required: ['date', 'partySize'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cancelReservation',
        description:
          "Annule une réservation existante. À appeler quand le client demande explicitement à annuler. Demander le nom et la date pour identifier la réservation avant d'annuler.",
        parameters: {
          type: 'object',
          properties: {
            customerName: {
              type: 'string',
              description: 'Nom du client tel qu donné lors de la réservation',
            },
            date: {
              type: 'string',
              format: 'date',
              description: 'Date de la réservation au format YYYY-MM-DD',
            },
          },
          required: ['customerName', 'date'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'takeMessage',
        description:
          'Enregistre un message du client pour le gérant. À utiliser quand le client laisse un message (demande spéciale, rappel demandé, réclamation) qui nécessite un traitement humain différé.',
        parameters: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: 'Nom du client' },
            message: { type: 'string', description: 'Le message à transmettre au gérant' },
            callbackPhone: {
              type: 'string',
              description: 'Numéro de rappel si le client en a un (optionnel)',
            },
          },
          required: ['customerName', 'message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'handoffToManager',
        description:
          "Transfère l'appel au gérant. Utiliser si : groupe ≥8 personnes, demande complexe, client mécontent, ou incompréhension après 2 essais.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ];
}
