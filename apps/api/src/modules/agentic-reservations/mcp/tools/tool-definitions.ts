/**
 * TOOL_LIST généré depuis les schémas Zod — source de vérité unique.
 *
 * Au lieu de maintenir deux définitions (JSON Schema dans server.ts + Zod dans
 * schemas.ts), on dérive le JSON Schema directement depuis Zod via
 * zod-to-json-schema. Les métadonnées (title, description, annotations) sont
 * définies ici, à côté du schéma correspondant.
 */

import { z } from 'zod';
import {
  SearchRestaurantsInputSchema,
  GetRestaurantDetailsInputSchema,
  CheckAvailabilityInputSchema,
  CreateQuoteInputSchema,
  CreateHoldInputSchema,
  JoinWaitingListInputSchema,
  CancelWaitingListInputSchema,
  ModifyReservationInputSchema,
  CreateReservationInputSchema,
  CancelReservationInputSchema,
  GetReservationStatusInputSchema,
  SearchRestaurantsOutputSchema,
  AnswerAvailabilityOutputSchema,
  GetRestaurantDetailsOutputSchema,
  CheckAvailabilityOutputSchema,
  CreateQuoteOutputSchema,
  CreateHoldOutputSchema,
  CreateReservationOutputSchema,
  JoinWaitingListOutputSchema,
  CancelWaitingListOutputSchema,
  ModifyReservationOutputSchema,
  CancelReservationOutputSchema,
  GetReservationStatusOutputSchema,
} from './schemas';

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
  output: z.ZodTypeAny;
  requiredScope: 'mcp:read' | 'mcp:reserve' | 'mcp:cancel';
  annotations: ToolAnnotations;
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'answer_availability',
    title: 'Répondre à une question de disponibilité',
    description:
      'À utiliser pour répondre à une question simple en langage courant sur la disponibilité d’un restaurant, sans réservation ni comparaison détaillée. Cherchez une seule fois l’horaire demandé; « vers 19 h » signifie un début à 19 h. Retournez la phrase du résultat telle quelle comme réponse complète, sans ajouter de commentaire sur l’absence de réservation ni de détail opérationnel. Cet outil ne fournit aucun horaire de fin, donnée structurée ni identifiant de restaurant. Pour un parcours de réservation ou une comparaison détaillée, utilisez search_restaurants.',
    schema: SearchRestaurantsInputSchema,
    output: AnswerAvailabilityOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_restaurants',
    title: 'Rechercher un restaurant',
    description:
      'Pour une question simple de disponibilité sans réservation, utilisez answer_availability. Utilisez cette recherche détaillée pour une comparaison ou un parcours qui a besoin des informations structurées. Si la personne nomme un restaurant, transmettez son nom dans restaurantName afin de rechercher cette fiche précise. Utilisez requestedRestaurant.status : unavailable signifie que le restaurant existe mais n’a pas de disponibilité à cette heure; not_found signifie qu’aucune fiche MCP visible ne correspond dans cette ville. Ne déduisez jamais l’existence du restaurant de la seule liste restaurants. Ne demandez jamais de restaurantId ou d’UUID. « Vers 19 h » signifie une recherche unique qui commence à 19 h; ne testez pas les horaires voisins (18 h 30 ou 19 h 30) et ne décalez pas l’heure sans demande explicite. Si l’heure demandée est disponible, mentionnez uniquement celle-ci. Envoyez slotEnd uniquement si la personne a donné une heure de fin ou une durée; sinon omettez-le. Réutilisez exactement le texte lisible du résultat comme réponse complète, sans ajouter de fin, de durée ni de proposition de réservation. Gardez les identifiants retournés pour les appels d’outils, sans les montrer.',
    schema: SearchRestaurantsInputSchema,
    output: SearchRestaurantsOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_restaurant_details',
    title: 'Consulter un restaurant',
    description:
      'Consultez les détails publics du restaurant choisi à partir de son identifiant interne obtenu par la recherche. Ne demandez jamais cet identifiant à la personne et ne le citez pas dans votre réponse.',
    schema: GetRestaurantDetailsInputSchema,
    output: GetRestaurantDetailsOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'check_availability',
    title: 'Vérifier les disponibilités',
    description:
      'Vérifiez une seule fois l’heure demandée par la personne dans l’heure locale du restaurant; ne multipliez pas les appels sur des horaires voisins sans demande explicite. Si aucune durée ou heure de fin n’a été donnée, omettez slotEnd. Réutilisez exactement le texte lisible du résultat comme réponse complète, sans ajouter de fin, de durée ni de proposition de réservation. Utilisez l’identifiant obtenu par la recherche et gardez-le interne. S’il n’y a pas de disponibilité, présentez uniquement les alternatives réellement retournées. Si la capacité en ligne est dépassée, expliquez simplement la limite et demandez si la personne souhaite un autre nombre de convives.',
    schema: CheckAvailabilityInputSchema,
    output: CheckAvailabilityOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_quote',
    title: 'Préparer une estimation',
    description:
      'Créez une estimation temporaire à titre informatif. Elle ne bloque pas le créneau et son identifiant ne permet pas de réserver. Ne montrez pas cet identifiant à la personne.',
    schema: CreateQuoteInputSchema,
    output: CreateQuoteOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'create_hold',
    title: 'Garder un créneau temporairement',
    description:
      'Gardez temporairement le créneau disponible pendant la confirmation. Réutilisez le holdToken uniquement dans l’appel interne à create_reservation; ne le montrez jamais à la personne.',
    schema: CreateHoldInputSchema,
    output: CreateHoldOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'create_reservation',
    title: 'Créer une réservation',
    description:
      'Créez la réservation après confirmation claire du récapitulatif et consentement explicite au traitement des données. Demandez le nom et le numéro habituel seulement s’ils manquent; convertissez en interne date, heure et téléphone aux formats requis. Générez et réutilisez vous-même une idempotencyKey stable en cas de nouvel essai. Ne demandez ni ne montrez jamais restaurantId, holdToken, idempotencyKey ou reservationId. Après succès, répondez avec une confirmation naturelle et concise, sans exposer reused ni les champs techniques.',
    schema: CreateReservationInputSchema,
    output: CreateReservationOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'join_waiting_list',
    title: 'Rejoindre la liste d’attente',
    description:
      'Si le créneau est complet et que la liste d’attente est activée, proposez cette option. N’inscrivez la personne qu’après son accord et le consentement requis. Gardez les identifiants et jetons d’action internes.',
    schema: JoinWaitingListInputSchema,
    output: JoinWaitingListOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'cancel_waiting_list',
    title: 'Quitter la liste d’attente',
    description:
      'Retirez la personne de la liste en utilisant en interne le jeton d’action déjà reçu. Ne lui demandez pas de recopier ce jeton.',
    schema: CancelWaitingListInputSchema,
    output: CancelWaitingListOutputSchema,
    requiredScope: 'mcp:cancel',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'modify_reservation',
    title: 'Modifier une réservation',
    description:
      'Modifiez uniquement les éléments explicitement demandés, après vérification de la réservation avec le numéro de téléphone d’origine. Utilisez en interne l’identifiant obtenu; ne le demandez pas à la personne. La disponibilité est vérifiée de nouveau avant la modification. Confirmez le résultat en langage courant sans exposer les champs techniques.',
    schema: ModifyReservationInputSchema,
    output: ModifyReservationOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'cancel_reservation',
    title: 'Annuler une réservation',
    description:
      'Annulez uniquement à la demande explicite de la personne, après vérification avec le numéro de téléphone d’origine. Utilisez en interne l’identifiant de réservation; ne le demandez ni ne le montrez. Confirmez simplement lorsque l’annulation a réussi.',
    schema: CancelReservationInputSchema,
    output: CancelReservationOutputSchema,
    requiredScope: 'mcp:cancel',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'get_reservation_status',
    title: 'Consulter une réservation',
    description:
      'Consultez l’état d’une réservation après vérification avec le numéro de téléphone d’origine. L’identifiant est interne : ne le demandez pas à la personne et ne le citez pas dans la réponse. Résumez le restaurant, la date, l’heure locale, le nombre de personnes et l’état utile en langage courant.',
    schema: GetReservationStatusInputSchema,
    output: GetReservationStatusOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
];

const TOOL_DEFINITION_BY_NAME = new Map(
  TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export function getToolOutputSchema(toolName: string): z.ZodTypeAny | undefined {
  return TOOL_DEFINITION_BY_NAME.get(toolName)?.output;
}

// Utiliser le convertisseur natif de Zod 4 : zod-to-json-schema ne sérialise
// pas correctement les schémas Zod 4 et produit des objets vides.
const toJsonSchema = z.toJSONSchema as unknown as (
  schema: z.ZodTypeAny,
  options: typeof JSON_SCHEMA_OPTIONS,
) => Record<string, unknown>;

const JSON_SCHEMA_OPTIONS = {
  target: 'openapi-3.0',
  io: 'input',
  // Contrat MCP publié : chaque objet refuse les champs en plus, comme avant Zod 4
  // (le mode strict des clients, OpenAI compris, l'exige).
  override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
    if (jsonSchema.type === 'object' && jsonSchema.additionalProperties === undefined) {
      jsonSchema.additionalProperties = false;
    }
  },
} as const;

// Les définitions ne font pas partie de la réponse MCP que nous exposons.
function cleanJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _$schema, definitions: _definitions, ...rest } = schema;
  return rest;
}

export const TOOL_LIST = TOOL_DEFINITIONS.map((def) => ({
  name: def.name,
  title: def.title,
  description: def.description,
  inputSchema: cleanJsonSchema(toJsonSchema(def.schema, JSON_SCHEMA_OPTIONS)),
  outputSchema: cleanJsonSchema(toJsonSchema(def.output, JSON_SCHEMA_OPTIONS)),
  securitySchemes: [{ type: 'oauth2' as const, scopes: [def.requiredScope] }],
  annotations: def.annotations,
}));
