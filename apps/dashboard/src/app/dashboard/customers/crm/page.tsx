import { redirect } from 'next/navigation';

/** La liste CRM Pro est fusionnée dans l'écran Clients (filtres avancés réservés à CRM Pro). */
export default function CrmListRedirectPage() {
  redirect('/dashboard/customers');
}
