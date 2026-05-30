// eslint-disable-next-line @typescript-eslint/no-require-imports
const createTelnyx: (key: string) => any = require('telnyx');

type TelnyxClient = any;

let _telnyx: TelnyxClient | null = null;

function getTelnyx() {
  if (!_telnyx) {
    if (!process.env.TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY is required');
    }
    _telnyx = createTelnyx(process.env.TELNYX_API_KEY);
  }
  return _telnyx;
}

const telnyx = new Proxy({} as ReturnType<typeof createTelnyx>, {
  get(_, prop: string | symbol) {
    return (getTelnyx() as any)[prop];
  },
});

export default telnyx;

export async function sendSms(to: string, text: string): Promise<void> {
  const t = getTelnyx();
  await t.messages.create({
    from: process.env.TELNYX_FROM_NUMBER!,
    to,
    text,
  });
}
