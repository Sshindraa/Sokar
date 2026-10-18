/** Local demonstration tools must never be exposed for a remote database or live payments. */
export function isLocalGiftCardTest(restaurantId: string, env = process.env): boolean {
  try {
    const host = new URL(env.DATABASE_URL ?? '').hostname;
    return (
      env.NODE_ENV === 'development' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(host) &&
      restaurantId === env.DEMO_RESTAURANT_ID &&
      !!restaurantId &&
      !!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') &&
      !!env.STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')
    );
  } catch {
    return false;
  }
}
