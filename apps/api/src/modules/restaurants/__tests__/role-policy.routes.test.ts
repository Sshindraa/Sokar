import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { STAFF_RULES } from '../role-policy';

const STAFF = {
  authorization: 'Bearer test',
  'x-test-site-role': 'STAFF',
  'x-test-enforce-role-policy': '1',
};

describe('politique de rôles sur les vraies routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('chaque règle de l’équipe de service vise une route qui existe encore', async () => {
    const app = await getApp();
    // Un préfixe « en dessous » n'est pas toujours une route à lui seul : on teste une route réelle.
    const representative: Record<string, string> = {
      '/restaurants/:id/service-copilot': '/restaurants/:id/service-copilot/pulse',
    };
    const missing: string[] = [];
    for (const rule of STAFF_RULES) {
      const url = representative[rule.path] ?? rule.path;
      const methods = (rule.methods ?? ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) as Array<'GET'>;
      if (!methods.some((method) => app.hasRoute({ method, url }))) {
        missing.push(`${methods.join('|')} ${url}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("l'équipe de service ne peut pas modifier la fiche du restaurant", async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurants/test-rest-1',
      headers: STAFF,
      payload: { name: 'Autre nom' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ROLE_FORBIDDEN');
    expect(db.restaurant.update).not.toHaveBeenCalled();
  });

  it('l’équipe de service ne lit ni l’équipe, ni la facturation, ni les clients', async () => {
    const app = await getApp();
    for (const url of ['/team', '/billing/status', '/customers', '/calls']) {
      const res = await app.inject({ method: 'GET', url, headers: STAFF });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('l’équipe de service lit la salle et les réservations', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
      id: 'test-rest-1',
      name: 'Le Bistrot',
    } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/restaurants/test-rest-1',
      headers: STAFF,
    });
    expect(res.statusCode).toBe(200);
  });

  it('un rôle en lecture seule ne modifie rien', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurants/test-rest-1',
      headers: { ...STAFF, 'x-test-site-role': 'READ_ONLY' },
      payload: { name: 'Autre nom' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('READ_ONLY_ACCESS');
  });
});
