export function getGiftCardOrigin(currentOrigin: string, nodeEnv = process.env.NODE_ENV): string {
  const origin = new URL(currentOrigin);
  if (nodeEnv === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    origin.port = '4002';
  }
  return origin.origin;
}
