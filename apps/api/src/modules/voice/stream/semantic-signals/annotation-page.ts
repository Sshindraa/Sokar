/**
 * Page d'annotation autonome (un seul fichier HTML, aucune ressource externe).
 * Les tours et les définitions y sont embarqués ; la progression reste dans le
 * navigateur de l'annotateur, et l'export produit le JSONL de `semantic:eval`.
 */
import type { SpanMessage } from './types';

export interface AnnotationItem {
  id: string;
  input: SpanMessage[];
  output: SpanMessage;
  priority: number;
}

export interface AnnotationBehavior {
  id: string;
  instructions: string;
  present: string;
  absent: string;
}

/** JSON sûr à insérer dans une balise `<script>`. */
function embed(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

export function renderAnnotationPage(data: {
  items: AnnotationItem[];
  behaviors: AnnotationBehavior[];
  behaviorSetVersion: string;
}): string {
  const payload = embed({
    items: data.items.map(({ id, input, output }) => ({ id, input, output })),
    behaviors: data.behaviors,
    version: data.behaviorSetVersion,
  });
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Annotation Sokar</title>
<style>
:root {
  --bg: #f7f7f5; --card: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --border: #e3e2dd;
  --accent: #2f5bd3; --yes: #1f8a4c; --yes-bg: #e3f4ea; --no: #a23a2e; --no-bg: #f8e6e3;
  --unk: #8a6d12; --unk-bg: #f6efd9; --client: #eef2fd; --agent: #f3f3f0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514; --card: #1e1e1c; --text: #ecebe6; --muted: #9c9b95; --border: #33322f;
    --accent: #7d9cf2; --yes: #6fd39a; --yes-bg: #173726; --no: #f08a7d; --no-bg: #3d1d19;
    --unk: #e5c46a; --unk-bg: #3a3017; --client: #1f2740; --agent: #262624;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 1; background: var(--bg); border-bottom: 1px solid var(--border);
  padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
header h1 { font-size: 16px; margin: 0; }
.progress { flex: 1; min-width: 160px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.progress > div { height: 100%; background: var(--accent); transition: width .2s; }
.count { color: var(--muted); font-variant-numeric: tabular-nums; }
button { font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 12px; cursor: pointer; transition: all .15s; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
main { max-width: 900px; margin: 0 auto; padding: 16px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.meta { color: var(--muted); font-size: 13px; margin-bottom: 8px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.line { padding: 6px 10px; border-radius: 6px; margin: 4px 0; }
.line.user { background: var(--client); }
.line.assistant { background: var(--agent); }
.line.old { opacity: .6; }
.line.last { outline: 2px solid var(--accent); opacity: 1; }
.line b { font-weight: 600; margin-right: 6px; }
.behavior { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: start;
  padding: 10px 0; border-top: 1px solid var(--border); }
.behavior:first-child { border-top: 0; }
.key { font: 12px ui-monospace, monospace; color: var(--muted); border: 1px solid var(--border);
  border-radius: 4px; text-align: center; padding: 2px 0; }
.criteria { color: var(--muted); font-size: 13px; }
.choices { display: flex; gap: 4px; }
.choices button { padding: 4px 10px; font-size: 13px; }
.choices button.on.yes { background: var(--yes-bg); color: var(--yes); border-color: var(--yes); }
.choices button.on.no { background: var(--no-bg); color: var(--no); border-color: var(--no); }
.choices button.on.unk { background: var(--unk-bg); color: var(--unk); border-color: var(--unk); }
.help { color: var(--muted); font-size: 13px; }
.help kbd { font: 12px ui-monospace, monospace; border: 1px solid var(--border); border-radius: 3px; padding: 0 4px; }
.skipped { color: var(--unk); font-weight: 600; }
@media (max-width: 600px) {
  .behavior { grid-template-columns: 1fr; }
  .key { display: none; }
}
</style>
</head>
<body>
<header>
  <h1>Annotation Sokar</h1>
  <div class="progress"><div id="bar"></div></div>
  <span class="count" id="count"></span>
  <button id="prev">← Précédent</button>
  <button id="next">Suivant →</button>
  <button class="primary" id="export">Exporter le JSONL</button>
</header>
<main>
  <p class="help">
    Pour chaque comportement, jugez <strong>le dernier message du client</strong> (encadré).
    <kbd>1</kbd>…<kbd>9</kbd> <kbd>0</kbd> <kbd>-</kbd> : Vrai → Faux → ? → vide ·
    <kbd>Entrée</kbd> : tout le reste en Faux, puis tour suivant ·
    <kbd>S</kbd> : ignorer le tour · <kbd>←</kbd> <kbd>→</kbd> : naviguer.
    « ? » = impossible à dire avec ce qui est visible.
  </p>
  <div class="card" id="dialogue"></div>
  <div class="card" id="behaviors"></div>
</main>
<script>
const DATA = ${payload};
const KEYS = ['1','2','3','4','5','6','7','8','9','0','-','='];
const STATES = [undefined, true, false, 'not_observable'];
const storageKey = 'sokar-annotation:' + DATA.version + ':' + DATA.items.length + ':' + (DATA.items[0] ? DATA.items[0].id : '');
let state = { index: 0, labels: {}, skipped: {} };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved && typeof saved === 'object') state = Object.assign(state, saved);
} catch (e) {}
function save() { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (e) {} }
function done(id) {
  if (state.skipped[id]) return true;
  const labels = state.labels[id] || {};
  return DATA.behaviors.every((b) => labels[b.id] !== undefined);
}
function el(tag, attrs, text) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== undefined) node.textContent = text;
  return node;
}
function render() {
  const total = DATA.items.length;
  const finished = DATA.items.filter((item) => done(item.id)).length;
  document.getElementById('bar').style.width = total ? (finished / total * 100) + '%' : '0';
  document.getElementById('count').textContent = finished + ' / ' + total + ' annotés';
  const dialogue = document.getElementById('dialogue');
  const behaviors = document.getElementById('behaviors');
  dialogue.replaceChildren();
  behaviors.replaceChildren();
  if (!total) { dialogue.textContent = 'Aucun tour à annoter.'; return; }
  const item = DATA.items[state.index];
  const meta = el('div', { class: 'meta' });
  meta.append(el('span', {}, 'Tour ' + (state.index + 1) + ' / ' + total));
  if (state.skipped[item.id]) meta.append(el('span', { class: 'skipped' }, 'Ignoré'));
  dialogue.append(meta);
  item.input.forEach((message, i) => {
    const last = i === item.input.length - 1;
    const line = el('div', { class: 'line ' + message.role + (last ? ' last' : ' old') });
    line.append(el('b', {}, message.role === 'user' ? 'Client' : 'Agent'));
    line.append(document.createTextNode(message.content));
    dialogue.append(line);
  });
  const reply = el('div', { class: 'line assistant old' });
  reply.append(el('b', {}, 'Réponse de l\\'agent'));
  reply.append(document.createTextNode(item.output.content));
  dialogue.append(reply);
  const labels = state.labels[item.id] || {};
  DATA.behaviors.forEach((behavior, i) => {
    const row = el('div', { class: 'behavior' });
    row.append(el('span', { class: 'key' }, KEYS[i] || ''));
    const text = el('div');
    text.append(el('div', {}, behavior.instructions));
    text.append(el('div', { class: 'criteria' }, 'Vrai : ' + behavior.present + ' · Faux : ' + behavior.absent));
    row.append(text);
    const choices = el('div', { class: 'choices' });
    [[true, 'Vrai', 'yes'], [false, 'Faux', 'no'], ['not_observable', '?', 'unk']].forEach(([value, label, cls]) => {
      const button = el('button', { class: cls + (labels[behavior.id] === value ? ' on' : '') }, label);
      button.addEventListener('click', () => setLabel(behavior.id, labels[behavior.id] === value ? undefined : value));
      choices.append(button);
    });
    row.append(choices);
    behaviors.append(row);
  });
}
function setLabel(behaviorId, value) {
  const id = DATA.items[state.index].id;
  const labels = state.labels[id] || (state.labels[id] = {});
  if (value === undefined) delete labels[behaviorId]; else labels[behaviorId] = value;
  delete state.skipped[id];
  save(); render();
}
function cycle(behaviorId) {
  const labels = state.labels[DATA.items[state.index].id] || {};
  const next = STATES[(STATES.indexOf(labels[behaviorId]) + 1) % STATES.length];
  setLabel(behaviorId, next);
}
function go(delta) {
  state.index = Math.min(DATA.items.length - 1, Math.max(0, state.index + delta));
  save(); render(); window.scrollTo(0, 0);
}
function validate() {
  const id = DATA.items[state.index].id;
  const labels = state.labels[id] || (state.labels[id] = {});
  DATA.behaviors.forEach((b) => { if (labels[b.id] === undefined) labels[b.id] = false; });
  delete state.skipped[id];
  save(); go(1);
}
function skip() {
  state.skipped[DATA.items[state.index].id] = true;
  save(); go(1);
}
function exportJsonl() {
  const lines = DATA.items
    .filter((item) => !state.skipped[item.id] && Object.keys(state.labels[item.id] || {}).length)
    .map((item) => JSON.stringify({ id: item.id, input: item.input, output: item.output, labels: state.labels[item.id] }));
  const blob = new Blob([lines.join('\\n') + '\\n'], { type: 'application/x-ndjson' });
  const link = el('a', { href: URL.createObjectURL(blob), download: 'annotated-' + DATA.version + '.jsonl' });
  document.body.append(link); link.click(); link.remove();
}
document.getElementById('prev').addEventListener('click', () => go(-1));
document.getElementById('next').addEventListener('click', () => go(1));
document.getElementById('export').addEventListener('click', exportJsonl);
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const index = KEYS.indexOf(event.key);
  if (index >= 0 && DATA.behaviors[index]) { cycle(DATA.behaviors[index].id); event.preventDefault(); }
  else if (event.key === 'Enter') { validate(); event.preventDefault(); }
  else if (event.key === 's' || event.key === 'S') skip();
  else if (event.key === 'ArrowRight') go(1);
  else if (event.key === 'ArrowLeft') go(-1);
});
render();
</script>
</body>
</html>
`;
}
