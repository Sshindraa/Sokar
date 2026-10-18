-- Un créneau gardé bloque UNE TABLE, pas tout le restaurant.
--
-- L'ancien index `one_active_hold_per_slot` (restaurant, heure, couverts) date d'avant le plan de salle :
-- il refusait un deuxième créneau gardé de même heure et même nombre de couverts même quand d'autres
-- tables étaient libres. La protection contre la double réservation d'une table est portée par un index
-- partiel par table ; l'ancienne règle ne reste que pour les holds sans table (historiques).
--
-- Migration sans perte : seuls des index sont remplacés, aucune donnée n'est lue ni modifiée. Les deux
-- nouveaux index sont créés AVANT de supprimer l'ancien, dans la même transaction.

CREATE UNIQUE INDEX "one_active_hold_per_table_slot"
ON "agentic_holds" ("table_id", "slot_start")
WHERE "status" = 'ACTIVE' AND "type" = 'HOLD' AND "table_id" IS NOT NULL;

CREATE UNIQUE INDEX "one_active_hold_per_slot_no_table"
ON "agentic_holds" ("restaurant_id", "slot_start", "party_size")
WHERE "status" = 'ACTIVE' AND "type" = 'HOLD' AND "table_id" IS NULL;

DROP INDEX "one_active_hold_per_slot";
