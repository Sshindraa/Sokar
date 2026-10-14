import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';

// L’accueil réunit la présentation commerciale. L’ancienne adresse garde un chemin de retour.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
  robots: { index: false, follow: true },
};

export default function VoiceSolutionPage() {
  permanentRedirect('/');
}
