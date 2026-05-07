'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, restaurantName }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || 'Erreur lors de l\'inscription');
        return;
      }

      const data = await res.json();
      localStorage.setItem('callyx_token', data.token);
      router.push('/dashboard');
    } catch {
      setError('Erreur de connexion au serveur');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold text-[var(--primary)]">
          Callyx
        </Link>
        <h1 className="mb-6 text-center text-2xl font-semibold">Créer votre compte</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}
          <div>
            <label htmlFor="name" className="block text-sm font-medium">Votre nom</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="restaurantName" className="block text-sm font-medium">Nom du restaurant</label>
            <input
              id="restaurantName"
              type="text"
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium">Mot de passe</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              required
              minLength={8}
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
          >
            Créer mon compte
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[var(--muted-foreground)]">
          Déjà inscrit ?{' '}
          <Link href="/login" className="text-[var(--primary)] underline">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
