'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  Ban,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Gift,
  Info,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  Ticket,
  UserRound,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage, type Customer } from '@/types/api';

type BenefitRule = 'ANY' | 'VIP' | 'MIN_VISITS' | 'BIRTHDAY_MONTH' | 'MIN_ESTIMATED_SPEND';
type BenefitStatus = 'ACTIVE' | 'INACTIVE';
type GrantStatus = 'ISSUED' | 'REDEEMED' | 'VOID' | 'EXPIRED';

type Benefit = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rule: BenefitRule;
  ruleValue: number | null;
  costCents: number | null;
  currency: string;
  validityDays: number;
  maxUsesPerCustomer: number;
  status: BenefitStatus;
  grantCount: number;
};

type Grant = {
  id: string;
  benefitId: string;
  customerId: string;
  reservationId: string | null;
  status: GrantStatus;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  voidedAt: string | null;
  redemptionNote: string | null;
  benefit: { key: string; name: string; costCents: number | null; currency: string };
  customerName: string | null;
  phoneLast4: string;
};

type ListResponse<T> = T[] | { data?: T[] };
type MutationResponse<T> = { data?: T };
type IssueResponse = MutationResponse<Grant & { code: string | null; replayed: boolean }>;

type BenefitForm = {
  key: string;
  name: string;
  description: string;
  rule: BenefitRule;
  ruleValue: string;
  costEuros: string;
  validityDays: string;
  maxUsesPerCustomer: string;
};

const RULE_LABELS: Record<BenefitRule, string> = {
  ANY: 'Tous les clients',
  VIP: 'Clients VIP',
  MIN_VISITS: 'À partir d’un nombre de visites',
  BIRTHDAY_MONTH: 'Anniversaire ce mois-ci',
  MIN_ESTIMATED_SPEND: 'À partir d’une dépense cumulée',
};

const RULE_OPTIONS: Array<{
  value: BenefitRule;
  label: string;
  hint: string;
  valueLabel?: string;
  valueHint?: string;
  inputMode?: 'numeric' | 'decimal';
  step?: string;
}> = [
  {
    value: 'ANY',
    label: RULE_LABELS.ANY,
    hint: 'L’équipe peut attribuer cette attention à n’importe quel client.',
  },
  {
    value: 'VIP',
    label: RULE_LABELS.VIP,
    hint: 'Réservé aux clients marqués VIP dans le fichier client.',
  },
  {
    value: 'MIN_VISITS',
    label: RULE_LABELS.MIN_VISITS,
    hint: 'Le client doit avoir atteint ce nombre de visites enregistrées.',
    valueLabel: 'Nombre de visites requis',
    valueHint: 'Exemple : 5 visites.',
    inputMode: 'numeric',
    step: '1',
  },
  {
    value: 'BIRTHDAY_MONTH',
    label: RULE_LABELS.BIRTHDAY_MONTH,
    hint: 'Le mois de naissance du client doit correspondre au mois actuel.',
  },
  {
    value: 'MIN_ESTIMATED_SPEND',
    label: RULE_LABELS.MIN_ESTIMATED_SPEND,
    hint: 'Le client doit avoir atteint ce montant estimé sur les 365 derniers jours.',
    valueLabel: 'Dépense cumulée minimale (€)',
    valueHint: 'Saisissez un montant en euros, par exemple 100,00.',
    inputMode: 'decimal',
    step: '0.01',
  },
];

const JOURNEY_STEPS = [
  {
    number: '1',
    title: 'Créer une attention',
    description: 'Définissez la règle, le coût et la durée de validité.',
    icon: Gift,
  },
  {
    number: '2',
    title: 'L’attribuer au client',
    description: 'L’équipe choisit le client et reçoit un code à lui remettre.',
    icon: UserRound,
  },
  {
    number: '3',
    title: 'La valider en salle',
    description: 'Le code est contrôlé à l’addition et l’utilisation est tracée.',
    icon: CheckCircle2,
  },
] as const;

function emptyBenefitForm(): BenefitForm {
  return {
    key: '',
    name: '',
    description: '',
    rule: 'ANY',
    ruleValue: '',
    costEuros: '',
    validityDays: '30',
    maxUsesPerCustomer: '1',
  };
}

function unwrapList<T>(response: ListResponse<T>): T[] {
  if (Array.isArray(response)) return response;
  return Array.isArray(response.data) ? response.data : [];
}

function formatEur(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return 'Non renseigné';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('fr-FR', { dateStyle: 'medium' });
}

function parseEuroCents(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const euros = Number(normalized);
  if (!Number.isFinite(euros) || euros < 0) return null;
  const cents = Math.round(euros * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function slugifyBenefitKey(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return /^[a-z][a-z0-9-]{1,47}$/.test(slug) ? slug : 'attention-' + Date.now().toString(36);
}

function formatCustomerPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits ? '•••• ' + digits.slice(-4).padStart(4, '•') : 'Téléphone non renseigné';
}

function formatCustomerLabel(customer: Customer): string {
  return (customer.name?.trim() || 'Client sans nom') + ' · ' + formatCustomerPhone(customer.phone);
}

function benefitRuleSummary(benefit: Benefit): string {
  if (benefit.rule === 'MIN_VISITS') {
    return (
      (benefit.ruleValue ?? 0) + ' visite' + ((benefit.ruleValue ?? 0) > 1 ? 's' : '') + ' minimum'
    );
  }
  if (benefit.rule === 'MIN_ESTIMATED_SPEND') {
    return 'Dépense cumulée ≥ ' + formatEur(benefit.ruleValue);
  }
  return RULE_LABELS[benefit.rule];
}

function grantStatusLabel(status: GrantStatus): string {
  return { ISSUED: 'À utiliser', REDEEMED: 'Validée', VOID: 'Annulée', EXPIRED: 'Expirée' }[status];
}

function grantStatusClassName(status: GrantStatus): string {
  if (status === 'REDEEMED') return 'border-success/30 bg-success/10 text-success';
  if (status === 'ISSUED') return 'border-primary/30 bg-primary/5 text-primary';
  return 'border-border bg-secondary text-muted-foreground';
}

function MetricCard({
  label,
  value,
  caption,
  icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardDescription>{label}</CardDescription>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
          </div>
          <div className="rounded-xl bg-secondary p-2 text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LoyaltyPage() {
  const { get, post, patch } = useApi();
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [grantToVoid, setGrantToVoid] = useState<Grant | null>(null);
  const [benefitForm, setBenefitForm] = useState<BenefitForm>(emptyBenefitForm);
  const [grantForm, setGrantForm] = useState({ benefitId: '', customerId: '', reservationId: '' });
  const [redeemForm, setRedeemForm] = useState({ grantId: '', code: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [customerResult, loyaltyResult] = await Promise.allSettled([
        get<ListResponse<Customer>>('customers?limit=100&offset=0'),
        Promise.all([
          get<ListResponse<Benefit>>('loyalty/benefits?limit=100'),
          get<ListResponse<Grant>>('loyalty/grants?limit=100'),
        ]),
      ]);

      if (customerResult.status === 'fulfilled') {
        const nextCustomers = unwrapList(customerResult.value);
        setCustomers(nextCustomers);
        setGrantForm((current) => ({
          ...current,
          customerId:
            current.customerId && nextCustomers.some((item) => item.id === current.customerId)
              ? current.customerId
              : '',
        }));
      } else {
        setCustomers([]);
      }

      if (loyaltyResult.status === 'rejected') throw loyaltyResult.reason;
      const [benefitResponse, grantResponse] = loyaltyResult.value;
      const nextBenefits = unwrapList(benefitResponse);
      setBenefits(nextBenefits);
      setGrants(unwrapList(grantResponse));
      setGrantForm((current) => ({
        ...current,
        benefitId:
          current.benefitId && nextBenefits.some((item) => item.id === current.benefitId)
            ? current.benefitId
            : nextBenefits.find((item) => item.status === 'ACTIVE')?.id || '',
      }));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les attentions clients'));
      setBenefits([]);
      setGrants([]);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    const trackedGrants = grants.filter(
      (grant) => grant.status === 'ISSUED' || grant.status === 'REDEEMED',
    );
    return {
      activeBenefits: benefits.filter((benefit) => benefit.status === 'ACTIVE').length,
      issued: grants.filter((grant) => grant.status === 'ISSUED').length,
      redeemed: grants.filter((grant) => grant.status === 'REDEEMED').length,
      issuedCost: grants
        .filter((grant) => grant.status === 'ISSUED')
        .reduce((sum, grant) => sum + (grant.benefit.costCents ?? 0), 0),
      redemptionRate:
        trackedGrants.length > 0
          ? Math.round(
              (trackedGrants.filter((grant) => grant.status === 'REDEEMED').length /
                trackedGrants.length) *
                100,
            )
          : null,
    };
  }, [benefits, grants]);

  const activeBenefits = useMemo(
    () => benefits.filter((benefit) => benefit.status === 'ACTIVE'),
    [benefits],
  );
  const issuedGrants = useMemo(() => grants.filter((grant) => grant.status === 'ISSUED'), [grants]);
  const selectedRule =
    RULE_OPTIONS.find((option) => option.value === benefitForm.rule) ?? RULE_OPTIONS[0];

  async function createBenefit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    const name = benefitForm.name.trim();
    if (!name) {
      setError('Donnez un nom à cette attention.');
      setBusy(false);
      return;
    }

    let ruleValue: number | undefined;
    if (benefitForm.rule === 'MIN_VISITS') {
      const value = Number(benefitForm.ruleValue);
      if (!Number.isInteger(value) || value < 1) {
        setError('Indiquez un nombre de visites entier supérieur ou égal à 1.');
        setBusy(false);
        return;
      }
      ruleValue = value;
    }
    if (benefitForm.rule === 'MIN_ESTIMATED_SPEND') {
      const value = parseEuroCents(benefitForm.ruleValue);
      if (value === null || value < 1) {
        setError('Indiquez une dépense cumulée supérieure ou égale à 0,01 €.');
        setBusy(false);
        return;
      }
      ruleValue = value;
    }

    const costText = benefitForm.costEuros.trim();
    const costCents = costText ? parseEuroCents(costText) : undefined;
    if (costText && costCents === null) {
      setError('Le coût estimé doit être un montant en euros, par exemple 5,00.');
      setBusy(false);
      return;
    }

    const validityDays = Number(benefitForm.validityDays);
    if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
      setError('La durée de validité doit être comprise entre 1 et 365 jours.');
      setBusy(false);
      return;
    }

    const maxUsesPerCustomer = Number(benefitForm.maxUsesPerCustomer);
    if (
      !Number.isInteger(maxUsesPerCustomer) ||
      maxUsesPerCustomer < 1 ||
      maxUsesPerCustomer > 100
    ) {
      setError('Le nombre maximum d’utilisations doit être compris entre 1 et 100.');
      setBusy(false);
      return;
    }

    try {
      const response = await post<MutationResponse<Benefit>>('loyalty/benefits', {
        key: benefitForm.key.trim() || slugifyBenefitKey(name),
        name,
        description: benefitForm.description.trim() || null,
        rule: benefitForm.rule,
        ...(ruleValue !== undefined ? { ruleValue } : {}),
        ...(costCents !== undefined ? { costCents } : {}),
        validityDays,
        maxUsesPerCustomer,
      });
      if (response.data) {
        setBenefits((current) => [response.data!, ...current]);
        setGrantForm((current) => ({
          ...current,
          benefitId: current.benefitId || response.data!.id,
        }));
      }
      setBenefitForm(emptyBenefitForm());
      setNotice('Attention enregistrée. Elle peut maintenant être attribuée à un client.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’enregistrer cette attention'));
    } finally {
      setBusy(false);
    }
  }

  async function issueGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setIssuedCode(null);
    try {
      const response = await post<IssueResponse>(
        'loyalty/grants',
        {
          benefitId: grantForm.benefitId,
          customerId: grantForm.customerId,
          ...(grantForm.reservationId ? { reservationId: grantForm.reservationId } : {}),
        },
        { headers: { 'Idempotency-Key': 'dashboard-' + Date.now() + '-' + grantForm.customerId } },
      );
      if (response.data) {
        setIssuedCode(response.data.code);
        setGrants((current) => [
          response.data!,
          ...current.filter((item) => item.id !== response.data!.id),
        ]);
      }
      const customer = customers.find((item) => item.id === grantForm.customerId);
      const customerLabel = customer?.name || 'ce client';
      setNotice(
        response.data?.replayed
          ? 'Cette attention avait déjà été attribuée à ce client.'
          : 'Attention attribuée à ' + customerLabel + '. Remettez le code au client.',
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’attribuer cette attention'));
    } finally {
      setBusy(false);
    }
  }

  async function redeemGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await post<MutationResponse<Grant>>(
        'loyalty/grants/' + redeemForm.grantId + '/redeem',
        {
          code: redeemForm.code,
          ...(redeemForm.note ? { note: redeemForm.note } : {}),
        },
      );
      if (response.data) {
        setGrants((current) =>
          current.map((item) => (item.id === response.data!.id ? response.data! : item)),
        );
      }
      setRedeemForm({ grantId: '', code: '', note: '' });
      setNotice('Attention validée. Elle est maintenant comptabilisée comme utilisée.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de valider cette attention'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleBenefit(benefit: Benefit) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await patch<MutationResponse<Benefit>>('loyalty/benefits/' + benefit.id, {
        status: benefit.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      if (response.data) {
        setBenefits((current) =>
          current.map((item) => (item.id === benefit.id ? response.data! : item)),
        );
      }
      setNotice(
        benefit.status === 'ACTIVE'
          ? 'Attention désactivée. Les attributions déjà émises restent suivies.'
          : 'Attention réactivée pour les nouvelles attributions.',
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de modifier cette attention'));
    } finally {
      setBusy(false);
    }
  }

  async function voidGrant() {
    if (!grantToVoid) return;
    const grant = grantToVoid;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await post<MutationResponse<Grant>>(
        'loyalty/grants/' + grant.id + '/void',
        {},
      );
      if (response.data) {
        setGrants((current) =>
          current.map((item) => (item.id === grant.id ? response.data! : item)),
        );
      }
      setNotice('Attribution annulée. Elle ne peut plus être validée en salle.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’annuler cette attribution'));
    } finally {
      setBusy(false);
      setGrantToVoid(null);
    }
  }

  const normalizedError = error.toLowerCase();
  const lockedByPlan =
    normalizedError.includes('capability_not_included') ||
    normalizedError.includes('pas incluse') ||
    normalizedError.includes('réservée à pro');
  const lockedByFreeze =
    normalizedError.includes('loyalty_disabled') ||
    normalizedError.includes('désactivés') ||
    normalizedError.includes('qualification');
  const locked = lockedByPlan || lockedByFreeze;
  const controlsDisabled = busy || locked;
  const metricsUnavailable = loading || Boolean(error);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <Gift className="text-primary" size={22} aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight">Attentions clients</h1>
            <Badge variant="secondary">Pro</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-foreground/70">
            Créez et attribuez des attentions que l’équipe valide au moment de l’addition.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/70">
            <Info size={14} aria-hidden="true" />
            Sokar ne contacte personne automatiquement : l’équipe remet le code au client.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void load()}
          disabled={loading || busy}
          aria-label="Actualiser"
          title="Actualiser"
          className="shrink-0 self-end"
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
        </Button>
      </header>

      {error ? (
        <Card
          className={
            locked ? 'border-warning/30 bg-warning/5' : 'border-destructive/30 bg-destructive/5'
          }
          role="alert"
        >
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {locked ? (
                <ShieldAlert
                  className="mt-0.5 shrink-0 text-warning"
                  size={19}
                  aria-hidden="true"
                />
              ) : (
                <AlertCircle
                  className="mt-0.5 shrink-0 text-destructive"
                  size={19}
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 space-y-1">
                <p className="font-medium leading-5">
                  {lockedByPlan
                    ? 'Passez à Pro pour activer les attentions clients'
                    : lockedByFreeze
                      ? 'Le module est momentanément verrouillé'
                      : 'Les attentions clients sont indisponibles'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {lockedByPlan
                    ? 'La formule Essential peut consulter les clients, mais la création et le suivi des attentions sont disponibles dans Pro.'
                    : lockedByFreeze
                      ? 'Le parcours est prêt, mais reste fermé pendant la qualification du pilote. Aucune donnée ne sera créée tant que le module est verrouillé.'
                      : error}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              {lockedByPlan ? (
                <Button asChild size="sm">
                  <Link href="/pricing">Passer à Pro</Link>
                </Button>
              ) : null}
              <Button
                variant={lockedByPlan ? 'ghost' : 'outline'}
                size="sm"
                onClick={() => void load()}
              >
                {locked ? 'Vérifier mon accès' : 'Réessayer'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {notice ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-success"
          role="status"
        >
          <CheckCircle2 size={17} aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
            {JOURNEY_STEPS.map(({ number, title, description, icon: Icon }, index) => (
              <Fragment key={number}>
                <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon size={16} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {number}. {title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-foreground/70">{description}</p>
                  </div>
                </div>
                {index < JOURNEY_STEPS.length - 1 ? (
                  <ArrowRight
                    className="mx-2 hidden shrink-0 text-muted-foreground sm:block"
                    size={16}
                    aria-hidden="true"
                  />
                ) : null}
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Règles actives"
          value={metricsUnavailable ? '—' : String(metrics.activeBenefits)}
          caption="Disponibles pour l’équipe"
          icon={<ListChecks size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Attentions à utiliser"
          value={metricsUnavailable ? '—' : String(metrics.issued)}
          caption="Attribuées, non validées"
          icon={<Ticket size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Attentions validées"
          value={metricsUnavailable ? '—' : String(metrics.redeemed)}
          caption="Consommées en salle"
          icon={<CheckCircle2 size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Budget potentiel"
          value={metricsUnavailable ? '—' : formatEur(metrics.issuedCost)}
          caption="Coût des attentions à utiliser"
          icon={<CircleDollarSign size={18} aria-hidden="true" />}
        />
        <MetricCard
          label="Taux d’utilisation"
          value={
            metricsUnavailable || metrics.redemptionRate === null
              ? '—'
              : metrics.redemptionRate + '%'
          }
          caption="Sur les attributions suivies"
          icon={<Award size={18} aria-hidden="true" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Créer une attention</CardTitle>
                <CardDescription className="mt-1">
                  Définissez ce que l’équipe peut offrir et dans quelles conditions.
                </CardDescription>
              </div>
              <Badge variant="outline">Règle · coût · durée</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={createBenefit}>
              <fieldset disabled={controlsDisabled} className="space-y-5 disabled:opacity-60">
                <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-2">
                    <Label htmlFor="benefit-name">Nom de l’attention</Label>
                    <Input
                      id="benefit-name"
                      value={benefitForm.name}
                      onChange={(event) =>
                        setBenefitForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Dessert anniversaire"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Le nom visible par l’équipe au moment de l’attribution.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="benefit-key">Référence interne (facultatif)</Label>
                    <Input
                      id="benefit-key"
                      value={benefitForm.key}
                      onChange={(event) =>
                        setBenefitForm((current) => ({ ...current, key: event.target.value }))
                      }
                      placeholder="Générée automatiquement"
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      Laissez vide : Sokar créera une référence à partir du nom.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="benefit-description">Consigne pour l’équipe (facultatif)</Label>
                  <textarea
                    id="benefit-description"
                    value={benefitForm.description}
                    onChange={(event) =>
                      setBenefitForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="À servir avec le café, une fois par client."
                    rows={2}
                    className="flex min-h-20 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="benefit-rule">Qui peut recevoir cette attention ?</Label>
                  <select
                    id="benefit-rule"
                    value={benefitForm.rule}
                    onChange={(event) =>
                      setBenefitForm((current) => ({
                        ...current,
                        rule: event.target.value as BenefitRule,
                        ruleValue: '',
                      }))
                    }
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {RULE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">{selectedRule.hint}</p>
                </div>

                {selectedRule.valueLabel ? (
                  <div className="space-y-2">
                    <Label htmlFor="benefit-rule-value">{selectedRule.valueLabel}</Label>
                    <Input
                      id="benefit-rule-value"
                      type={selectedRule.value === 'MIN_VISITS' ? 'number' : 'text'}
                      min={1}
                      step={selectedRule.step}
                      inputMode={selectedRule.inputMode}
                      value={benefitForm.ruleValue}
                      onChange={(event) =>
                        setBenefitForm((current) => ({
                          ...current,
                          ruleValue: event.target.value,
                        }))
                      }
                      placeholder={selectedRule.value === 'MIN_VISITS' ? '5' : '100,00'}
                      required
                    />
                    <p className="text-xs text-muted-foreground">{selectedRule.valueHint}</p>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="benefit-cost">Coût unitaire estimé (€)</Label>
                    <Input
                      id="benefit-cost"
                      type="text"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={benefitForm.costEuros}
                      onChange={(event) =>
                        setBenefitForm((current) => ({
                          ...current,
                          costEuros: event.target.value,
                        }))
                      }
                      placeholder="5,00"
                    />
                    <p className="text-xs text-muted-foreground">
                      Pour suivre le budget potentiel.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="benefit-validity">Valable pendant (jours)</Label>
                    <Input
                      id="benefit-validity"
                      type="number"
                      min={1}
                      max={365}
                      step={1}
                      value={benefitForm.validityDays}
                      onChange={(event) =>
                        setBenefitForm((current) => ({
                          ...current,
                          validityDays: event.target.value,
                        }))
                      }
                      required
                    />
                    <p className="text-xs text-muted-foreground">30 jours par défaut.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="benefit-max-uses">Utilisations max. par client</Label>
                    <Input
                      id="benefit-max-uses"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={benefitForm.maxUsesPerCustomer}
                      onChange={(event) =>
                        setBenefitForm((current) => ({
                          ...current,
                          maxUsesPerCustomer: event.target.value,
                        }))
                      }
                      required
                    />
                    <p className="text-xs text-muted-foreground">1 fois par défaut.</p>
                  </div>
                </div>

                <Button type="submit">
                  <Gift size={16} aria-hidden="true" />
                  Enregistrer l’attention
                </Button>
              </fieldset>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Attribuer à un client</CardTitle>
                <CardDescription className="mt-1">
                  Remettez ensuite le code généré au client.
                </CardDescription>
              </div>
              <Badge variant="outline">
                {customers.length} client{customers.length > 1 ? 's' : ''} disponible
                {customers.length > 1 ? 's' : ''}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={issueGrant}>
              <fieldset disabled={controlsDisabled} className="space-y-5 disabled:opacity-60">
                <div className="space-y-2">
                  <Label htmlFor="grant-benefit">Attention à attribuer</Label>
                  <select
                    id="grant-benefit"
                    value={grantForm.benefitId}
                    onChange={(event) =>
                      setGrantForm((current) => ({ ...current, benefitId: event.target.value }))
                    }
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    required
                  >
                    <option value="">Choisir une attention active</option>
                    {activeBenefits.map((benefit) => (
                      <option key={benefit.id} value={benefit.id}>
                        {benefit.name}
                      </option>
                    ))}
                  </select>
                  {activeBenefits.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Enregistrez d’abord une attention active.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="grant-customer">Client destinataire</Label>
                  <select
                    id="grant-customer"
                    value={grantForm.customerId}
                    onChange={(event) =>
                      setGrantForm((current) => ({ ...current, customerId: event.target.value }))
                    }
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    required
                  >
                    <option value="">Sélectionner un client</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {formatCustomerLabel(customer)}
                      </option>
                    ))}
                  </select>
                  {customers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Aucun client disponible dans le fichier client pour le moment.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Le nom et les quatre derniers chiffres du téléphone sont affichés à l’équipe.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="grant-reservation">Réservation liée (facultatif)</Label>
                  <Input
                    id="grant-reservation"
                    value={grantForm.reservationId}
                    onChange={(event) =>
                      setGrantForm((current) => ({
                        ...current,
                        reservationId: event.target.value,
                      }))
                    }
                    placeholder="Identifiant de la réservation"
                  />
                  <p className="text-xs text-muted-foreground">
                    Facultatif : rattachez l’attention à la réservation de ce client.
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={activeBenefits.length === 0 || customers.length === 0}
                >
                  <Ticket size={16} aria-hidden="true" />
                  Attribuer l’attention
                </Button>

                {issuedCode ? (
                  <div
                    className="rounded-xl border border-primary/30 bg-primary/5 p-4"
                    role="status"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Code à remettre au client
                    </p>
                    <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.18em] text-primary">
                      {issuedCode}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Ce code ne sera plus affiché après cette émission. Notez-le ou remettez-le
                      immédiatement au client.
                    </p>
                  </div>
                ) : null}
              </fieldset>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Valider une attention en salle</CardTitle>
              <CardDescription className="mt-1">
                À l’addition, choisissez l’attention et saisissez le code remis au client.
              </CardDescription>
            </div>
            <Badge variant="outline">{issuedGrants.length} à valider</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={redeemGrant}>
            <fieldset
              disabled={controlsDisabled || issuedGrants.length === 0}
              className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end disabled:opacity-60"
            >
              <div className="space-y-2">
                <Label htmlFor="redeem-grant">Attention à valider</Label>
                <select
                  id="redeem-grant"
                  value={redeemForm.grantId}
                  onChange={(event) =>
                    setRedeemForm((current) => ({ ...current, grantId: event.target.value }))
                  }
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  required
                >
                  <option value="">Choisir une attribution</option>
                  {issuedGrants.map((grant) => (
                    <option key={grant.id} value={grant.id}>
                      {grant.benefit.name} · {grant.customerName || 'Client'} · expire le{' '}
                      {formatDate(grant.expiresAt)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="redeem-code">Code de validation</Label>
                <Input
                  id="redeem-code"
                  value={redeemForm.code}
                  onChange={(event) =>
                    setRedeemForm((current) => ({
                      ...current,
                      code: event.target.value.toUpperCase().replace(/\s+/g, ''),
                    }))
                  }
                  placeholder="12 caractères"
                  maxLength={12}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="redeem-note">Note interne (facultatif)</Label>
                <Input
                  id="redeem-note"
                  value={redeemForm.note}
                  onChange={(event) =>
                    setRedeemForm((current) => ({ ...current, note: event.target.value }))
                  }
                  placeholder="Servi avec l’addition"
                />
              </div>
              <Button type="submit" disabled={issuedGrants.length === 0}>
                <CheckCircle2 size={16} aria-hidden="true" />
                Valider l’attention
              </Button>
            </fieldset>
            {issuedGrants.length === 0 && !locked ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 size={15} aria-hidden="true" />
                Aucune attention en attente de validation.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Règles configurées</CardTitle>
              <CardDescription className="mt-1">
                Désactiver une règle empêche les nouvelles attributions, sans effacer l’historique.
              </CardDescription>
            </div>
            <Badge variant="outline">
              {activeBenefits.length} active{activeBenefits.length > 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : benefits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <Gift className="mx-auto text-muted-foreground/50" size={28} aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">Aucune attention configurée</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Créez votre première attention ci-dessus pour commencer.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {benefits.map((benefit) => (
                <div
                  key={benefit.id}
                  className="flex flex-col justify-between gap-4 rounded-xl border border-border p-4 transition-all duration-200 hover:bg-accent/40 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{benefit.name}</span>
                      <Badge
                        variant="outline"
                        className={
                          benefit.status === 'ACTIVE'
                            ? 'border-success/30 bg-success/10 text-success'
                            : 'text-muted-foreground'
                        }
                      >
                        {benefit.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {benefitRuleSummary(benefit)} · {formatEur(benefit.costCents)} · valable{' '}
                      {benefit.validityDays} jours · {benefit.grantCount} attribution
                      {benefit.grantCount > 1 ? 's' : ''}
                    </p>
                    {benefit.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{benefit.description}</p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void toggleBenefit(benefit)}
                    disabled={controlsDisabled}
                  >
                    {benefit.status === 'ACTIVE' ? 'Désactiver' : 'Réactiver'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Attributions récentes</CardTitle>
              <CardDescription className="mt-1">
                Le téléphone est limité aux quatre derniers chiffres sur cet écran.
              </CardDescription>
            </div>
            <Badge variant="outline">
              {grants.length} attribution{grants.length > 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : grants.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <UsersRound
                className="mx-auto text-muted-foreground/50"
                size={28}
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium">Aucune attention attribuée</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Les attributions apparaîtront ici pour permettre leur suivi.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {grants.map((grant) => (
                <div
                  key={grant.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-border p-4 transition-all duration-200 hover:bg-accent/40 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{grant.benefit.name}</span>
                      <Badge variant="outline" className={grantStatusClassName(grant.status)}>
                        {grantStatusLabel(grant.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {grant.customerName ?? 'Client'} · •••• {grant.phoneLast4}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Émise le {formatDate(grant.issuedAt)} ·{' '}
                      {grant.status === 'REDEEMED' && grant.redeemedAt
                        ? 'validée le ' + formatDate(grant.redeemedAt)
                        : grant.status === 'ISSUED'
                          ? 'expire le ' + formatDate(grant.expiresAt)
                          : 'historique conservé'}
                    </p>
                  </div>
                  {grant.status === 'ISSUED' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRedeemForm((current) => ({ ...current, grantId: grant.id }))
                        }
                      >
                        <CheckCircle2 size={14} aria-hidden="true" />
                        Préparer la validation
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setGrantToVoid(grant)}
                        disabled={controlsDisabled}
                      >
                        <Ban size={14} aria-hidden="true" />
                        Annuler l’attribution
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays size={14} aria-hidden="true" />
        Les codes sont à usage unique, les données sensibles restent protégées et les attributions
        expirées restent consultables pour l’audit.
      </p>

      <ConfirmDialog
        open={Boolean(grantToVoid)}
        onCancel={() => setGrantToVoid(null)}
        onConfirm={() => void voidGrant()}
        title="Annuler cette attribution ?"
        description={
          grantToVoid
            ? 'L’attention « ' +
              grantToVoid.benefit.name +
              ' » attribuée à ' +
              (grantToVoid.customerName || 'ce client') +
              ' ne pourra plus être validée. L’historique restera consultable.'
            : ''
        }
        confirmLabel="Annuler l’attribution"
        cancelLabel="Conserver"
        variant="destructive"
        pending={busy}
      />
    </div>
  );
}
