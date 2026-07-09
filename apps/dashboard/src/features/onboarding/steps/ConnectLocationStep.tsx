'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, Field, SubmitButton } from '../ui';
import type { StepProps } from '../types';

export function ConnectLocationStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;

  const [formattedAddress, setFormattedAddress] = useState(restaurant.formattedAddress || '');
  const [postalCode, setPostalCode] = useState(restaurant.postalCode || '');
  const [city, setCity] = useState(restaurant.city || '');
  const [country, setCountry] = useState(restaurant.country || 'FR');
  const [lat, setLat] = useState<number | null>(restaurant.lat || null);
  const [lng, setLng] = useState<number | null>(restaurant.lng || null);

  const [cityQuery, setCityQuery] = useState(city);
  const [citySuggestions, setCitySuggestions] = useState<
    Array<{ nom: string; codesPostaux: string[] }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  useEffect(() => {
    if (cityQuery.length < 2) {
      setCitySuggestions([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(cityQuery)}&fields=nom,codesPostaux&limit=5`,
        );
        if (res.ok) {
          const data = await res.json();
          setCitySuggestions(data);
        }
      } catch (err) {
        console.error(err);
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [cityQuery]);

  useEffect(() => {
    if (!formattedAddress || !postalCode || !city) return;
    const timeout = setTimeout(async () => {
      setGeocoding(true);
      try {
        const q = `${formattedAddress}, ${postalCode} ${city}, France`;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
          { headers: { 'User-Agent': 'Sokar-Dashboard/1.0' } },
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data[0]) {
            setLat(Number(data[0].lat));
            setLng(Number(data[0].lon));
          }
        }
      } catch (err) {
        console.error('Geocoding error', err);
      } finally {
        setGeocoding(false);
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [formattedAddress, postalCode, city]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        formattedAddress,
        postalCode,
        city,
        country,
        lat,
        lng,
      });
      await updateTask('complete', 'connect-location');
      onComplete('connect-cuisine');
    } finally {
      setSaving(false);
    }
  }

  function handleSelectCity(item: { nom: string; codesPostaux: string[] }) {
    setCity(item.nom);
    setCityQuery(item.nom);
    if (item.codesPostaux && item.codesPostaux[0]) {
      setPostalCode(item.codesPostaux[0]);
    }
    setCitySuggestions([]);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <StepHeader
        icon={MapPin}
        title="Localisation"
        body="Renseignez l'adresse physique de votre établissement pour apparaître dans les recherches de proximité."
      />
      <div className="space-y-4">
        <Field label="Adresse (Ligne 1)">
          <Input
            value={formattedAddress}
            onChange={(e) => setFormattedAddress(e.target.value)}
            placeholder="12 rue de la république"
            required
          />
        </Field>

        <div className="grid gap-3 grid-cols-2">
          <div className="relative">
            <Field label="Ville">
              <Input
                value={cityQuery}
                onChange={(e) => {
                  setCityQuery(e.target.value);
                  setCity(e.target.value);
                }}
                placeholder="Paris, Lyon..."
                required
              />
            </Field>
            {citySuggestions.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {citySuggestions.map((item) => (
                  <button
                    key={item.nom}
                    type="button"
                    onClick={() => handleSelectCity(item)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b border-border last:border-b-0"
                  >
                    {item.nom} ({item.codesPostaux?.[0] || ''})
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="Code postal">
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="75001"
              required
            />
          </Field>
        </div>

        <div className="grid gap-3 grid-cols-3">
          <Field label="Pays">
            <Input value={country} onChange={(e) => setCountry(e.target.value)} required />
          </Field>

          <Field label="Latitude">
            <Input
              type="number"
              step="0.000001"
              value={lat || ''}
              onChange={(e) => setLat(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Longitude">
            <Input
              type="number"
              step="0.000001"
              value={lng || ''}
              onChange={(e) => setLng(Number(e.target.value))}
              required
            />
          </Field>
        </div>

        {geocoding && (
          <div className="flex items-center gap-2 text-xs text-warning">
            <Loader2 className="animate-spin" size={14} />
            Calcul des coordonnées GPS en cours...
          </div>
        )}

        {lat && lng && (
          <div className="rounded-lg overflow-hidden border border-border h-48 w-full bg-background relative">
            <iframe
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.003}%2C${lat - 0.002}%2C${lng + 0.003}%2C${lat + 0.002}&layer=mapnik&marker=${lat}%2C${lng}`}
              className="w-full h-full border-0"
              title="Establishment location map preview"
            />
          </div>
        )}

        <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
      </div>
    </form>
  );
}
