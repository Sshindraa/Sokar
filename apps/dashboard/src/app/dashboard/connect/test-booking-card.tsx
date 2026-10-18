'use client';

import { useState } from 'react';
import { ExternalLink, Loader2, Ticket } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { openTestBooking } from '@/lib/test-booking';

export type Props = {
  publicUrl: string;
};

export function TestBookingCard({ publicUrl }: Props) {
  const { post } = useApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      setError(await openTestBooking({ post: (path) => post(path) }, publicUrl));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ticket className="h-4 w-4 text-primary" />
          Tester ma page comme un client
        </CardTitle>
        <CardDescription>
          Faites le parcours d’un client, jusqu’à la confirmation. Les messages vous sont envoyés
          comme à un client ; rien n’apparaît dans votre restaurant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleClick()}
          disabled={loading}
          className="rounded-full transition-all duration-200"
        >
          {loading ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink size={15} aria-hidden="true" />
          )}
          Lancer le test
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
