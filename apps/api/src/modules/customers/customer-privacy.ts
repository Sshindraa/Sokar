/**
 * Shared policy for customer notes and timeline metadata.
 *
 * The site override is stored as a validated CSV on Restaurant. A null or
 * malformed value falls back to the process-level environment setting, and
 * finally to the least-privilege Owner/Manager default.
 */

export const SENSITIVE_NOTE_ROLE_ORDER = [
  'OWNER',
  'MANAGER',
  'STAFF',
  'READ_ONLY',
  'ORG_MEMBER',
] as const;

export type SensitiveNoteRole = (typeof SENSITIVE_NOTE_ROLE_ORDER)[number];

const SENSITIVE_NOTE_ROLE_SET = new Set<string>(SENSITIVE_NOTE_ROLE_ORDER);

function parseConfiguredRoles(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((role) => role.trim().toUpperCase())
    .filter((role) => SENSITIVE_NOTE_ROLE_SET.has(role));
}

export function parseSensitiveNoteRoles(value: string | null | undefined): Set<string> {
  const configured = parseConfiguredRoles(value);
  return new Set(configured.length > 0 ? configured : ['OWNER', 'MANAGER']);
}

export function effectiveSensitiveNoteRoles(siteSensitiveNoteRoles?: string | null): string[] {
  const siteRoles = parseConfiguredRoles(siteSensitiveNoteRoles);
  const environmentRoles = parseConfiguredRoles(process.env.CRM_SENSITIVE_NOTE_ROLES);
  const configured = siteRoles.length > 0 ? siteRoles : environmentRoles;
  return [...new Set(configured.length > 0 ? configured : ['OWNER', 'MANAGER'])].sort(
    (left, right) =>
      SENSITIVE_NOTE_ROLE_ORDER.indexOf(left as SensitiveNoteRole) -
      SENSITIVE_NOTE_ROLE_ORDER.indexOf(right as SensitiveNoteRole),
  );
}

export function hasSensitiveNoteRoleOverride(value: string | null | undefined): boolean {
  return parseConfiguredRoles(value).length > 0;
}

export function canViewSensitiveNotes(
  siteRole: string | undefined,
  siteSensitiveNoteRoles?: string | null,
): boolean {
  return Boolean(
    siteRole &&
    effectiveSensitiveNoteRoles(siteSensitiveNoteRoles).includes(siteRole.toUpperCase()),
  );
}
