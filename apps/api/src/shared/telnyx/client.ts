import { createTelnyx } from 'telnyx';

if (!process.env.TELNYX_API_KEY) {
  throw new Error('TELNYX_API_KEY is required');
}

const telnyx = createTelnyx(process.env.TELNYX_API_KEY);

export default telnyx;

export async function sendSms(to: string, text: string): Promise<void> {
  await telnyx.messages.create({
    from: process.env.TELNYX_FROM_NUMBER!,
    to,
    text,
  });
}
