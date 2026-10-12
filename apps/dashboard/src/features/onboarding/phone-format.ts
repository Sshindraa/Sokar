import { normalizePhone } from '@sokar/shared';

/** Numéro saisi par un restaurateur : chiffres et séparateurs usuels, E.164 plausible, pas de 00000000. */
export function isValidPhoneInput(raw: string) {
  return (
    /^[+\d\s().-]+$/.test(raw) &&
    /^\+[1-9]\d{9,14}$/.test(normalizePhone(raw)) &&
    !/0{8,}$/.test(normalizePhone(raw))
  );
}

/** +33 9 73 03 43 88 → 09 73 03 43 88 : le format qu'un restaurateur français lit au téléphone. */
export function toNationalDisplay(e164: string) {
  const national = e164.startsWith('+33') ? `0${e164.slice(3)}` : e164;
  return /^0\d{9}$/.test(national) ? national.replace(/(\d{2})(?=\d)/g, '$1 ') : national;
}
