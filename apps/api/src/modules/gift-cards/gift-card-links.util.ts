export function giftCardBeneficiaryUrl(code: string): string | null {
  const origin = process.env.CONNECT_URL ?? process.env.SITE_URL;
  return origin ? new URL(`/gift-card/${encodeURIComponent(code)}`, origin).toString() : null;
}
