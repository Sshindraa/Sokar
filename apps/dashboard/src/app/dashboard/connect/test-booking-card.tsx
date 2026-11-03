'use client';

import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { openTestBooking } from '@/lib/test-booking';

export type Props = {
  publicUrl: string;
};

export function TestBookingCard({ publicUrl }: Props) {
  const { post } = useApi();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const outcome = await openTestBooking({ post: (path) => post(path) }, publicUrl);
      if (outcome?.kind === 'error') toast.error(outcome.message);
      if (outcome?.kind === 'notice') toast(outcome.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Tester ma page comme un client</CardTitle>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleClick()}
          disabled={loading}
          className="transition-all duration-200"
        >
          {loading ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink size={15} aria-hidden="true" />
          )}
          Lancer le test
        </Button>
      </CardContent>
    </Card>
  );
}
