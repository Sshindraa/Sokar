// Mots de transition et fillers pour l'assistant vocal
// Pré-générés par fillers-cache.ts et joués pendant le LLM processing

export const CASUAL_FILLERS = [
  "Je regarde ça…",
  "Un instant je vous prie…",
  "Laissez-moi consulter…",
  "Je vérifie ça pour vous…",
  "Je regarde ce moment…",
  "C'est en cours…",
  "Je consulte…",
  "Un petit instant…",
  "Je vérifie cela…",
  "Je regarde cette information…",
];

export const FORMAL_FILLERS = [
  "Veuillez patienter un instant…",
  "Je consulte nos disponibilités…",
  "Un moment, s'il vous plaît…",
  "Je vous prie de patienter…",
  "Veuillez nous excuser un instant…",
  "Je vous remercie de votre patience…",
  "Un court instant, je vous prie…",
  "Je me renseigne auprès de notre planning…",
];

export const WARM_FILLERS = [
  "Pas de souci, je regarde ça…",
  "Je m'en occupe tout de suite…",
  "Je vous dis ça dans une seconde…",
  "Je vérifie ça en un clin d'œil…",
  "Je regarde ça avec plaisir…",
  "Laissez-moi jeter un œil…",
  "Je vous trouve ça tout de suite…",
  "Alors, voyons ça ensemble…",
  "Je m'en charge, une petite seconde…",
];

export function getFillers(style: 'CASUAL' | 'FORMAL' | 'WARM'): string[] {
  switch (style) {
    case 'CASUAL': return CASUAL_FILLERS;
    case 'FORMAL': return FORMAL_FILLERS;
    case 'WARM':   return WARM_FILLERS;
  }
}

export function getRandomFiller(style: 'CASUAL' | 'FORMAL' | 'WARM'): string {
  const pool = getFillers(style);
  return pool[Math.floor(Math.random() * pool.length)];
}
