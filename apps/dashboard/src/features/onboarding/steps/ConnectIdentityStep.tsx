'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Check, Globe, Loader2, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, Field, SubmitButton, resizeImage } from '../ui';
import type { StepProps } from '../types';

export function ConnectIdentityStep({ onComplete }: StepProps) {
  const { patch, post, get, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;

  const [slug, setSlug] = useState(restaurant.slug || '');
  const [description, setDescription] = useState(restaurant.description || '');
  const [coverImageUrl, setCoverImageUrl] = useState(restaurant.coverImageUrl || '');
  const [saving, setSaving] = useState(false);

  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);

  useEffect(() => {
    if (!slug) {
      setSlugAvailable(null);
      return;
    }
    const regex = /^[a-z0-9-]+$/;
    if (!regex.test(slug)) {
      setSlugAvailable(false);
      return;
    }
    const timeout = setTimeout(async () => {
      setCheckingSlug(true);
      try {
        const res = await get<{ available: boolean }>(`restaurants/check-slug?slug=${slug}`);
        setSlugAvailable(res.available);
      } catch {
        setSlugAvailable(false);
      } finally {
        setCheckingSlug(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- get is stable from useApi()
  }, [slug]);

  async function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const resized = await resizeImage(file, 1000, 1000);
        setCoverImageUrl(resized);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const resized = await resizeImage(file, 1000, 1000);
        setCoverImageUrl(resized);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function setDemoPhoto() {
    setCoverImageUrl(
      'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?q=80&w=1000&auto=format&fit=crop',
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (slugAvailable === false) return;
    setSaving(true);
    try {
      if (coverImageUrl && coverImageUrl !== restaurant.coverImageUrl) {
        await post(`restaurants/${orgId}/images`, { url: coverImageUrl, isCover: true });
      }
      await patch(`restaurants/${orgId}/connect`, { slug, description, coverImageUrl });
      await updateTask('complete', 'connect-identity');
      onComplete('connect-location');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <StepHeader
        icon={Globe}
        title="Identité publique"
        body="C'est ce que vos clients verront sur les fiches d'assistants IA et votre URL personnalisée."
      />
      <div className="space-y-4">
        <Field label="Adresse web (Slug)">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-sm text-muted-foreground">sokar.tech/r/</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
              className="pl-24"
              required
            />
            {checkingSlug && (
              <Loader2 className="absolute right-3 animate-spin text-muted-foreground" size={16} />
            )}
            {!checkingSlug && slugAvailable === true && (
              <Check className="absolute right-3 text-success" size={16} />
            )}
            {!checkingSlug && slugAvailable === false && (
              <span className="absolute right-3 text-xs text-destructive">Indisponible</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Lettres minuscules, chiffres et tirets uniquement.
          </p>
        </Field>

        <Field label="Description courte publique (200 caractères max)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2"
            maxLength={200}
            placeholder="Ex: Un bistrot chaleureux au cœur du Vieux Lyon servant une cuisine traditionnelle revisitée."
            required
          />
        </Field>

        <Field label="Photo de couverture">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors bg-background/40 relative min-h-[160px]"
          >
            {coverImageUrl ? (
              <div className="absolute inset-0 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImageUrl}
                  alt="Cover preview"
                  className="w-full h-full object-cover rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setCoverImageUrl('')}
                  className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 text-xs"
                >
                  Supprimer
                </button>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <Store className="mx-auto text-muted-foreground" size={32} />
                <p className="text-sm text-muted-foreground">Glisse ou dépose une photo ici</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                  id="cover-upload"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('cover-upload')?.click()}
                >
                  Sélectionner un fichier
                </Button>
                <div className="pt-2">
                  <Button type="button" variant="ghost" size="sm" onClick={setDemoPhoto}>
                    Utiliser une photo de démo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Field>

        <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
      </div>
    </form>
  );
}
