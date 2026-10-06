export function GiftCardTestBanner() {
  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')) return null;
  return (
    <p role="status" className="rounded-lg border border-border bg-muted p-4 text-sm font-medium">
      Mode test Stripe — aucun débit bancaire réel. Les notifications sont vérifiées séparément.
    </p>
  );
}
