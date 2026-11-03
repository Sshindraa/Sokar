'use client';

import { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Info } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
    navigator.clipboard
      .writeText(fullUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error('Copie impossible. Sélectionnez l’adresse et copiez-la à la main.'));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Sous-domaine gratuit
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Précision sur le sous-domaine"
                  className="inline-flex text-muted-foreground transition-all duration-200 hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Attribué automatiquement à chaque restaurant sur {PRIMARY_HOST}, sans configuration.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
        <StatusBadge level={connectPublished ? 'progress' : 'neutral'}>
          {connectPublished ? 'En ligne' : 'Inactif'}
        </StatusBadge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-border p-3">
          {connectPublished ? (
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-sm font-medium transition-all duration-200 hover:text-primary"
            >
              <span className="min-w-0 break-all">{subdomain}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <span className="min-w-0 flex-1 break-all font-mono text-sm text-muted-foreground">
              {subdomain}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={copyUrl}
            className="h-7 shrink-0 px-2 transition-all duration-200"
            aria-label="Copier l'URL"
          >
            {copied ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        {!connectPublished && (
          <p className="text-sm text-muted-foreground">Publiez votre page pour l’activer.</p>
        )}
      </CardContent>
    </Card>
  );
}
