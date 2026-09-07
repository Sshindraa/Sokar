import { clerkClient } from '@clerk/fastify';

export type ClerkMembershipVerificationCode = 'NOT_MEMBER' | 'UNAVAILABLE';

export class ClerkMembershipVerificationError extends Error {
  constructor(
    readonly code: ClerkMembershipVerificationCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ClerkMembershipVerificationError';
  }
}

/**
 * Vérifie côté serveur qu'un utilisateur appartient bien à l'organisation
 * Clerk avant de créer une membership de site dans Sokar.
 *
 * L'API Clerk filtre déjà la liste par userId : une réponse vide signifie donc
 * que l'identité est inconnue de l'organisation, et non simplement qu'elle n'a
 * pas encore de rôle Sokar.
 */
export async function assertClerkOrganizationMember(input: {
  organizationId?: string | null;
  userId: string;
}): Promise<void> {
  const organizationId = input.organizationId?.trim();
  const userId = input.userId.trim();

  if (!organizationId || !userId) {
    throw new ClerkMembershipVerificationError(
      'UNAVAILABLE',
      'Impossible de vérifier l’appartenance Clerk sans organisation ni utilisateur.',
    );
  }

  let memberships;
  try {
    memberships = await clerkClient.organizations.getOrganizationMembershipList({
      organizationId,
      userId: [userId],
      limit: 1,
    });
  } catch (cause) {
    throw new ClerkMembershipVerificationError(
      'UNAVAILABLE',
      'Le fournisseur d’identité est indisponible.',
      { cause },
    );
  }

  if (memberships.data.length === 0) {
    throw new ClerkMembershipVerificationError(
      'NOT_MEMBER',
      'Cet utilisateur ne fait pas partie de l’organisation Clerk.',
    );
  }
}
