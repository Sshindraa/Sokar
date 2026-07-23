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
          'Vérifie immédiatement les disponibilités dès que la date et le nombre de personnes sont connus. Si le client a indiqué une heure, la transmettre aussi. Ne jamais annoncer une vérification sans appeler cet outil dans le même tour.',
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
            time: {
              type: 'string',
              pattern: TIME_PATTERN,
              description: 'Heure demandée au format HH:MM (optionnel)',
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
        name: 'reportDelay',
        description:
          'Signale le retard d’un client au Copilot de salle. À appeler uniquement après avoir confirmé le nom, la date, l’heure exacte de la réservation et le nombre de minutes de retard. Ne modifie jamais une réservation ni une table : le responsable valide toute réorganisation.',
        parameters: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: 'Nom complet du client' },
            date: { type: 'string', format: 'date', description: 'Date au format YYYY-MM-DD' },
            time: {
              type: 'string',
              pattern: TIME_PATTERN,
              description: 'Heure réservée au format HH:MM',
            },
            delayMinutes: {
              type: 'integer',
              minimum: 5,
              maximum: 180,
              description: 'Retard annoncé en minutes',
            },
          },
          required: ['customerName', 'date', 'time', 'delayMinutes'],
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
    {
      type: 'function',
      function: {
        name: 'purchaseGiftCard',
        description:
          "Crée une carte cadeau. À appeler uniquement après avoir confirmé : montant (obligatoire), nom de l'expéditeur, téléphone de l'expéditeur (SMS), nom du destinataire. Le code cadeau est envoyé par SMS à l'expéditeur — ne jamais le dicter.",
        parameters: {
          type: 'object',
          properties: {
            amount: {
              type: 'number',
              minimum: 1,
              multipleOf: 1,
              description: 'Montant en euros — obligatoire (entier)',
            },
            occasion: {
              type: 'string',
              description: 'Occasion (anniversaire, remerciement, etc.)',
            },
            senderName: {
              type: 'string',
              description: "Nom de l'expéditeur",
            },
            senderPhone: {
              type: 'string',
              description: "Téléphone de l'expéditeur au format international (ex: +33612345678)",
            },
            recipientName: {
              type: 'string',
              description: 'Nom du destinataire',
            },
            message: {
              type: 'string',
              description: 'Message personnalisé (optionnel)',
            },
          },
          required: ['amount', 'senderName', 'senderPhone', 'recipientName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recommendGiftCardAmount',
        description:
          "Suggère un montant de carte cadeau selon l'occasion et le nombre de personnes. Utiliser quand l'appelant demande un conseil.",
        parameters: {
          type: 'object',
          properties: {
            occasion: {
              type: 'string',
              description: 'Occasion',
            },
            partySize: {
              type: 'integer',
              minimum: 1,
              description: 'Nombre de personnes',
            },
            budget: {
              type: 'number',
              description: 'Budget maximum (optionnel)',
            },
          },
          required: ['occasion', 'partySize'],
        },
      },
    },
  ];
}
