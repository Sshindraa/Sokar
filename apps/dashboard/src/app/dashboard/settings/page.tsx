'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../lib/api';

export default function SettingsPage() {
  const { get, patch, orgId } = useApi();

  const [restaurant, setRestaurant] = useState<any>(null);
  const [name, setName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      try {
        const data = await get(`restaurants/${orgId}`);
        setRestaurant(data);
        setName(data.name || '');
        setManagerPhone(data.managerPhone || '');
        setManagerEmail(data.managerEmail || '');
      } catch {
        setError('Impossible de charger les paramètres');
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');

    try {
      await patch(`restaurants/${orgId}`, { name, managerPhone, managerEmail });
      setSaved(true);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-center text-[var(--muted-foreground)]">Chargement...</div>;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Paramètres</h1>

      <div className="max-w-lg rounded-xl border border-[var(--border)] p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium">Nom du restaurant</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Téléphone du gérant</label>
            <input
              type="tel"
              value={managerPhone}
              onChange={(e) => setManagerPhone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Email du gérant</label>
            <input
              type="email"
              value={managerEmail}
              onChange={(e) => setManagerEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          {saved && (
            <p className="text-sm text-green-600">Paramètres enregistrés</p>
          )}
        </form>
      </div>

      <div className="max-w-lg rounded-xl border border-[var(--border)] p-6">
        <h2 className="mb-4 text-lg font-semibold">Plan actuel</h2>
        <div className="rounded-lg bg-[var(--muted)] p-4">
          <p className="text-sm font-medium capitalize">{restaurant?.plan ?? 'Starter'} — 149 € / mois</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            1 500 appels / mois · Pas de commission · Support email
          </p>
        </div>
      </div>
    </div>
  );
}
