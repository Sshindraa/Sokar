import WebSocket from 'ws';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../../../.env') });

const DG_KEY = process.env.DEEPGRAM_API_KEY;

function testUrl(url: string) {
  console.log(`Connecting to: ${url}`);
  const ws = new WebSocket(url, {
    headers: { Authorization: `Token ${DG_KEY}` },
  });

  ws.on('open', () => {
    console.log(`✅ SUCCESS connecting to ${url}`);
    ws.close();
  });

  ws.on('unexpected-response', (req, res) => {
    console.error(`❌ FAILED connecting to ${url}`);
    console.error(`Status code: ${res.statusCode}`);
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.error(`Response body: ${body}`);
    });
  });

  ws.on('error', (err) => {
    console.error(`❌ ERROR connecting to ${url}: ${err.message}`);
  });
}

const params = new URLSearchParams({
  model: 'nova-3',
  language: 'fr',
  encoding: 'alaw',
  sample_rate: '8000',
  channels: '1',
  interim_results: 'true',
  punctuate: 'true',
  smart_format: 'true',
  endpointing: '150',
});

const keyterms = [
  'réservation', 'personnes', 'soir', 'heures', 'midi', 'couverts',
  'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'
];
for (const term of keyterms) {
  params.append('keyterm', term);
}

const v1Url = `wss://api.deepgram.com/v1/listen?${params}`;

testUrl(v1Url);
