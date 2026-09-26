/**
 * Extrait au fil du streaming la valeur de la clé `say` d'un objet JSON en cours
 * de génération. Le schéma place `say` en dernier : dès que sa chaîne s'ouvre,
 * chaque caractère décodé peut partir vers la synthèse vocale.
 */
export class SayStreamExtractor {
  private buffer = '';
  private valueStart = -1;
  private cursor = 0;
  private done = false;
  private pendingEscape = '';

  /** Ajoute un fragment JSON et renvoie le texte de `say` nouvellement décodé. */
  push(fragment: string): string {
    this.buffer += fragment;
    if (this.done) return '';
    if (this.valueStart < 0) {
      const match = /"say"\s*:\s*"/.exec(this.buffer);
      if (!match) return '';
      this.valueStart = match.index + match[0].length;
      this.cursor = this.valueStart;
    }
    let decoded = '';
    while (this.cursor < this.buffer.length) {
      const char = this.buffer[this.cursor];
      if (this.pendingEscape) {
        this.pendingEscape += char;
        const escape = this.pendingEscape;
        if (escape.startsWith('\\u')) {
          if (escape.length < 6) {
            this.cursor++;
            continue;
          }
          decoded += String.fromCharCode(Number.parseInt(escape.slice(2), 16));
        } else {
          decoded += ESCAPES[escape[1]] ?? escape[1];
        }
        this.pendingEscape = '';
        this.cursor++;
        continue;
      }
      if (char === '\\') {
        this.pendingEscape = char;
        this.cursor++;
        continue;
      }
      if (char === '"') {
        this.done = true;
        this.cursor++;
        break;
      }
      decoded += char;
      this.cursor++;
    }
    return decoded;
  }

  /** JSON reçu jusqu'ici. */
  get raw(): string {
    return this.buffer;
  }
}

const ESCAPES: Record<string, string> = {
  n: ' ',
  r: ' ',
  t: ' ',
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '',
  f: '',
};

/**
 * Découpe le texte parlé en phrases complètes pour la synthèse. Le reste non
 * terminé est gardé jusqu'au prochain fragment ou jusqu'à `flush`.
 */
export class PhraseSplitter {
  private pending = '';

  push(text: string): string[] {
    this.pending += text;
    const phrases: string[] = [];
    const boundary = /[.!?…](?=\s)/g;
    let start = 0;
    let match: RegExpExecArray | null;
    while ((match = boundary.exec(this.pending)) !== null) {
      const phrase = this.pending.slice(start, match.index + 1).trim();
      if (phrase) phrases.push(phrase);
      start = match.index + 1;
    }
    this.pending = this.pending.slice(start);
    return phrases;
  }

  flush(): string | null {
    const rest = this.pending.trim();
    this.pending = '';
    return rest || null;
  }
}
