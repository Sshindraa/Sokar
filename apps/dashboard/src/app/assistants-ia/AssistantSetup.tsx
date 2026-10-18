'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MCP_URL } from './mcp-url';

const ASSISTANTS = [
  {
    id: 'claude',
    name: 'Claude',
    steps: [
      'Ouvrez Paramètres › Connecteurs.',
      'Cliquez sur « Ajouter un connecteur personnalisé ».',
      'Collez l’adresse, validez, puis cliquez sur « Autoriser ».',
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    steps: [
      'Ouvrez Paramètres › Applications et connecteurs.',
      'Activez le mode développeur, puis « Créer ».',
      'Collez l’adresse, validez, puis cliquez sur « Autoriser ».',
    ],
    note: 'Selon votre offre et votre pays, cette option peut ne pas encore être proposée.',
  },
  {
    id: 'lechat',
    name: 'Le Chat',
    steps: [
      'Ouvrez Connecteurs › « Ajouter un connecteur ».',
      'Choisissez « Connecteur MCP personnalisé ».',
      'Collez l’adresse, validez, puis cliquez sur « Autoriser ».',
    ],
  },
] as const;

/** Adresse à copier et étapes par assistant : la seule manipulation demandée, une fois. */
export default function AssistantSetup() {
  const [active, setActive] = useState<(typeof ASSISTANTS)[number]['id']>('claude');
  const [copied, setCopied] = useState(false);
  const assistant = ASSISTANTS.find((item) => item.id === active) ?? ASSISTANTS[0];

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8">
      <div role="tablist" aria-label="Votre assistant" className="flex flex-wrap gap-2">
        {ASSISTANTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={active === item.id}
            aria-controls="assistant-steps"
            onClick={() => setActive(item.id)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active === item.id
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
        <code className="break-all text-sm font-semibold sm:text-base">{MCP_URL}</code>
        <button
          type="button"
          onClick={copyAddress}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? 'Adresse copiée' : 'Copier l’adresse'}
        </button>
      </div>

      <ol
        id="assistant-steps"
        role="tabpanel"
        aria-labelledby={`tab-${assistant.id}`}
        className="mt-6 space-y-4"
      >
        {assistant.steps.map((step, index) => (
          <li key={step} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-bold">
              {index + 1}
            </span>
            <span className="pt-0.5 text-sm sm:text-base">{step}</span>
          </li>
        ))}
      </ol>
      {'note' in assistant && (
        <p className="mt-5 text-sm text-muted-foreground">{assistant.note}</p>
      )}
    </div>
  );
}
