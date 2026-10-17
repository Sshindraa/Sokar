// Local preview only: this transport never calls the API or sends notifications.
export function createReservationDemo() {
  let revision = 0;
  let booking = {
    restaurantName: 'Restaurant Exemple',
    restaurantPhone: null,
    restaurantAddress: '12 rue de la Table, 75002 Paris',
    startsAt: '2026-10-20T17:30:00.000Z',
    endsAt: '2026-10-20T19:00:00.000Z',
    date: '2026-10-20',
    time: '19:30',
    partySize: 2,
    state: 'CONFIRMED',
    whatsappReminder: { visible: true, enabled: true },
  };
  function view() {
    const available = booking.state === 'CONFIRMED';
    return {
      ...booking,
      whatsappReminder: { ...booking.whatsappReminder },
      modification: { available, message: available ? '' : 'Cette réservation est annulée.' },
      cancellation: {
        available,
        deadline: '2026-10-19T17:30:00.000Z',
        terms: 'Annulation gratuite jusqu’à 24 heures avant la réservation.',
        message: available
          ? 'Conditions simulées pour cette démonstration.'
          : 'Votre réservation est annulée.',
        confirmationToken: `demo-cancel-${revision}`,
      },
    };
  }
  const proposals = new Map<
    string,
    { date: string; time: string; partySize: number; revision: number }
  >();
  return async (body: Record<string, unknown>): Promise<unknown> => {
    if (body.action === 'view') return view();
    if (body.action === 'withdraw_whatsapp') {
      booking = { ...booking, whatsappReminder: { visible: true, enabled: false } };
      return view();
    }
    if (booking.state !== 'CONFIRMED') throw new Error('Cette réservation est annulée.');
    if (body.action === 'modification_options') {
      const date = typeof body.date === 'string' ? body.date : booking.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)))
        throw new Error('Date invalide.');
      const count = Number(body.partySize);
      if (!Number.isInteger(count) || count < 1 || count > 6)
        throw new Error('Choisissez entre 1 et 6 personnes.');
      // Deliberately limited inventory, explicitly fictional in the UI.
      const times =
        count > 4 ? ['18:30', '21:00'] : ['18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
      return {
        date,
        partySize: count,
        maxPartySize: 6,
        message: 'Créneaux simulés · Aucun changement avant votre confirmation.',
        slots: times.map((time) => {
          const proposalToken = `demo-${revision}-${date}-${count}-${time}`;
          proposals.set(proposalToken, { date, time, partySize: count, revision });
          return { time, proposalToken };
        }),
      };
    }
    if (body.action === 'modify' && body.confirmed === true) {
      const proposal = proposals.get(String(body.proposalToken));
      if (!proposal || proposal.revision !== revision)
        throw new Error('Veuillez sélectionner un nouveau créneau.');
      const [hour, minute] = proposal.time.split(':').map(Number);
      // The preview also handles the Europe/Paris daylight-saving change.
      const probe = new Date(`${proposal.date}T12:00:00Z`);
      const parisHour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Paris',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(probe),
      );
      const startsAt = new Date(`${proposal.date}T00:00:00Z`);
      startsAt.setUTCHours(hour - (parisHour - 12), minute);
      booking = {
        ...booking,
        date: proposal.date,
        time: proposal.time,
        partySize: proposal.partySize,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
      };
      revision++;
      proposals.clear();
      return view();
    }
    if (
      body.action === 'cancel' &&
      body.confirmed === true &&
      body.confirmationToken === `demo-cancel-${revision}`
    ) {
      booking = { ...booking, state: 'CANCELLED' };
      revision++;
      proposals.clear();
      return view();
    }
    throw new Error('Une confirmation explicite est nécessaire.');
  };
}
