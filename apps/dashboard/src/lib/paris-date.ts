/** Jour courant à Paris, AAAA-MM-JJ : les services se règlent sur l'heure de la salle. */
export function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
