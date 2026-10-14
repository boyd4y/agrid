-- Tenant attribution must be explicitly resolved by the migration runner/operator.
-- SET NOT NULL fails without changing data if orphan tables remain.
ALTER TABLE tables ALTER COLUMN organization_id SET NOT NULL;
