import { chromium } from 'playwright';
const out = process.argv[2];
const sizes = { desktop: [1600, 1000], tablet: [1024, 768], mobile: [390, 844] };
const b = await chromium.launch();
for (const [name, [w, h]] of Object.entries(sizes)) {
  const p = await b.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  await p.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/${name}.png` });
  // eslint-disable-next-line no-console -- script manuel : affiche les captures produites
  console.log(name, p.url());
  await p.close();
}
await b.close();
