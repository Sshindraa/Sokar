import { ReservationWidget } from '@/components/reservation-widget';

/**
 * Page d'entrée du widget OpenAI Reserve.
 *
 * Spec : https://developers.openai.com/apps-sdk/guides/restaurant-reservation-conversion-spec
 * Le widget est servi en standalone sur widget.sokar.app et embarqué
 * dans ChatGPT via iframe (resourceUri: ui://widget/restaurant-reservation.html).
 *
 * Le widget est 100% statique (next export). Les données sont récupérées
 * côté client depuis window.openai.toolInput (données passées par ChatGPT
 * lors de l'invocation du tool restaurant_reservation).
 */
export default function WidgetPage() {
  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-md mx-auto">
      <ReservationWidget />
    </main>
  );
}
