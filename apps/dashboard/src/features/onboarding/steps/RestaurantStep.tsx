'use client';

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useUser } from '@clerk/nextjs';
import { z } from 'zod';
import {
  Check,
  ChevronRight,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  Smartphone,
  Store,
  X,
  type LucideIcon,
} from 'lucide-react';
import { normalizePhone } from '@sokar/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useOnboarding } from '../onboarding-provider';
import { SubmitButton } from '../ui';
import { RestaurantIllustration } from '../restaurant-illustration';
import type { StepProps } from '../types';
import type { PlaceImportDraft } from '../onboarding-provider';

const restaurantDraftSchema = z.object({
  name: z.string(),
  phone: z.string(),
  managerPhone: z.string(),
  managerEmail: z.string(),
});
type RestaurantDraft = z.infer<typeof restaurantDraftSchema>;

type FieldKey = 'name' | 'phone' | 'mobile' | 'email';

function isNameValid(value: string) {
  return value.trim().length > 0;
}

function validPhone(raw: string) {
  return (
    /^[+\d\s().-]+$/.test(raw) &&
    /^\+[1-9]\d{9,14}$/.test(normalizePhone(raw)) &&
    !/0{8,}$/.test(normalizePhone(raw))
  );
}

function isPhoneValid(value: string) {
  return validPhone(value);
}

function isMobileValid(value: string) {
  const normalized = normalizePhone(value);
  return validPhone(value) && (!normalized.startsWith('+33') || /^\+33[67]\d{8}$/.test(normalized));
}

function isEmailValid(value: string) {
  const email = value.trim();
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/\.(?:local|invalid|test|example)$/i.test(email)
  );
}

function placeLabel(place: PlaceImportDraft) {
  return `${place.name}${place.city ? `, ${place.city}` : ''}`;
}

/** +33 9 73 03 43 88 → 09 73 03 43 88 : le format qu'un restaurateur français lit au téléphone. */
function toNationalDisplay(e164: string) {
  const national = e164.startsWith('+33') ? `0${e164.slice(3)}` : e164;
  return /^0\d{9}$/.test(national) ? national.replace(/(\d{2})(?=\d)/g, '$1 ') : national;
}

/** Saisie laissée en cours sur cette étape : elle survit au passage sur une autre étape. */
function readDraft(key: string): RestaurantDraft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = restaurantDraftSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    window.sessionStorage.removeItem(key);
  } catch {
    // Stockage indisponible : la saisie reste en mémoire pendant la visite de l'étape.
  }
  return null;
}

function clearDraft(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Rien à nettoyer si le stockage est indisponible.
  }
}

/**
 * Une coordonnée à vérifier. Affichée comme une information avec « Modifier » quand elle est
 * connue ; affichée comme champ seulement quand elle manque ou qu'on la modifie explicitement.
 */
function FieldRow({
  id,
  icon: Icon,
  label,
  editing,
  display,
  hint,
  emphasis = false,
  error,
  onEdit,
  modifyLabel,
  modifyRef,
  children,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  editing: boolean;
  display: string;
  hint?: string;
  emphasis?: boolean;
  error?: string;
  onEdit: () => void;
  modifyLabel: string;
  modifyRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const attention = Boolean(error) || (editing && display.trim() === '');
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
          attention || emphasis ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <>
            <label htmlFor={id} className="block text-sm font-medium text-foreground/85">
              {label}
            </label>
            <div className="mt-1.5">{children}</div>
            {error ? (
              <p
                id={`${id}-error`}
                role="alert"
                className="mt-1.5 text-xs leading-4 text-destructive"
              >
                {error}
              </p>
            ) : hint ? (
              <p className="mt-1.5 text-[13px] leading-5 text-foreground/70">{hint}</p>
            ) : null}
          </>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-2">
              <p className="pt-1 text-sm font-medium text-foreground/85">{label}</p>
              <button
                ref={modifyRef}
                type="button"
                aria-label={modifyLabel}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onEdit}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-foreground/75 transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Modifier
              </button>
            </div>
            <p
              className={cn(
                'mt-0.5 break-words text-foreground',
                emphasis ? 'text-base font-semibold tabular-nums' : 'text-base font-medium',
              )}
            >
              {display}
            </p>
            {hint && <p className="mt-1 text-[13px] leading-5 text-foreground/70">{hint}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const hasAccountSession =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
  !process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID;

export function RestaurantStep({ onComplete }: StepProps) {
  // Le brouillon vient de sessionStorage : le premier rendu doit rester identique côté serveur
  // et côté client. Monter le formulaire après hydratation évite de perdre la saisie restaurée.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Chargement de vos informations…
      </p>
    );
  }
  return hasAccountSession ? (
    <AccountRestaurantStep onComplete={onComplete} />
  ) : (
    <RestaurantForm onComplete={onComplete} />
  );
}

function AccountRestaurantStep(props: StepProps) {
  const { user } = useUser();
  const email = user?.primaryEmailAddress;
  return (
    <RestaurantForm
      {...props}
      accountEmail={email?.verification.status === 'verified' ? email.emailAddress : undefined}
    />
  );
}

function RestaurantForm({ onComplete, accountEmail }: StepProps & { accountEmail?: string }) {
  const { patch, post, orgId } = useApi();
  const {
    state,
    updateTask,
    placeImportDraft,
    setPlaceImportDraft,
    setRestaurantDraft,
    setIdentityDraft,
  } = useOnboarding();
  const restaurant = state!.restaurant;
  const draftKey = `sokar:onboarding:restaurant-form:v1:${orgId}`;
  // Une saisie restée en cours prime sur les données enregistrées et sur la fiche importée.
  const [savedDraft] = useState(() => readDraft(draftKey));
  const [detailsVisible, setDetailsVisible] = useState(
    Boolean(savedDraft || placeImportDraft || restaurant.googlePlaceId) ||
      state!.steps?.some((step) => step.key === 'restaurant' && step.status === 'completed') ||
      false,
  );
  // La recherche laisse place à la vérification dès qu'une fiche est choisie ou que la saisie manuelle est ouverte.
  const showDetails = detailsVisible || Boolean(placeImportDraft);
  const searchEdited = useRef(false);
  const formEdited = useRef(false);
  const emailEdited = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameModifyRef = useRef<HTMLButtonElement>(null);
  const phoneModifyRef = useRef<HTMLButtonElement>(null);
  const mobileModifyRef = useRef<HTMLButtonElement>(null);
  const emailModifyRef = useRef<HTMLButtonElement>(null);
  // Où placer le focus après un changement de mode : sur le champ, ou sur le bouton « Modifier ».
  const focusTarget = useRef<{ field: FieldKey; kind: 'input' | 'modify' } | null>(null);
  // Le focus suit l'action : après une fiche choisie ou une saisie manuelle, il va au premier champ à compléter.
  const focusPending = useRef(false);
  // Après « Changer » ou « Rechercher ma fiche », la recherche reprend le focus.
  const focusSearchPending = useRef(false);
  const [name, setName] = useState(savedDraft?.name ?? restaurant.name ?? '');
  const [publicPhone, setPublicPhone] = useState(
    savedDraft?.phone ?? toNationalDisplay(restaurant.phoneE164 || ''),
  );
  const [managerPhone, setManagerPhone] = useState(
    savedDraft?.managerPhone ?? toNationalDisplay(restaurant.managerPhone || ''),
  );
  const [managerEmail, setManagerEmail] = useState(
    savedDraft?.managerEmail ?? (restaurant.managerEmail || accountEmail || ''),
  );
  // Une coordonnée est un champ quand elle manque ou qu'on la modifie ; sinon elle reste une information.
  const [editing, setEditing] = useState<Record<FieldKey, boolean>>(() => ({
    name: !isNameValid(name),
    phone: !isPhoneValid(publicPhone),
    mobile: !isMobileValid(managerPhone),
    email: !isEmailValid(managerEmail),
  }));
  const [googlePlaceId, setGooglePlaceId] = useState(
    placeImportDraft?.placeId || restaurant.googlePlaceId || null,
  );
  const [nameTouched, setNameTouched] = useState(Boolean(name));
  const [phoneTouched, setPhoneTouched] = useState(Boolean(publicPhone));
  const [managerPhoneTouched, setManagerPhoneTouched] = useState(Boolean(managerPhone));
  const [emailTouched, setEmailTouched] = useState(Boolean(managerEmail));
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState(
    placeImportDraft ? placeLabel(placeImportDraft) : '',
  );
  const [suggestions, setSuggestions] = useState<
    Array<{ placeId: string; mainText: string; secondaryText: string }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [completedSearch, setCompletedSearch] = useState('');
  const [selectingPlace, setSelectingPlace] = useState(false);
  const [searchError, setSearchError] = useState('');
  const sessionToken = useRef('');
  const selectedPlaceLabel = useRef(placeImportDraft ? placeLabel(placeImportDraft) : '');

  const nameValid = isNameValid(name);
  const phoneValid = isPhoneValid(publicPhone);
  const mobileValid = isMobileValid(managerPhone);
  const emailValid = isEmailValid(managerEmail);
  const normalizedManagerPhone = normalizePhone(managerPhone);
  const normalizedPublicPhone = normalizePhone(publicPhone);
  const missingCount = [nameValid, phoneValid, mobileValid, emailValid].filter((v) => !v).length;
  const missingContactCount = [mobileValid, emailValid].filter((valid) => !valid).length;
  // Premier champ à compléter : c'est vers lui que va le focus, depuis le compteur ou après un envoi refusé.
  const firstMissingField: FieldKey | null = !nameValid
    ? 'name'
    : !phoneValid
      ? 'phone'
      : !mobileValid
        ? 'mobile'
        : !emailValid
          ? 'email'
          : null;

  useEffect(() => {
    if (accountEmail && !restaurant.managerEmail && !emailEdited.current && !savedDraft) {
      setManagerEmail(accountEmail);
      setEmailTouched(true);
      setEditing((prev) => ({ ...prev, email: !isEmailValid(accountEmail) }));
    }
  }, [accountEmail, restaurant.managerEmail, savedDraft]);

  useEffect(() => {
    if (!formEdited.current) return;
    try {
      window.sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          name,
          phone: publicPhone,
          managerPhone,
          managerEmail,
        } satisfies RestaurantDraft),
      );
    } catch {
      // Stockage indisponible : la saisie n'est pas gardée entre deux étapes, l'onboarding continue.
    }
  }, [draftKey, name, publicPhone, managerPhone, managerEmail]);

  useEffect(() => {
    if (searchQuery && searchQuery === selectedPlaceLabel.current) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }
    if (searchQuery.trim().length < 2) {
      setSuggestions([]);
      setCompletedSearch('');
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      const token = sessionToken.current || crypto.randomUUID();
      sessionToken.current = token;
      try {
        const result = await post<{
          suggestions: Array<{ placeId: string; mainText: string; secondaryText: string }>;
        }>(
          'restaurant/onboarding/places/autocomplete',
          { query: searchQuery.trim(), sessionToken: token },
          { signal: controller.signal },
        );
        setSuggestions(result.suggestions);
        setCompletedSearch(searchQuery.trim());
      } catch (error) {
        if (!controller.signal.aborted) {
          setSearchError(error instanceof Error ? error.message : 'Recherche indisponible.');
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery, post]);

  useEffect(() => {
    if (!placeImportDraft) return;
    setGooglePlaceId(placeImportDraft.placeId);
    if (!searchEdited.current) {
      selectedPlaceLabel.current = placeLabel(placeImportDraft);
      setSearchQuery(selectedPlaceLabel.current);
    }
    if (savedDraft) return;
    const nextName = placeImportDraft.displayName || placeImportDraft.name || restaurant.name || '';
    const nextPhone = toNationalDisplay(placeImportDraft.phoneE164);
    setName(nextName);
    setNameTouched(true);
    setPublicPhone(nextPhone);
    setPhoneTouched(true);
    setEditing((prev) => ({
      ...prev,
      name: !isNameValid(nextName),
      phone: !isPhoneValid(nextPhone),
    }));
  }, [placeImportDraft, restaurant.name, restaurant.phoneE164, savedDraft]);

  useEffect(() => {
    if (!focusSearchPending.current || showDetails) return;
    focusSearchPending.current = false;
    searchInputRef.current?.focus();
  }, [showDetails, placeImportDraft]);

  useEffect(() => {
    if (!focusPending.current || !showDetails) return;
    focusPending.current = false;
    if (firstMissingField) {
      focusTarget.current = { field: firstMissingField, kind: 'input' };
      setEditing((prev) => ({ ...prev, [firstMissingField]: true }));
    } else {
      headingRef.current?.focus();
    }
  }, [showDetails, placeImportDraft, firstMissingField]);

  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    const elements: Record<FieldKey, HTMLElement | null> =
      target.kind === 'input'
        ? {
            name: nameRef.current,
            phone: phoneRef.current,
            mobile: mobileRef.current,
            email: emailRef.current,
          }
        : {
            name: nameModifyRef.current,
            phone: phoneModifyRef.current,
            mobile: mobileModifyRef.current,
            email: emailModifyRef.current,
          };
    elements[target.field]?.focus();
  }, [editing]);

  async function selectPlace(suggestion: { placeId: string; mainText: string }) {
    setSelectingPlace(true);
    setSearchError('');
    try {
      const token = sessionToken.current || crypto.randomUUID();
      const place = await post<PlaceImportDraft>('restaurant/onboarding/places/details', {
        placeId: suggestion.placeId,
        sessionToken: token,
      });
      const nextName = place.displayName || place.name || name;
      const nextPhone = toNationalDisplay(place.phoneE164);
      if (googlePlaceId !== place.placeId) setIdentityDraft?.(null);
      setPlaceImportDraft(place);
      setDetailsVisible(true);
      setGooglePlaceId(place.placeId);
      setName(nextName);
      setNameTouched(true);
      setPublicPhone(nextPhone);
      setPhoneTouched(true);
      setEditing((prev) => ({
        ...prev,
        name: !isNameValid(nextName),
        phone: !isPhoneValid(nextPhone),
      }));
      const selectedLabel = `${place.name || suggestion.mainText}${place.city ? `, ${place.city}` : ''}`;
      selectedPlaceLabel.current = selectedLabel;
      setSearchQuery(selectedLabel);
      setCompletedSearch('');
      setSuggestions([]);
      sessionToken.current = '';
      focusPending.current = true;
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : 'Impossible de charger cet établissement.',
      );
    } finally {
      setSelectingPlace(false);
    }
  }

  function removePlaceSuggestion() {
    if (!placeImportDraft) return;
    setPlaceImportDraft(null);
    setDetailsVisible(false);
    setGooglePlaceId(null);
    setName((current) =>
      current === (placeImportDraft.displayName || placeImportDraft.name)
        ? restaurant.name || ''
        : current,
    );
    setPublicPhone((current) =>
      normalizePhone(current) === normalizePhone(placeImportDraft.phoneE164)
        ? toNationalDisplay(restaurant.phoneE164 || '')
        : current,
    );
    setSearchQuery('');
    setCompletedSearch('');
    selectedPlaceLabel.current = '';
    sessionToken.current = '';
    setSuggestions([]);
    setSearchError('');
    focusSearchPending.current = true;
  }

  function startManualEntry() {
    focusPending.current = true;
    setDetailsVisible(true);
    setEditing((prev) => ({
      name: prev.name || !nameValid,
      phone: prev.phone || !phoneValid,
      mobile: prev.mobile || !mobileValid,
      email: prev.email || !emailValid,
    }));
  }

  function backToSearch() {
    setDetailsVisible(false);
    focusSearchPending.current = true;
  }

  function startEdit(field: FieldKey) {
    focusTarget.current = { field, kind: 'input' };
    setEditing((prev) => ({ ...prev, [field]: true }));
  }

  /** Quitter un champ (sortie ou Entrée) : une valeur correcte repasse en information, une erreur reste visible. */
  function commitRow(field: FieldKey, valid: boolean, viaKeyboard: boolean) {
    if (!valid) return;
    if (viaKeyboard) focusTarget.current = { field, kind: 'modify' };
    setEditing((prev) => ({ ...prev, [field]: false }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!showDetails) return;
    setNameTouched(true);
    setPhoneTouched(true);
    setManagerPhoneTouched(true);
    setEmailTouched(true);
    setSubmitError('');
    if (firstMissingField) {
      startEdit(firstMissingField);
      return;
    }
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}`, {
        name: name.trim(),
        managerPhone: normalizedManagerPhone,
        managerEmail: managerEmail.trim(),
        phoneE164: normalizedPublicPhone,
        googlePlaceId,
      });
      if (placeImportDraft) {
        await patch(`restaurants/${orgId}/connect`, {
          formattedAddress: placeImportDraft.formattedAddress,
          postalCode: placeImportDraft.postalCode,
          city: placeImportDraft.city,
          country: placeImportDraft.country,
          lat: placeImportDraft.lat ?? null,
          lng: placeImportDraft.lng ?? null,
        });
      }
      setRestaurantDraft?.({
        name: name.trim(),
        managerPhone: normalizedManagerPhone,
        managerEmail: managerEmail.trim(),
        phoneE164: normalizedPublicPhone,
        googlePlaceId,
        ...(placeImportDraft
          ? {
              formattedAddress: placeImportDraft.formattedAddress,
              postalCode: placeImportDraft.postalCode,
              city: placeImportDraft.city,
              country: placeImportDraft.country,
              lat: placeImportDraft.lat ?? null,
              lng: placeImportDraft.lng ?? null,
            }
          : {}),
      });
      const completed = await updateTask('complete', 'restaurant');
      if (!completed) throw new Error('completion failed');
      clearDraft(draftKey);
      onComplete('hours');
    } catch {
      setSubmitError('Impossible d’enregistrer vos coordonnées. Réessayez.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="onboarding-voice-form"
      onSubmit={handleSubmit}
      noValidate
      className="w-full space-y-6"
    >
      {!showDetails ? (
        <div className="grid items-stretch gap-5 animate-in fade-in-0 duration-200 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-5 rounded-[2.25rem] bg-card p-6 sm:p-8">
            <div className="mb-6">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <MapPin size={21} aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">
                Retrouvez votre restaurant
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Un nom, une ville. Vos informations sont préremplies depuis votre fiche Google Maps.
              </p>
            </div>
            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                maxLength={120}
                onChange={(event) => {
                  searchEdited.current = true;
                  setSearchQuery(event.target.value);
                  setSearchError('');
                  setSuggestions([]);
                  setCompletedSearch('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && suggestions.length > 0) {
                    event.preventDefault();
                    suggestionsRef.current
                      ?.querySelector<HTMLButtonElement>('[role="option"]')
                      ?.focus();
                    return;
                  }
                  if (event.key === 'Escape') {
                    setSuggestions([]);
                    setCompletedSearch('');
                    return;
                  }
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (suggestions[0] && !selectingPlace) void selectPlace(suggestions[0]);
                }}
                placeholder="Nom de votre établissement et sa ville"
                autoComplete="off"
                className="h-12 rounded-full border-0 bg-muted pl-12 pr-12 text-base placeholder:text-muted-foreground/70 placeholder:opacity-100 md:text-base"
                aria-label="Rechercher votre établissement sur Google Maps"
                aria-expanded={suggestions.length > 0}
                aria-controls="onboarding-place-suggestions"
              />
              {searchLoading || selectingPlace ? (
                <Loader2
                  size={17}
                  className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
                  aria-label="Recherche en cours"
                />
              ) : (
                searchQuery && (
                  <button
                    type="button"
                    aria-label="Effacer la recherche"
                    onClick={() => {
                      setSearchQuery('');
                      setSuggestions([]);
                      setCompletedSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-2.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )
              )}
            </div>

            {suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                id="onboarding-place-suggestions"
                role="listbox"
                aria-label="Établissements trouvés"
                onKeyDown={(event) => {
                  const options = Array.from(
                    suggestionsRef.current?.querySelectorAll<HTMLButtonElement>(
                      '[role="option"]',
                    ) ?? [],
                  );
                  const index = options.indexOf(document.activeElement as HTMLButtonElement);
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    options[Math.min(index + 1, options.length - 1)]?.focus();
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (index <= 0) searchInputRef.current?.focus();
                    else options[index - 1]?.focus();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setSuggestions([]);
                    setCompletedSearch('');
                    searchInputRef.current?.focus();
                  }
                }}
                className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-sm animate-in fade-in-0 duration-200"
              >
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    role="option"
                    aria-selected="false"
                    disabled={selectingPlace}
                    onClick={() => void selectPlace(suggestion)}
                    className="group flex w-full items-center gap-4 border-b border-border px-4 py-3.5 text-left transition-all duration-200 last:border-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <MapPin size={16} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {suggestion.mainText}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {suggestion.secondaryText}
                      </span>
                    </span>
                    <ChevronRight
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  </button>
                ))}
                <div className="flex items-center gap-1.5 border-t border-border/70 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
                  <span>Source :</span>
                  <span className="font-medium" translate="no">
                    Google Maps
                  </span>
                </div>
              </div>
            )}

            {completedSearch.length > 0 &&
              completedSearch === searchQuery.trim() &&
              !searchLoading &&
              !selectingPlace &&
              suggestions.length === 0 &&
              !searchError && (
                <p role="status" className="px-1 text-sm text-muted-foreground">
                  Aucun résultat trouvé. Essayez avec un nom et une ville.
                </p>
              )}
            {searchError && (
              <p role="alert" className="px-1 text-sm text-destructive">
                {searchError}
              </p>
            )}

            <div className="pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={startManualEntry}
                disabled={selectingPlace}
                className="h-auto whitespace-normal rounded-full bg-muted px-4 py-2.5 text-xs text-muted-foreground transition-all duration-200 hover:text-foreground"
              >
                Saisir mes informations manuellement
              </Button>
            </div>
          </div>
          <div className="hidden lg:block">
            <RestaurantIllustration />
          </div>
        </div>
      ) : (
        <div className="space-y-5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          {placeImportDraft && (
            <div className="flex flex-wrap items-center gap-3 rounded-3xl bg-muted/70 px-5 py-4 sm:flex-nowrap sm:gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-brand">
                <MapPin size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-xl font-semibold tracking-tight text-foreground">
                  {placeImportDraft.name || name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {placeImportDraft.formattedAddress && (
                    <p className="text-sm leading-5 text-foreground/70">
                      {placeImportDraft.formattedAddress}
                    </p>
                  )}
                  <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Check size={12} aria-hidden="true" />
                    Fiche retrouvée via Google Maps
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={removePlaceSuggestion}
                className="ml-auto w-full shrink-0 rounded-full bg-card/70 px-3 py-2 text-xs font-medium text-foreground/75 transition-all duration-200 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
              >
                Changer d’établissement
              </button>
            </div>
          )}

          <section aria-labelledby="restaurant-verify-heading" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h3
                ref={headingRef}
                tabIndex={-1}
                id="restaurant-verify-heading"
                className="text-base font-semibold tracking-tight text-foreground outline-none"
              >
                {placeImportDraft ? 'Vos informations' : 'Saisie manuelle'}
              </h3>
              <div className="flex items-center gap-3">
                {!placeImportDraft && (
                  <button
                    type="button"
                    onClick={backToSearch}
                    className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors duration-200 hover:text-foreground hover:underline"
                  >
                    Rechercher ma fiche
                  </button>
                )}
                {missingCount > 0 && (!nameValid || !phoneValid) ? (
                  <button
                    type="button"
                    onClick={() => firstMissingField && startEdit(firstMissingField)}
                    title="Aller au premier champ à compléter"
                    className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-primary transition-all duration-200 hover:bg-accent"
                  >
                    {missingCount} à compléter
                  </button>
                ) : missingCount === 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-onboarding-complete/10 px-2.5 py-0.5 text-xs font-semibold text-onboarding-complete">
                    <Check size={12} aria-hidden="true" />
                    Prêt à continuer
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <section
                aria-labelledby="restaurant-details-title"
                className="overflow-hidden rounded-3xl bg-card/60"
              >
                <div className="px-5 pb-2 pt-5 text-foreground">
                  <p className="mb-1.5 flex min-h-6 items-center text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/70">
                    À vérifier
                  </p>
                  <h4
                    id="restaurant-details-title"
                    className="text-xl font-semibold tracking-tight"
                  >
                    Informations clients
                  </h4>
                </div>
                <div className="pb-2">
                  <FieldRow
                    id="review-name"
                    icon={Store}
                    label="Nom du restaurant"
                    editing={editing.name}
                    display={name}
                    hint="Utilisé sur votre page et par l’assistant au téléphone."
                    error={
                      nameTouched && !nameValid ? 'Renseignez le nom du restaurant.' : undefined
                    }
                    onEdit={() => startEdit('name')}
                    modifyLabel="Modifier le nom"
                    modifyRef={nameModifyRef}
                  >
                    <Input
                      ref={nameRef}
                      id="review-name"
                      className="h-11 rounded-full border-0 bg-muted text-base font-medium placeholder:text-muted-foreground"
                      aria-label="Nom du restaurant"
                      autoComplete="organization"
                      value={name}
                      onChange={(event) => {
                        formEdited.current = true;
                        setName(event.target.value);
                      }}
                      onBlur={() => {
                        setNameTouched(true);
                        commitRow('name', nameValid, false);
                      }}
                      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        setNameTouched(true);
                        commitRow('name', nameValid, true);
                      }}
                      placeholder="Nom de votre restaurant"
                      aria-invalid={nameTouched && !nameValid}
                      aria-describedby={nameTouched && !nameValid ? 'review-name-error' : undefined}
                      required
                    />
                  </FieldRow>

                  <FieldRow
                    id="review-phone"
                    icon={Phone}
                    label="Numéro appelé par vos clients"
                    emphasis
                    editing={editing.phone}
                    display={publicPhone}
                    hint="Le renvoi se règle à l’étape « Appels »."
                    error={
                      phoneTouched && !phoneValid
                        ? 'Saisissez le numéro que vos clients appellent.'
                        : undefined
                    }
                    onEdit={() => startEdit('phone')}
                    modifyLabel="Modifier le téléphone"
                    modifyRef={phoneModifyRef}
                  >
                    <Input
                      ref={phoneRef}
                      id="review-phone"
                      type="tel"
                      className="h-11 rounded-full border-0 bg-muted tabular-nums placeholder:text-muted-foreground"
                      aria-label="Numéro appelé par vos clients"
                      autoComplete="section-restaurant tel"
                      value={publicPhone}
                      onChange={(event) => {
                        formEdited.current = true;
                        setPublicPhone(event.target.value);
                      }}
                      onBlur={() => {
                        setPhoneTouched(true);
                        commitRow('phone', phoneValid, false);
                      }}
                      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        setPhoneTouched(true);
                        commitRow('phone', phoneValid, true);
                      }}
                      placeholder="Ex. 01 23 45 67 89"
                      aria-invalid={phoneTouched && !phoneValid}
                      aria-describedby={
                        phoneTouched && !phoneValid ? 'review-phone-error' : undefined
                      }
                      required
                    />
                  </FieldRow>
                </div>
              </section>
              <section
                aria-labelledby="restaurant-contact-title"
                className="overflow-hidden rounded-3xl bg-brand/10"
              >
                <div className="px-5 pb-2 pt-5">
                  <div className="mb-1.5 flex min-h-6 flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/70">
                      Pour gérer Sokar
                    </p>
                    {missingContactCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => startEdit(!mobileValid ? 'mobile' : 'email')}
                        title="Aller au premier champ de contact à compléter"
                        className="rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium leading-4 text-foreground/85 transition-all duration-200 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {missingContactCount} à compléter
                      </button>
                    ) : (
                      <span className="rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium leading-4 text-foreground/85">
                        Coordonnées complètes
                      </span>
                    )}
                  </div>
                  <h4
                    id="restaurant-contact-title"
                    className="text-xl font-semibold tracking-tight"
                  >
                    {missingContactCount > 0 ? 'Complétez vos coordonnées' : 'Vos coordonnées'}
                  </h4>
                </div>
                <div className="pb-2">
                  <FieldRow
                    id="review-mobile"
                    icon={Smartphone}
                    label="Mobile du responsable"
                    emphasis
                    editing={editing.mobile}
                    display={managerPhone}
                    error={
                      managerPhoneTouched && !mobileValid
                        ? 'Saisissez un numéro de mobile valide, par exemple 06 12 34 56 78.'
                        : undefined
                    }
                    onEdit={() => startEdit('mobile')}
                    modifyLabel="Modifier le mobile"
                    modifyRef={mobileModifyRef}
                  >
                    <Input
                      ref={mobileRef}
                      id="review-mobile"
                      type="tel"
                      className="h-11 rounded-full border-0 bg-background/80 tabular-nums placeholder:text-muted-foreground"
                      aria-label="Mobile du responsable"
                      autoComplete="section-manager tel"
                      value={managerPhone}
                      onChange={(event) => {
                        formEdited.current = true;
                        setManagerPhone(event.target.value);
                      }}
                      onBlur={() => {
                        setManagerPhoneTouched(true);
                        commitRow('mobile', mobileValid, false);
                      }}
                      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        setManagerPhoneTouched(true);
                        commitRow('mobile', mobileValid, true);
                      }}
                      placeholder="Ex. 06 12 34 56 78"
                      aria-invalid={managerPhoneTouched && !mobileValid}
                      aria-describedby={
                        managerPhoneTouched && !mobileValid ? 'review-mobile-error' : undefined
                      }
                      required
                    />
                  </FieldRow>

                  <FieldRow
                    id="review-email"
                    icon={Mail}
                    label="Email pour gérer Sokar"
                    emphasis
                    editing={editing.email}
                    display={managerEmail}
                    hint="Pour le rapport du soir et la facturation."
                    error={
                      emailTouched && !emailValid
                        ? 'Saisissez une adresse email valide.'
                        : undefined
                    }
                    onEdit={() => {
                      emailEdited.current = true;
                      startEdit('email');
                    }}
                    modifyLabel="Modifier l’email de gestion"
                    modifyRef={emailModifyRef}
                  >
                    <Input
                      ref={emailRef}
                      id="review-email"
                      type="email"
                      className="h-11 rounded-full border-0 bg-background/80 placeholder:text-muted-foreground"
                      aria-label="Email pour gérer Sokar"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={managerEmail}
                      onChange={(event) => {
                        emailEdited.current = true;
                        formEdited.current = true;
                        setManagerEmail(event.target.value);
                      }}
                      onBlur={() => {
                        setEmailTouched(true);
                        commitRow('email', emailValid, false);
                      }}
                      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        setEmailTouched(true);
                        commitRow('email', emailValid, true);
                      }}
                      placeholder="Ex. contact@votre-restaurant.fr"
                      aria-invalid={emailTouched && !emailValid}
                      aria-describedby={
                        emailTouched && !emailValid ? 'review-email-error' : undefined
                      }
                      required
                    />
                  </FieldRow>
                </div>
              </section>
            </div>

            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}
          </section>
        </div>
      )}

      <SubmitButton saving={saving} disabled={!showDetails}>
        Confirmer et continuer
      </SubmitButton>
    </form>
  );
}
