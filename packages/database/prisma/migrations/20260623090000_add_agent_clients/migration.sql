-- MCP P1 -- clients intégrateurs et clés API hashées

CREATE TABLE "agent_clients" (
  "id"              TEXT NOT NULL,
  "restaurant_id"   TEXT,
  "name"            TEXT NOT NULL,
  "key_prefix"      TEXT NOT NULL,
  "key_hash"        TEXT NOT NULL,
  "scopes"          TEXT[] NOT NULL DEFAULT '{"mcp:read","mcp:write"}',
  "allowed_origins" TEXT[] NOT NULL DEFAULT '{}',
  "revoked_at"      TIMESTAMP(3),
  "last_used_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_clients_key_hash_key" ON "agent_clients"("key_hash");
CREATE INDEX "agent_clients_restaurant_id_idx" ON "agent_clients"("restaurant_id");
CREATE INDEX "agent_clients_key_prefix_idx" ON "agent_clients"("key_prefix");

ALTER TABLE "agent_clients"
  ADD CONSTRAINT "agent_clients_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
