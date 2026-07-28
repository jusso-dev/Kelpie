-- Issue #80: empty API token scopes no longer mean full access.
-- Rewrite existing empty-scope tokens to an explicit non-sensitive set so
-- integrations keep working without retaining raw-payload/override/audit power.
-- Operators: review Settings -> API tokens after migrate; re-issue any token
-- that intentionally needed sensitive scopes.
UPDATE "api_tokens"
SET "scopes" = '["cases:read", "cases:write", "tasks:read", "tasks:write", "observables:read", "observables:write", "comments:read", "comments:write", "threat_intelligence:read", "threat_landscape:read", "briefing:read", "case_relationships:read", "case_relationships:write", "playbooks:read", "evidence:read", "evidence:write", "alerts:read", "alerts:write", "queues:read", "queues:write", "attack:read", "attack:write"]'::jsonb
WHERE "scopes" = '[]'::jsonb
   OR "scopes" IS NULL
   OR (jsonb_typeof("scopes") = 'array' AND jsonb_array_length("scopes") = 0);
