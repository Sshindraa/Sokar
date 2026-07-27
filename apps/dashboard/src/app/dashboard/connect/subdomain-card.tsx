'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link2, CheckCircle2, Copy, Sparkles, ExternalLink } from 'lucide-react';

export type Props = {
  slug: string;
  connectPublished: boolean;
};

// Domaine de base dérivé de NEXT_PUBLIC_SITE_URL (même pattern que widget/page.tsx).
// TODO: centraliser le base domain dans packages/config quand disponible.
const PRIMARY_HOST = (() => {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sokar.tech';
  try {
    return new URL(siteUrl).host;
  } catch {
    return 'sokar.tech';
  }
})();

export function SubdomainCard({ slug, connectPublished }: Props) {
  const [copied, setCopied] = useState(false);

  const subdomain = `${slug}.${PRIMARY_HOST}`;
  const fullUrl = `https://${subdomain}`;

  function copyUrl() {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-primary" />
          Sous-domaine gratuit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
            <Sparkles className="h-3 w-3" />
            Gratuit
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Instantané
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          Chaque restaurant obtient automatiquement un sous-domaine{' '}
          <span className="font-medium text-foreground">{PRIMARY_HOST}</span>. Aucune
          configuration requise.
        </p>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          {connectPublished ? (
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center gap-1.5 truncate font-mono text-sm font-medium text-foreground transition-all duration-200 hover:text-primary"
            >
              <span className="truncate">{subdomain}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <span className="flex-1 truncate font-mono text-sm text-muted-foreground">
              {subdomain}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={copyUrl}
            className="h-7 px-2 transition-all duration-200"
            aria-label="Copier l'URL"
          >
            {copied ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {connectPublished ? (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>Actif — votre page est en ligne</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-muted-foreground/40" />
            <span>Inactif — publiez votre page Connect pour activer</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
