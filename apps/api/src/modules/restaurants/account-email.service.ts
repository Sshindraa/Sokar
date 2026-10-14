import { clerkClient } from '@clerk/fastify';
import { db } from '../../shared/db/client';

/**
 * Adresse e-mail du propriétaire du compte, celle de sa connexion (Clerk).
 *
 * `managerEmail` n'est enregistrée qu'à la fin de la première étape de l'inscription : un
 * restaurateur qui l'abandonne n'en a pas, et c'est justement lui qu'une relance doit atteindre.
 * On ne la recopie pas dans `managerEmail` (le rapport du soir en dépend et partirait chez des
 * comptes jamais configurés) : on la lit au moment d'écrire. Seule une adresse vérifiée est
 * utilisée, comme dans l'étape Restaurant du dashboard.
 */
export async function resolveAccountOwnerEmail(
  accountId: string | null | undefined,
): Promise<string | null> {
  if (!accountId) return null;
  const owner = await db.restaurantAccountMembership.findFirst({
    where: { accountId, role: 'OWNER', restaurantId: null },
    orderBy: { createdAt: 'asc' },
    select: { clerkUserId: true },
  });
  if (!owner) return null;

  try {
    const user = await clerkClient.users.getUser(owner.clerkUserId);
    const primary = user.emailAddresses.find(
      (address) => address.id === user.primaryEmailAddressId,
    );
    return primary?.verification?.status === 'verified' ? primary.emailAddress : null;
  } catch {
    // Fournisseur d'identité indisponible ou utilisateur supprimé : pas d'adresse, pas de relance.
    return null;
  }
}
