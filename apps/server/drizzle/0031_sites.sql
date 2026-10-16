CREATE TABLE sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 name text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK (version > 0), published_revision_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_org_updated_idx ON sites(organization_id, updated_at);
CREATE TABLE site_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK (version > 0), files jsonb NOT NULL, assets jsonb, storage_driver text,
 created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT site_revisions_version_idx UNIQUE (site_id, version),
 CONSTRAINT site_revisions_site_id_id_unique UNIQUE (site_id, id)
);
ALTER TABLE sites ADD CONSTRAINT sites_published_revision_fk FOREIGN KEY (id, published_revision_id)
 REFERENCES site_revisions(site_id, id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE site_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 token text NOT NULL, files jsonb NOT NULL, generation integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL,
 CONSTRAINT site_previews_token_idx UNIQUE (token)
);
CREATE INDEX site_previews_expiry_idx ON site_previews(expires_at);
