# Multi-tenant design — tabdo

> Status: **implemented** (scheme 2, shared tables + `organization_id`).  
> Isolation is **application-enforced** (command / route layer). PostgreSQL RLS is **optional**, not required for v1.

## 1. Goal

Isolate each customer (organization / workspace) so that:

1. **Tenant boundary = `organization_id`** on shared business tables (one database, one `public` schema).
2. **Product “tables” stay metadata + JSONB rows** (scheme 2) — agents “change schema” by mutating `columns` / `config` / related metadata, **not** by `CREATE/ALTER TABLE` per product grid.
3. Humans, built-in harness tools, MCP, and `agt_` API keys all resolve the **same org context** before any data read/write.

## 2. Decisions (locked)

| Topic | Choice |
|---|---|
| Isolation unit | **Shared tables + `organization_id`** (row-scoped by org) |
| Product table storage | **Scheme 2**: fixed system tables `tables` / `columns` / `rows` (+ automations); cells in `rows.cells` JSONB |
| Identity / billing / membership | Same DB (`public`): Better Auth + `organization` / `member` / `invitation` / `agent_profile` |
| Agent structural edits | Allowed on **product metadata** inside the actor’s org only |
| Schema-per-tenant | **Out of scope / excluded** |
| Database-per-tenant | **Out of scope / excluded** |
| One product table → one physical PG table (DDL) | **Not chosen**; may revisit later as optional “hot table” promotion |
| PostgreSQL RLS | **Optional** defense-in-depth; app layer is the primary gate |

## 3. Non-goals

- **No schema-per-tenant** (`CREATE SCHEMA t_…` / `search_path` switching).
- **No database-per-tenant** as the default.
- **No agent-driven DDL** (`CREATE/ALTER/DROP TABLE` for product grids, `GRANT`, etc.).
- **No** treating Better Auth `user` as per-tenant duplicated rows (users are global; membership is org-scoped).

## 4. Two layers (logical, one schema)

```
┌─────────────────────────────────────────────────────────┐
│  Identity & membership (shared rows)                    │
│  · Better Auth: user, session, account, verification    │
│  · organization, member, invitation, agent_profile      │
└─────────────────────────────────────────────────────────┘
                          │
          every request → resolveActor → organizationId
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Workspace data (shared tables, filtered by org)        │
│  · tables.organization_id NOT NULL                       │
│  · columns / rows / automations → via tables.id FK      │
│  Product “add column” = INSERT/UPDATE columns     │
│  Product “cell edit”  = UPDATE rows.cells JSONB         │
└─────────────────────────────────────────────────────────┘
```

### 4.1 Why scheme 2 (not physical DDL per grid)

Aligned with Notion / 飞书-like systems: universal record store; properties are metadata.

| | Scheme 1 — physical DDL | **Scheme 2 — columns + rows JSONB (chosen)** |
|---|---|---|
| Add column | `ALTER TABLE … ADD COLUMN` | Insert into `columns`; optional backfill keys in JSON |
| Agent risk | Catalog churn, injection surface | Constrained command layer; same ops as UI |
| Indexes | Native per column | GIN / expression / composite on `(table_id, …)` + JSON paths as needed |
| Tenant scale | Extra catalog if also schema-per-tenant | Flat catalog; filter by `organization_id` |

**Agent “modifies schema”** means: create/rename/reorder columns, select options, formulas, automations — via the **shared command layer**, never arbitrary SQL DDL.

### 4.2 Why not schema-per-tenant (for this product)

Scheme 2 does **not** need a PG schema per tenant to store data. Schema isolation adds provision/`search_path`/pool complexity; tabdo prefers:

- Simple migrations (one track)
- Easy connection pooling
- Notion-like shared storage + org filter

Teable-style schema-per-base remains a future option if we need heavy native-SQL / BI per workspace.

## 5. Data model

### 5.1 Tenant = Better Auth `organization`

| Field | Role |
|---|---|
| `organization.id` | Tenant id |
| `member` | Humans + agents in the org |
| `agent_profile.organization_id` | Agent API key bound to one org |
| `session.active_organization_id` | UI active workspace |

### 5.2 Workspace data

| Table | Org scope |
|---|---|
| `tables` | **`organization_id` NOT NULL** + index `tables_org_idx` |
| `columns` | Via `table_id` → `tables` |
| `rows` | Via `table_id` → `tables` |
| `automations` / `automation_runs` | Via `table_id` → `tables` |

Denormalizing `organization_id` onto `rows` is **not** required for v1; every access path joins or loads the parent `tables` row and checks org.

## 6. Request context

Every authenticated request resolves:

```
session cookie | Bearer agt_…  →  Actor { userId, organizationId, role, kind }
```

| Actor | How `organizationId` is chosen |
|---|---|
| Human UI | `session.activeOrganizationId`, else first membership |
| Built-in harness chat | Same session org |
| `agt_` API key | `agent_profile.organizationId` |
| MCP | Same key / session binding |

**Invariant:** command handlers that touch workspace data receive `organizationId` and must:

1. `listTables` → `WHERE organization_id = :org`
2. `getTable` / mutations by `tableId` → load table; if `table.organization_id !== org` → treat as **not found** (no cross-tenant leak)
3. Mutations by `rowId` / `columnId` → join parent table; same check
4. `POST /api/tables` → insert with `organization_id = actor.organizationId`

Missing org context → empty list or `401` / `缺少组织上下文` (never global dump).

## 7. Optional PostgreSQL RLS

App-layer checks are mandatory. RLS can be added later as belt-and-suspenders:

```sql
-- illustrative only — not enabled by default
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY tables_org_isolation ON tables
  USING (organization_id = current_setting('app.organization_id', true));
```

App would `SET LOCAL app.organization_id = '…'` per transaction. Defer until pool/`SET LOCAL` discipline is in place.

## 8. Agent / API / MCP / UI — one context

All mutation paths share `POST /api/commands` (and harness tools ≡ MCP ≡ UI). Multitenancy adds:

**Forbidden:** listing or mutating another org’s tables/rows/columns; accepting `organizationId` from the client body as authority (server derives it from actor only).

**Allowed:** scheme 2 metadata edits inside the resolved org.

## 9. Migration / seed

1. Backfill any `tables.organization_id IS NULL` to a default org (demo), then `SET NOT NULL`.
2. Seed **two** orgs with distinct tables/rows.
3. Verify: listing as org A never returns org B’s table ids; `getTable` across orgs fails as not found.

## 10. Ops & tradeoffs

| Concern | Approach |
|---|---|
| Backup | Whole DB (no per-schema dump) |
| Noisy neighbor | Product quotas; later RLS / separate pools if needed |
| Analysis / BI | JSONB + indexes / materialized views; not native per-column SQL |
| Leak risk | Every query path must pass org; code review + smoke isolation test |

## 11. Relation to current code

- `server/src/db/schema.ts` — `tables.organizationId` required
- `server/src/tenant/scope.ts` — assert table/row/column in org
- `server/src/commands/*` + routes — pass `organizationId` from `resolveActor`
- `server/src/db/seed-tenants.ts` — two-tenant seed + isolation check

## 12. Summary

One shared Postgres database and schema; **organization_id** is the tenant boundary; product structure remains **columns + JSONB rows** so agents edit metadata safely. Explicitly **not** schema-per-tenant and **not** database-per-tenant. RLS optional later.
