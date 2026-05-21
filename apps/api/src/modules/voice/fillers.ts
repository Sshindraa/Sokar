// Mots de transition et fillers pour l'assistant vocal
// Pré-générés par fillers-cache.ts et joués pendant le LLM processing

export const CASUAL_FILLERS = [
  "Je regarde ça…",
  "Un instant je vous prie…",
  "Laissez-moi consulter…",
  "Je vérifie ça pour vous…",
];

export const FORMAL_FILLERS = [
  "Veuillez patienter un instant…",
  "Je consulte nos disponibilités…",
  "Un moment, s'il vous plaît…",
];

export const WARM_FILLERS = [
  "Pas de souci, je regarde ça !",
  "Je m'en occupe tout de suite…",
  "Je vous dis ça dans une seconde…",
];

export function getFillers(style: 'CASUAL' | 'FORMAL' | 'WARM'): string[] {
  switch (style) {
    case 'CASUAL': return CASUAL_FILLERS;
    case 'FORMAL': return FORMAL_FILLERS;
    case 'WARM':   return WARM_FILLERS;
  }
}
