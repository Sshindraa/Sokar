import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FloorStep } from './FloorStep';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  updateTask: vi.fn(),
  exposure: null as unknown,
  extra: {} as Record<string, unknown>,
}));

vi.mock('@/lib/api', () => ({ useApi: () => ({ ...mocks, orgId: 'restaurant-1' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({
    state: { restaurant: { exposureSettings: mocks.exposure, ...mocks.extra } },
    updateTask: mocks.updateTask,
  }),
}));

const emptyFloor = { tables: [], stats: { tableCount: 0, seatCount: 0, largestTableCapacity: 0 } };
const filledFloor = {
  tables: [
    { capacity: 2, count: 4 },
    { capacity: 4, count: 3 },
  ],
  stats: { tableCount: 7, seatCount: 20, largestTableCapacity: 4 },
};

const answers = {
  terrace: true,
  parking: 'nearby',
  accessible: false,
  pets: 'terrace',
  kidsMenu: true,
  privatization: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exposure = null;
  mocks.extra = {};
  mocks.get.mockResolvedValue(emptyFloor);
  mocks.put.mockResolvedValue({});
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
});

const next = () => screen.getByRole('button', { name: /^Continuer$/ });
const railItem = (name: RegExp) => screen.getByRole('button', { name });

async function renderLoaded(onComplete = vi.fn()) {
  render(<FloorStep onComplete={onComplete} />);
  // La première section à compléter s'ouvre une fois la salle chargée.
  await waitFor(() => expect(document.querySelector('[aria-current="step"]')).not.toBeNull());
  return onComplete;
}

function choice(group: string, label: string) {
  const buttons = screen.getByRole('group', { name: group });
  return Array.from(buttons.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement;
}

function answerAll() {
  fireEvent.click(choice('Terrasse', 'Oui'));
  fireEvent.click(choice('Parking', 'À proximité'));
  fireEvent.click(choice('Accessible aux personnes à mobilité réduite', 'Non'));
  fireEvent.click(choice('Animaux acceptés', 'En terrasse'));
  fireEvent.click(choice('Menu enfant', 'Oui'));
  fireEvent.click(choice('Privatisation possible', 'Non'));
}

/** Salle et règles sont sur la même page : on choisit un modèle de salle, les règles sont déjà là. */
async function fillRoom(onComplete = vi.fn()) {
  await renderLoaded(onComplete);
  fireEvent.click(screen.getByRole('button', { name: 'Petite salle' }));
  return onComplete;
}

async function goToPractical(onComplete = vi.fn()) {
  await fillRoom(onComplete);
  fireEvent.click(next());
  await waitFor(() => expect(railItem(/Infos pratiques/)).toHaveAttribute('aria-current', 'step'));
  return onComplete;
}

it('ouvre salle et règles ensemble, puis l’essentiel : deux sections', async () => {
  await renderLoaded();

  expect(screen.getByRole('heading', { name: 'Salle et règles' })).toBeInTheDocument();
  expect(railItem(/Salle & conditions/)).toHaveAttribute('aria-current', 'step');
  expect(railItem(/Infos pratiques/)).toHaveTextContent('0/6 réponses');
  expect(screen.getByLabelText('Nombre de tables de 2')).toBeVisible();
  expect(screen.getByRole('group', { name: 'Durée d’un repas' })).toBeVisible();
  // Les sections sont montées ensemble (pour mesurer la plus haute) ; seule l'active est visible.
  expect(screen.getByLabelText('Adresse de votre menu en ligne')).not.toBeVisible();
});

it('reprend là où il manque quelque chose : tout est fait sauf les réponses pratiques', async () => {
  mocks.get.mockResolvedValue(filledFloor);
  mocks.exposure = { maxPartySize: 4, capacitySpecials: { serviceDurationMinutes: 90 } };
  await renderLoaded();

  expect(railItem(/Infos pratiques/)).toHaveAttribute('aria-current', 'step');
  expect(railItem(/Salle & conditions/)).toHaveTextContent('7 tables');
  expect(screen.getByRole('group', { name: 'Parking' })).toBeInTheDocument();
});

it('préremplit les tailles existantes, y compris une taille inhabituelle', async () => {
  mocks.get.mockResolvedValue({
    tables: [
      { capacity: 2, count: 3 },
      { capacity: 5, count: 1 },
    ],
    stats: { tableCount: 4, seatCount: 11, largestTableCapacity: 5 },
  });
  await renderLoaded();

  expect(screen.getByLabelText('Nombre de tables de 2')).toHaveValue(3);
  expect(screen.getByLabelText('Nombre de tables de 5')).toHaveValue(1);
});

it('dessine la salle et calcule tables, couverts et plus grande table', async () => {
  await renderLoaded();

  fireEvent.click(screen.getByRole('button', { name: 'Une table de 4 en plus' }));
  fireEvent.click(screen.getByRole('button', { name: 'Une table de 4 en plus' }));
  fireEvent.click(screen.getByRole('button', { name: 'Une table de 6 en plus' }));

  expect(
    screen.getByRole('spinbutton', { name: 'Nombre maximum de personnes par réservation' }),
  ).toHaveValue(6);
  expect(railItem(/Salle & conditions/)).toHaveTextContent('3 tables');
});

it('ajoute une autre taille de table', async () => {
  await renderLoaded();

  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Ajouter une autre taille de table' }), {
    key: 'Enter',
  });
  fireEvent.click(screen.getByRole('option', { name: 'Table de 10 personnes' }));

  expect(screen.getByLabelText('Nombre de tables de 10')).toHaveValue(0);
});

it('refuse de continuer sans table et ne sauvegarde rien', async () => {
  await renderLoaded();

  fireEvent.click(next());

  expect(await screen.findByRole('alert')).toHaveTextContent('Ajoutez au moins une table');
  expect(mocks.put).not.toHaveBeenCalled();
});

it('enregistre tables et règles au « Continuer » puis ouvre l’essentiel', async () => {
  await fillRoom();
  fireEvent.click(next());
  await screen.findByRole('group', { name: 'Parking' });

  expect(mocks.put).toHaveBeenCalledWith('restaurant/onboarding/floor', {
    tables: [
      { capacity: 2, count: 4 },
      { capacity: 4, count: 3 },
    ],
  });
  expect(mocks.patch).toHaveBeenCalledTimes(1);
  expect(railItem(/Infos pratiques/)).toHaveAttribute('aria-current', 'step');
});

it('déduit le groupe maximum de la plus grande table, sans le demander', async () => {
  await fillRoom();

  expect(screen.queryByLabelText(/Groupe maximum/)).not.toBeInTheDocument();
  expect(
    screen.getByRole('spinbutton', { name: 'Nombre maximum de personnes par réservation' }),
  ).toHaveValue(4);
});

it('exige une condition d’annulation quand « Autre condition » est choisie', async () => {
  await fillRoom();

  fireEvent.click(
    within(screen.getByRole('group', { name: 'Annulation gratuite jusqu’à' })).getByRole('button', {
      name: 'Autre condition…',
    }),
  );
  fireEvent.click(next());

  expect(await screen.findByRole('alert')).toHaveTextContent('condition d’annulation');
  expect(mocks.patch).not.toHaveBeenCalled();
});

it('enregistre les règles sous la clé lue par la disponibilité', async () => {
  await fillRoom();
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Durée d’un repas' })).getByRole('button', {
      name: '2 h',
    }),
  );
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Annulation gratuite jusqu’à' })).getByRole('button', {
      name: 'Gratuite jusqu’à 24 h avant',
    }),
  );
  fireEvent.click(next());

  await screen.findByRole('group', { name: 'Parking' });
  expect(mocks.patch).toHaveBeenCalledWith('restaurants/restaurant-1/connect', {
    maxPartySize: 4,
    capacitySpecials: {
      totalCapacity: 20,
      serviceDurationMinutes: 120,
      cancellationPolicy: "Annulation gratuite jusqu'à 24 heures avant le service.",
      depositRequired: false,
      depositAmount: 15,
      depositThreshold: 0,
    },
  });
  const body = mocks.patch.mock.calls[0][1] as { capacitySpecials: Record<string, unknown> };
  expect(body.capacitySpecials).not.toHaveProperty('serviceDuration');
  expect(railItem(/Salle & conditions/)).toHaveTextContent('2 h');
});

it('reprend les règles déjà enregistrées, y compris l’ancienne clé de durée', async () => {
  mocks.get.mockResolvedValue(filledFloor);
  mocks.exposure = {
    maxPartySize: 4,
    capacitySpecials: {
      serviceDuration: 105,
      cancellationPolicy: 'Pas d’annulation le samedi soir.',
      depositRequired: true,
      depositAmount: 20,
      depositThreshold: 3,
    },
  };
  await renderLoaded();
  fireEvent.click(railItem(/Salle & conditions/));

  expect(
    within(screen.getByRole('group', { name: 'Durée d’un repas' })).getByRole('button', {
      name: '1 h 45',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    within(screen.getByRole('group', { name: 'Annulation gratuite jusqu’à' })).getByRole('button', {
      name: 'Autre condition…',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Votre condition d’annulation')).toHaveValue(
    'Pas d’annulation le samedi soir.',
  );
  expect(screen.getByLabelText('Montant par personne (€)')).toHaveValue(20);
  expect(screen.getByLabelText(/À partir de/)).toHaveValue(3);
});

it('rend les six réponses pratiques obligatoires et met en évidence celles qui manquent', async () => {
  const complete = await goToPractical();

  fireEvent.click(choice('Parking', 'Aucun'));
  fireEvent.click(next());

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Il reste à répondre');
  expect(alert).toHaveTextContent('terrasse');
  expect(alert).not.toHaveTextContent('parking');
  expect(mocks.updateTask).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  expect(screen.getByText(/^Terrasse/, { selector: 'p' })).toHaveClass('text-destructive');
});

it('termine l’étape une fois tout renseigné : enregistre les réponses puis passe aux consignes', async () => {
  const complete = await goToPractical();

  answerAll();
  fireEvent.click(
    within(screen.getByLabelText('Informations pratiques')).getByRole('button', { name: 'vegan' }),
  );
  fireEvent.change(screen.getByLabelText('Autre chose à savoir ?'), {
    target: { value: '  Chaises hautes disponibles ' },
  });
  fireEvent.click(next());

  await waitFor(() => expect(complete).toHaveBeenCalledWith('knowledge'));
  expect(mocks.put).toHaveBeenCalledWith('restaurant/onboarding/practical', {
    practicalInfo: { ...answers, notes: 'Chaises hautes disponibles' },
    dietary: ['vegan'],
  });
  expect(mocks.updateTask).toHaveBeenCalledWith('complete', 'floor');
});

it('ne réécrit pas ce qui est déjà enregistré', async () => {
  mocks.get.mockResolvedValue(filledFloor);
  mocks.exposure = { maxPartySize: 4, capacitySpecials: { serviceDurationMinutes: 90 } };
  mocks.extra = { practicalInfo: answers };
  const complete = await renderLoaded();

  fireEvent.click(next());

  await waitFor(() => expect(complete).toHaveBeenCalledWith('knowledge'));
  expect(mocks.put).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
});

it('reprend terrasse et privatisation de la fiche Connect et les options alimentaires', async () => {
  mocks.get.mockResolvedValue(filledFloor);
  mocks.exposure = { maxPartySize: 4, capacitySpecials: { serviceDurationMinutes: 90 } };
  mocks.extra = {
    practicalInfo: { parking: 'none', accessible: true, pets: 'no', kidsMenu: false },
    ambiance: ['terrasse', 'privatisation'],
    dietary: ['halal'],
  };
  const complete = await renderLoaded();

  expect(choice('Terrasse', 'Oui')).toHaveAttribute('aria-pressed', 'true');
  expect(choice('Privatisation possible', 'Oui')).toHaveAttribute('aria-pressed', 'true');
  expect(choice('Options alimentaires proposées', 'halal')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(next());

  await waitFor(() => expect(complete).toHaveBeenCalledWith('knowledge'));
  expect(mocks.put).not.toHaveBeenCalled();
});

it('un second clic efface une réponse et la rend à nouveau obligatoire', async () => {
  mocks.get.mockResolvedValue(filledFloor);
  mocks.exposure = { maxPartySize: 4, capacitySpecials: { serviceDurationMinutes: 90 } };
  mocks.extra = { practicalInfo: answers };
  await renderLoaded();

  fireEvent.click(choice('Parking', 'À proximité'));
  expect(railItem(/Infos pratiques/)).toHaveTextContent('5/6 réponses');
  fireEvent.click(next());

  expect(await screen.findByRole('alert')).toHaveTextContent('parking');
  expect(mocks.updateTask).not.toHaveBeenCalled();
});

it('refuse une adresse de menu invalide sans rien envoyer', async () => {
  mocks.get.mockResolvedValue(filledFloor);
  mocks.exposure = { maxPartySize: 4, capacitySpecials: { serviceDurationMinutes: 90 } };
  mocks.extra = { practicalInfo: answers };
  const complete = await renderLoaded();

  fireEvent.change(screen.getByLabelText('Adresse de votre menu en ligne'), {
    target: { value: 'pas une adresse' },
  });
  fireEvent.click(next());

  expect(await screen.findByRole('alert')).toHaveTextContent('adresse de menu complète');
  expect(mocks.put).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it('permet de revenir à une section déjà faite sans perdre la saisie', async () => {
  await goToPractical();

  fireEvent.click(railItem(/Salle & conditions/));

  expect(screen.getByLabelText('Nombre de tables de 2')).toHaveValue(4);
  expect(screen.getByLabelText('Nombre de tables de 4')).toHaveValue(3);
});

it('ne réécrit les tables que si elles ont changé depuis la dernière sauvegarde', async () => {
  await goToPractical();
  mocks.put.mockClear();

  fireEvent.click(railItem(/Salle & conditions/));
  fireEvent.click(next());
  await waitFor(() => expect(railItem(/Infos pratiques/)).toHaveAttribute('aria-current', 'step'));

  expect(mocks.put).not.toHaveBeenCalledWith('restaurant/onboarding/floor', expect.anything());
});

it('garde la saisie et affiche l’erreur quand la sauvegarde échoue', async () => {
  mocks.put.mockRejectedValue(new Error('Erreur serveur'));
  await renderLoaded();

  fireEvent.click(screen.getByRole('button', { name: 'Petite salle' }));
  fireEvent.click(next());

  expect(await screen.findByRole('alert')).toHaveTextContent('Erreur serveur');
  expect(screen.getByLabelText('Nombre de tables de 2')).toHaveValue(4);
  expect(railItem(/Salle & conditions/)).toHaveAttribute('aria-current', 'step');
});

it('propose de réessayer quand le chargement échoue', async () => {
  mocks.get.mockRejectedValueOnce(new Error('réseau'));
  render(<FloorStep onComplete={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));

  expect(await screen.findByText('Table de 2 personnes')).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
