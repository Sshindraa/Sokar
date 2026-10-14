import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import * as team from '../team.service';

vi.mock('../team.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../team.service')>();
  return {
    ...actual,
    listTeam: vi.fn(),
    inviteMember: vi.fn(),
    revokeInvitation: vi.fn(),
    changeMemberRole: vi.fn(),
    removeMember: vi.fn(),
  };
});

const AUTH = { authorization: 'Bearer test' };

describe('routes /team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await closeApp();
  });

  it('GET /team liste l’équipe du compte du propriétaire', async () => {
    vi.mocked(team.listTeam).mockResolvedValue({
      members: [{ userId: 'user-1', name: 'Camille', email: null, role: 'OWNER', isYou: true }],
      invitations: [],
    });
    const app = await getApp();

    const res = await app.inject({ method: 'GET', url: '/team', headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(1);
    expect(team.listTeam).toHaveBeenCalledWith({
      organizationId: 'test-rest-1',
      accountId: 'test-account-1',
      currentUserId: 'test-user-1',
    });
  });

  it.each(['MANAGER', 'STAFF'])('refuse la gestion de l’équipe au rôle %s', async (role) => {
    const app = await getApp();
    const headers = { ...AUTH, 'x-test-site-role': role };

    const calls = [
      app.inject({ method: 'GET', url: '/team', headers }),
      app.inject({
        method: 'POST',
        url: '/team/invitations',
        headers,
        payload: { email: 'a@example.com', role: 'STAFF' },
      }),
      app.inject({ method: 'DELETE', url: '/team/invitations/inv_1', headers }),
      app.inject({
        method: 'PATCH',
        url: '/team/members/user-2',
        headers,
        payload: { role: 'STAFF' },
      }),
      app.inject({ method: 'DELETE', url: '/team/members/user-2', headers }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('TEAM_OWNER_REQUIRED');
    }
    expect(team.listTeam).not.toHaveBeenCalled();
    expect(team.inviteMember).not.toHaveBeenCalled();
    expect(team.removeMember).not.toHaveBeenCalled();
  });

  it('refuse sans authentification', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/team' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /team/invitations invite avec le rôle choisi et le lien vers l’inscription', async () => {
    vi.mocked(team.inviteMember).mockResolvedValue({
      id: 'inv_1',
      email: 'serveur@example.com',
      role: 'STAFF',
      createdAt: '2026-10-13T10:00:00.000Z',
    });
    const app = await getApp();

    const res = await app.inject({
      method: 'POST',
      url: '/team/invitations',
      headers: AUTH,
      payload: { email: 'serveur@example.com', role: 'STAFF' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'inv_1', role: 'STAFF' });
    expect(team.inviteMember).toHaveBeenCalledWith({
      organizationId: 'test-rest-1',
      inviterUserId: 'test-user-1',
      email: 'serveur@example.com',
      role: 'STAFF',
      redirectUrl: expect.stringMatching(/\/register$/),
    });
  });

  it('traduit les refus du service en erreurs claires', async () => {
    vi.mocked(team.inviteMember).mockRejectedValue(
      new team.TeamError(
        'ALREADY_INVITED',
        'Une invitation est déjà en attente pour cette adresse.',
      ),
    );
    const app = await getApp();

    const res = await app.inject({
      method: 'POST',
      url: '/team/invitations',
      headers: AUTH,
      payload: { email: 'serveur@example.com', role: 'STAFF' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'ALREADY_INVITED',
      message: 'Une invitation est déjà en attente pour cette adresse.',
    });
  });

  it('répond 502 quand le service de connexion est indisponible', async () => {
    vi.mocked(team.listTeam).mockRejectedValue(
      new team.TeamError(
        'IDENTITY_PROVIDER_UNAVAILABLE',
        'Le service de connexion est indisponible.',
      ),
    );
    const app = await getApp();

    const res = await app.inject({ method: 'GET', url: '/team', headers: AUTH });

    expect(res.statusCode).toBe(502);
  });

  it('refuse une invitation mal formée', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/team/invitations',
      headers: AUTH,
      payload: { email: 42 },
    });
    expect(res.statusCode).toBe(400);
    expect(team.inviteMember).not.toHaveBeenCalled();
  });

  it('DELETE /team/invitations/:id annule l’invitation', async () => {
    vi.mocked(team.revokeInvitation).mockResolvedValue();
    const app = await getApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/team/invitations/inv_1',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(204);
    expect(team.revokeInvitation).toHaveBeenCalledWith({
      organizationId: 'test-rest-1',
      invitationId: 'inv_1',
      requestingUserId: 'test-user-1',
    });
  });

  it('PATCH et DELETE /team/members/:userId changent et retirent un membre', async () => {
    vi.mocked(team.changeMemberRole).mockResolvedValue();
    vi.mocked(team.removeMember).mockResolvedValue();
    const app = await getApp();

    const patch = await app.inject({
      method: 'PATCH',
      url: '/team/members/user-2',
      headers: AUTH,
      payload: { role: 'MANAGER' },
    });
    const del = await app.inject({ method: 'DELETE', url: '/team/members/user-2', headers: AUTH });

    expect(patch.statusCode).toBe(204);
    expect(del.statusCode).toBe(204);
    expect(team.changeMemberRole).toHaveBeenCalledWith({
      accountId: 'test-account-1',
      userId: 'user-2',
      role: 'MANAGER',
      actingUserId: 'test-user-1',
    });
    expect(team.removeMember).toHaveBeenCalledWith({
      organizationId: 'test-rest-1',
      accountId: 'test-account-1',
      userId: 'user-2',
      actingUserId: 'test-user-1',
    });
  });
});
