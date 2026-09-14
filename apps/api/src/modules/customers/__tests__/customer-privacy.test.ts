import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  canViewSensitiveNotes,
  effectiveSensitiveNoteRoles,
  hasSensitiveNoteRoleOverride,
  parseSensitiveNoteRoles,
} from '../customer-privacy';

const originalEnvironmentRoles = process.env.CRM_SENSITIVE_NOTE_ROLES;

describe('customer privacy policy', () => {
  beforeEach(() => {
    delete process.env.CRM_SENSITIVE_NOTE_ROLES;
  });

  afterAll(() => {
    if (originalEnvironmentRoles === undefined) delete process.env.CRM_SENSITIVE_NOTE_ROLES;
    else process.env.CRM_SENSITIVE_NOTE_ROLES = originalEnvironmentRoles;
  });

  it('uses the least-privilege default when no value is configured', () => {
    expect(effectiveSensitiveNoteRoles()).toEqual(['OWNER', 'MANAGER']);
    expect(canViewSensitiveNotes('OWNER')).toBe(true);
    expect(canViewSensitiveNotes('STAFF')).toBe(false);
  });

  it('normalizes roles and removes duplicates before exposing the effective policy', () => {
    process.env.CRM_SENSITIVE_NOTE_ROLES = ' staff, OWNER,staff,unknown ';

    expect(parseSensitiveNoteRoles(process.env.CRM_SENSITIVE_NOTE_ROLES)).toEqual(
      new Set(['STAFF', 'OWNER']),
    );
    expect(effectiveSensitiveNoteRoles()).toEqual(['OWNER', 'STAFF']);
  });

  it('falls back to the environment policy when a site override is malformed', () => {
    process.env.CRM_SENSITIVE_NOTE_ROLES = 'OWNER,STAFF';

    expect(effectiveSensitiveNoteRoles('not-a-role')).toEqual(['OWNER', 'STAFF']);
    expect(hasSensitiveNoteRoleOverride('not-a-role')).toBe(false);
    expect(canViewSensitiveNotes('STAFF', 'not-a-role')).toBe(true);
  });

  it('gives a valid site override precedence over the environment policy', () => {
    process.env.CRM_SENSITIVE_NOTE_ROLES = 'OWNER,STAFF';

    expect(effectiveSensitiveNoteRoles('OWNER,MANAGER')).toEqual(['OWNER', 'MANAGER']);
    expect(hasSensitiveNoteRoleOverride('OWNER,MANAGER')).toBe(true);
    expect(canViewSensitiveNotes('STAFF', 'OWNER,MANAGER')).toBe(false);
  });
});
