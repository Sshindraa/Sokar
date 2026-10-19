// Traduction française des écrans de connexion et d'inscription Clerk.
// Extraite de @clerk/localizations 3.37.9 (fr-FR, licence MIT) : seules les clés utilisées
// par SignIn et SignUp sont conservées, pour ne pas ajouter la dépendance.
// Les textes sont en JSON : ce sont des libellés (« Mot de passe »), pas des secrets.
import type { ComponentProps } from 'react';
import type { ClerkProvider } from '@clerk/nextjs';
import translations from './clerk-fr.json';

type ClerkLocalization = NonNullable<ComponentProps<typeof ClerkProvider>['localization']>;

export const clerkFrFR = translations as ClerkLocalization;
