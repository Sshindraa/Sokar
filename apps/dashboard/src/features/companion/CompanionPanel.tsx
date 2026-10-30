'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-error';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_CHARS = 4000;
/** Nombre de messages renvoyés au modèle à chaque question : l'historique complet reste affiché. */
const SENT_HISTORY = 20;

interface Source {
  tool: string;
  href: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

interface CompanionReply {
  reply: string;
  sources: Source[];
}

const SUGGESTION_KEYS = ['week', 'noShows', 'bookings'] as const;

function historyKey(siteId: string): string {
  return `sokar.companion.${siteId}`;
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<Message>;
  return (
    (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string'
  );
}

/** Le stockage de session peut être refusé (navigation privée, quota) : la conversation reste alors en mémoire. */
function readHistory(siteId: string): Message[] {
  try {
    const raw = window.sessionStorage.getItem(historyKey(siteId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Les entrées écrites par une version antérieure (champs en trop, comme toolRuns) sont lues sans ces champs.
    return Array.isArray(parsed)
      ? parsed.filter(isMessage).map(({ role, content, sources }) => ({ role, content, sources }))
      : [];
  } catch {
    return [];
  }
}

function writeHistory(siteId: string, messages: Message[]): void {
  try {
    if (messages.length === 0) window.sessionStorage.removeItem(historyKey(siteId));
    else window.sessionStorage.setItem(historyKey(siteId), JSON.stringify(messages));
  } catch {
    // Pas de persistance : la conversation reste visible jusqu'au rechargement.
  }
}

/** Une seule ligne par page du dashboard : plusieurs outils renvoient le même écran. */
function uniqueSources(sources: Source[]): Source[] {
  return sources.filter(
    (source, index) => sources.findIndex((other) => other.href === source.href) === index,
  );
}

/** Une conversation par site : le panneau est recréé quand le site change. */
export function CompanionPanel() {
  const { siteId } = useApi();
  return <CompanionConversation key={siteId ?? 'no-site'} siteId={siteId} />;
}

function CompanionConversation({ siteId }: { siteId: string | undefined }) {
  const t = useTranslations('companion');
  const { post } = useApi();
  const [messages, setMessages] = useState<Message[]>(() => (siteId ? readHistory(siteId) : []));
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Le dernier message reste visible, réponse ou erreur comprise.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, pending, error]);

  function commit(next: Message[]) {
    setMessages(next);
    if (siteId) writeHistory(siteId, next);
  }

  async function request(history: Message[]) {
    setPending(true);
    setError(null);
    try {
      const body = {
        messages: history.slice(-SENT_HISTORY).map(({ role, content }) => ({ role, content })),
      };
      const reply = await post<CompanionReply>('companion/chat', body);
      commit([
        ...history,
        { role: 'assistant', content: reply.reply, sources: uniqueSources(reply.sources) },
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setPending(false);
    }
  }

  function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    const next: Message[] = [...messages, { role: 'user', content: text }];
    commit(next);
    setDraft('');
    void request(next);
  }

  function startNewConversation() {
    commit([]);
    setError(null);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    ask(draft);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles size={16} />
          </span>
          <p className="text-sm font-semibold text-foreground">{t('title')}</p>
        </div>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={startNewConversation}
            disabled={pending}
            className="text-xs text-muted-foreground"
          >
            <RotateCcw size={14} />
            {t('newConversation')}
          </Button>
        )}
      </div>

      <div
        ref={threadRef}
        aria-live="polite"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">{t('greeting')}</p>
            <div className="flex flex-col gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  onClick={() => ask(t(`suggestions.${key}`))}
                  disabled={pending}
                  className="h-auto justify-start whitespace-normal py-2 text-left text-sm font-normal transition-all duration-200"
                >
                  {t(`suggestions.${key}`)}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                message.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'border border-border bg-background text-foreground',
              )}
            >
              <p className="whitespace-pre-line">{message.content}</p>
              {uniqueSources(message.sources ?? []).map((source) => (
                <Link
                  key={source.href}
                  href={source.href}
                  className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 transition-all duration-200 hover:underline"
                >
                  {t('openSource')}
                </Link>
              ))}
            </div>
          ))
        )}

        {pending && (
          <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {t('thinking')}
          </div>
        )}

        {error && (
          <div role="alert" className="space-y-2 rounded-xl border border-border bg-background p-3">
            <p className="text-sm text-foreground">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void request(messages)}
              className="transition-all duration-200"
            >
              {t('retry')}
            </Button>
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          ask(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={pending}
          maxLength={MAX_CHARS}
          rows={2}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <Button
          type="submit"
          size="icon"
          disabled={pending || draft.trim().length === 0}
          aria-label={t('send')}
          title={t('send')}
          className="transition-all duration-200"
        >
          <Send size={16} />
        </Button>
      </form>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t('disclaimer')}</p>
    </div>
  );
}
