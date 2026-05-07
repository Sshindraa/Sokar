'use client';

import { useState } from 'react';

export default function SettingsPage() {
  const [restaurantName, setRestaurantName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    await new Promise((r) => setTimeout(r, 500));
    setSaved(true);
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Paramètres</h1>

      <div className="max-w-lg rounded-xl border border-[var(--border)] p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Nom du restaurant</label>
            <input
              type="text"
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
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
          <button
            type="submit"
            className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
          >
            Enregistrer
          </button>
          {saved && (
            <p className="text-sm text-green-600">Paramètres enregistrés</p>
          )}
        </form>
      </div>

      <div className="max-w-lg rounded-xl border border-[var(--border)] p-6">
        <h2 className="mb-4 text-lg font-semibold">Plan actuel</h2>
        <div className="rounded-lg bg-[var(--muted)] p-4">
          <p className="text-sm font-medium">Starter — 89 € / mois</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            1 500 appels / mois · Pas de commission · Support email
          </p>
        </div>
      </div>
    </div>
  );
}
