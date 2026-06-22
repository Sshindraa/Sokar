-- MCP P1 -- granular scopes for self-service keys

ALTER TABLE "agent_clients"
  ALTER COLUMN "scopes" SET DEFAULT '{"mcp:read","mcp:reserve","mcp:cancel"}';

UPDATE "agent_clients"
SET "scopes" = '{"mcp:read","mcp:reserve","mcp:cancel"}'
WHERE "scopes" = '{"mcp:read","mcp:write"}';
