-- Install only when absent; existing extensions keep their installed schemas.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

DO $migration$
DECLARE
  unaccent_schema TEXT;
  trgm_schema TEXT;
BEGIN
  SELECT n.nspname INTO unaccent_schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent';
  SELECT n.nspname INTO trgm_schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';

  -- This immutable index helper pins the dictionary. Changing its rules or this
  -- normalization requires rebuilding all three dependent indexes.
  EXECUTE format($function$
    CREATE FUNCTION portfolio.search_normalize(value TEXT) RETURNS TEXT
    LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
    AS $body$ SELECT %I.unaccent(%L::regdictionary, lower(normalize(value, NFC))) $body$
  $function$, unaccent_schema, format('%I.unaccent', unaccent_schema));

  EXECUTE format('CREATE INDEX search_users_name_idx ON portfolio.users USING gin (portfolio.search_normalize(name) %I.gin_trgm_ops)', trgm_schema);
  EXECUTE format('CREATE INDEX search_profiles_name_idx ON portfolio.profiles USING gin (portfolio.search_normalize(COALESCE(fields ->> ''name'', '''')) %I.gin_trgm_ops)', trgm_schema);
  EXECUTE format('CREATE INDEX search_projects_title_idx ON portfolio.projects USING gin (portfolio.search_normalize(title) %I.gin_trgm_ops) WHERE published', trgm_schema);

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO portfolio_app', unaccent_schema);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO portfolio_app', trgm_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.unaccent(regdictionary, text) TO portfolio_app', unaccent_schema);
    GRANT USAGE ON SCHEMA portfolio TO portfolio_app;
    GRANT EXECUTE ON FUNCTION portfolio.search_normalize(TEXT) TO portfolio_app;
    GRANT SELECT ON portfolio.users, portfolio.profiles, portfolio.projects TO portfolio_app;
  END IF;
END
$migration$;
