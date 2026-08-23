#!/usr/bin/env node

// Verifier for the 证据 (audit evidence storage) Phase 2 workstream.
//
// Covers INV-AGENT-FORUM-ADDITIVE-STORAGE-DESIGN-V1 §8.3 K / §9.1 / §9.3:
//   SQL-015 forum_audit_events_provenance_ck        (closed-set CHECK)
//   SQL-016 forum_audit_events_append_only_tg       (append-only trigger)
//   SQL-017 revoke-forum-app-audit-mutation         (forum_app SELECT/INSERT only)
//
// Requirements (B-VERIFIER-001 quality bar, mirroring
// verify-migration-foundation.mjs):
//   * fail closed when no database URL is set; the target MUST be a disposable
//     PostgreSQL database — never the source database;
//   * ON_ERROR_STOP plus explicit lock_timeout / statement_timeout;
//   * the audit table must be empty before verification starts;
//   * every test row is created inside one transaction that ends in ROLLBACK;
//   * the audit table must still be empty after the rollback;
//   * any unexpected SQLSTATE fails the verifier itself;
//   * catalog assertions bind by schema + table + object identity + normalized
//     definition + function OID + trigger event mask — never by name counting.
//
// The verification connection must be able to SET ROLE to the table owner and
// to forum_app (run it as a superuser, or as a role holding both memberships).
// forum_app itself stays NOLOGIN: privilege probes always go through SET ROLE.

import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.AUDIT_EVIDENCE_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set AUDIT_EVIDENCE_STORAGE_DATABASE_URL to a disposable PostgreSQL database.');
  process.exit(2);
}

const sql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SET search_path = pg_catalog, public;

-- The audit table must be empty before verification begins, and the
-- migration must not have created a second forum_forbid_mutation function
-- (no decoys exist yet at this point).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.forum_audit_events;
  IF n <> 0 THEN
    RAISE EXCEPTION 'forum_audit_events must be empty before verification, found % rows', n;
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_proc WHERE proname = 'forum_forbid_mutation';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one forum_forbid_mutation function cluster-wide, found %', n;
  END IF;
  RAISE NOTICE 'AUDIT_TABLE_EMPTY_BEFORE=PASS';
  RAISE NOTICE 'SINGLE_FORBID_MUTATION_FUNCTION=PASS';
END $$;

BEGIN;

CREATE FUNCTION pg_temp.expect_error(label text, command text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION '% rejected with SQLSTATE %, expected %: %', label, SQLSTATE, expected_state, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS reject: % [%]', label, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'expected rejection but command succeeded: %', label;
END $$;

-- Run a command under another role and require a specific SQLSTATE.
-- The table owner and forum_app are both probed this way: forum_app is NOLOGIN,
-- and the owner name is discovered from the catalog, never hard-coded.
CREATE FUNCTION pg_temp.expect_role_error(label text, command text, role_name text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET ROLE %I', role_name);
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION '% (as %) rejected with SQLSTATE %, expected %: %', label, role_name, SQLSTATE, expected_state, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS deny: % as % [%]', label, role_name, SQLSTATE;
    RESET ROLE;
    RETURN;
  END;
  RESET ROLE;
  RAISE EXCEPTION 'expected rejection as % but command succeeded: %', role_name, label;
END $$;

CREATE FUNCTION pg_temp.expect_role_success(label text, command text, role_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET ROLE %I', role_name);
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% (as %) unexpectedly rejected: [%] %', label, role_name, SQLSTATE, SQLERRM;
  END;
  RESET ROLE;
  RAISE NOTICE 'PASS allow: % as %', label, role_name;
END $$;

-- ---------------------------------------------------------------------------
-- Exact catalog binding assertions.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.audit_table_owner() RETURNS name LANGUAGE sql AS $fn$
  SELECT pg_catalog.pg_get_userbyid(relowner)
  FROM pg_catalog.pg_class
  WHERE oid = pg_catalog.to_regclass('public.forum_audit_events')
$fn$;

CREATE FUNCTION pg_temp.assert_check(p_table text, p_conname text, p_def text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
  WHERE ns.nspname = 'public'
    AND cl.relname = p_table
    AND c.conname = p_conname
    AND c.contype = 'c'
    AND regexp_replace(pg_catalog.pg_get_constraintdef(c.oid), '\s+', ' ', 'g') = p_def;
  IF n <> 1 THEN
    RAISE EXCEPTION 'CHECK exact binding failed: public.%.% with exact definition: expected exactly one contype=c row, found %', p_table, p_conname, n;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_fk(p_child text, p_conname text, p_child_cols text, p_parent text, p_parent_cols text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class child ON child.oid = c.conrelid
  JOIN pg_catalog.pg_namespace cn ON cn.oid = child.relnamespace
  JOIN pg_catalog.pg_class parent ON parent.oid = c.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
  WHERE cn.nspname = 'public'
    AND child.relname = p_child
    AND pn.nspname = 'public'
    AND parent.relname = p_parent
    AND c.conname = p_conname
    AND c.contype = 'f'
    AND c.confdeltype = 'r'
    AND c.confupdtype = 'r'
    AND (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY k.ord)
         FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) = p_child_cols
    AND (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY k.ord)
         FROM pg_catalog.unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) = p_parent_cols;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FK exact binding failed: public.%.% (%) -> public.% (%): expected exactly one contype=f, RESTRICT/RESTRICT row, found %', p_child, p_conname, p_child_cols, p_parent, p_parent_cols, n;
  END IF;
END $fn$;

-- tgtype 27 is exactly ROW(1) | BEFORE(2) | DELETE(8) | UPDATE(16):
-- no INSERT(4), no TRUNCATE(32).
CREATE FUNCTION pg_temp.assert_trigger(p_table text, p_tgname text, p_func text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_trigger tg
  WHERE NOT tg.tgisinternal
    AND tg.tgrelid = pg_catalog.to_regclass('public.' || p_table)
    AND tg.tgname = p_tgname
    AND tg.tgfoid = pg_catalog.to_regprocedure('public.' || p_func || '()')
    AND tg.tgtype = 27
    AND tg.tgenabled = 'O';
  IF n <> 1 THEN
    RAISE EXCEPTION 'trigger exact binding failed: % ON public.% EXECUTE public.%(): expected exactly one enabled non-internal row-level BEFORE UPDATE OR DELETE trigger, found %', p_tgname, p_table, p_func, n;
  END IF;
END $fn$;

-- Exact physical column shape: name, type, nullability, and DB defaults.
CREATE FUNCTION pg_temp.assert_column(p_table text, p_column text, p_type text, p_notnull boolean, p_default text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  SELECT a.attnotnull, pg_catalog.format_type(a.atttypid, a.atttypmod) AS ty,
         pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS def
  INTO r
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class cl ON cl.oid = a.attrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE ns.nspname = 'public' AND cl.relname = p_table AND a.attname = p_column AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'column binding failed: public.%.% not found', p_table, p_column;
  END IF;
  IF r.ty <> p_type THEN
    RAISE EXCEPTION 'column type binding failed: public.%.% is %, expected %', p_table, p_column, r.ty, p_type;
  END IF;
  IF r.attnotnull <> p_notnull THEN
    RAISE EXCEPTION 'column nullability binding failed: public.%.% attnotnull=%, expected %', p_table, p_column, r.attnotnull, p_notnull;
  END IF;
  IF p_default IS NOT NULL AND r.def IS DISTINCT FROM p_default THEN
    RAISE EXCEPTION 'column default binding failed: public.%.% default is %, expected %', p_table, p_column, r.def, p_default;
  END IF;
END $fn$;

-- SQL-017 result binding: forum_app holds exactly SELECT and INSERT on exactly
-- public.forum_audit_events, from an explicit ACL entry (not via PUBLIC).
CREATE FUNCTION pg_temp.assert_forum_app_privileges()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE granted text[];
BEGIN
  SELECT array_agg(privilege_type ORDER BY privilege_type) INTO granted
  FROM pg_catalog.aclexplode(
    (SELECT relacl FROM pg_catalog.pg_class
     WHERE oid = pg_catalog.to_regclass('public.forum_audit_events'))
  )
  WHERE grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'forum_app');
  IF granted IS DISTINCT FROM ARRAY['INSERT', 'SELECT'] THEN
    RAISE EXCEPTION 'forum_app privilege binding failed: explicit ACL grants are %, expected exactly [INSERT, SELECT]', granted;
  END IF;

  IF NOT pg_catalog.has_table_privilege('forum_app', 'public.forum_audit_events', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('forum_app', 'public.forum_audit_events', 'INSERT') THEN
    RAISE EXCEPTION 'forum_app effective privileges missing SELECT or INSERT';
  END IF;
  IF pg_catalog.has_table_privilege('forum_app', 'public.forum_audit_events', 'UPDATE')
     OR pg_catalog.has_table_privilege('forum_app', 'public.forum_audit_events', 'DELETE')
     OR pg_catalog.has_table_privilege('forum_app', 'public.forum_audit_events', 'TRUNCATE') THEN
    RAISE EXCEPTION 'forum_app must not hold UPDATE, DELETE, or TRUNCATE';
  END IF;

  -- PUBLIC (grantee 0) must hold no mutation privilege.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(
      (SELECT relacl FROM pg_catalog.pg_class
       WHERE oid = pg_catalog.to_regclass('public.forum_audit_events'))
    )
    WHERE grantee = 0
      AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'PUBLIC must hold no mutation privilege on public.forum_audit_events';
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_audit_catalog()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  n integer;
  v_owner name;
  v_rec record;
BEGIN
  -- SQL-015 exact binding.
  PERFORM pg_temp.assert_check('forum_audit_events', 'forum_audit_events_provenance_ck',
    $d$CHECK ((provenance = ANY (ARRAY['runtime'::text, 'migration'::text])))$d$);

  -- FK exact bindings, both RESTRICT / RESTRICT.
  PERFORM pg_temp.assert_fk('forum_audit_events', 'forum_audit_events_actor_principal_id_fkey',
    'actor_principal_id', 'forum_principals', 'id');
  PERFORM pg_temp.assert_fk('forum_audit_events', 'forum_audit_events_thread_id_fkey',
    'thread_id', 'forum_threads', 'id');

  -- SQL-016 exact binding: enabled row-level BEFORE UPDATE OR DELETE trigger
  -- executing exactly public.forum_forbid_mutation().
  PERFORM pg_temp.assert_trigger('forum_audit_events', 'forum_audit_events_append_only_tg', 'forum_forbid_mutation');

  -- Exactly one forum_forbid_mutation exists in public with the expected
  -- identity; decoy functions in foreign schemas are tolerated here because
  -- the trigger binding above is OID-exact. Cluster-wide uniqueness is
  -- asserted separately where no decoys are planted.
  SELECT count(*) INTO n
  FROM pg_catalog.pg_proc pr
  JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public'
    AND pr.proname = 'forum_forbid_mutation'
    AND pg_catalog.pg_get_function_identity_arguments(pr.oid) = ''
    AND pg_catalog.pg_get_function_result(pr.oid) = 'trigger';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one public.forum_forbid_mutation() returns trigger, found %', n;
  END IF;

  -- Physical column shape (§8.3 K).
  PERFORM pg_temp.assert_column('forum_audit_events', 'event_id', 'uuid', true);
  PERFORM pg_temp.assert_column('forum_audit_events', 'event_type', 'text', true);
  PERFORM pg_temp.assert_column('forum_audit_events', 'actor_principal_id', 'uuid', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'auth_subject', 'text', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'agent_id', 'text', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'client_id', 'text', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'target_type', 'text', true);
  PERFORM pg_temp.assert_column('forum_audit_events', 'target_id', 'uuid', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'thread_id', 'uuid', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'revision', 'integer', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'request_correlation_id', 'text', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'idempotency_key', 'text', false);
  PERFORM pg_temp.assert_column('forum_audit_events', 'payload', 'jsonb', true, $$'{}'::jsonb$$);
  PERFORM pg_temp.assert_column('forum_audit_events', 'provenance', 'text', true);
  PERFORM pg_temp.assert_column('forum_audit_events', 'created_at', 'timestamp(3) with time zone', true, 'CURRENT_TIMESTAMP');

  -- Primary key on exactly event_id.
  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  WHERE c.contype = 'p'
    AND c.conrelid = pg_catalog.to_regclass('public.forum_audit_events')
    AND pg_catalog.pg_get_constraintdef(c.oid) = 'PRIMARY KEY (event_id)';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one PRIMARY KEY (event_id) on public.forum_audit_events, found %', n;
  END IF;

  -- SQL-017 result binding.
  PERFORM pg_temp.assert_forum_app_privileges();

  -- Owner separation: the table owner is not forum_app, and forum_app is not
  -- a privileged role.
  v_owner := pg_temp.audit_table_owner();
  IF v_owner = 'forum_app' THEN
    RAISE EXCEPTION 'forum_app must not own public.forum_audit_events';
  END IF;
  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin INTO v_rec
  FROM pg_catalog.pg_roles WHERE rolname = 'forum_app';
  IF v_rec.rolsuper OR v_rec.rolbypassrls OR v_rec.rolcreaterole OR v_rec.rolcreatedb OR v_rec.rolcanlogin THEN
    RAISE EXCEPTION 'forum_app must be a minimal non-login role (no superuser/bypassrls/createrole/createdb/login)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_owner AND rolcanlogin) THEN
    RAISE NOTICE 'NOTE table owner % is a NOLOGIN role', v_owner;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.expect_catalog_pass(p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.assert_audit_catalog();
  RAISE NOTICE 'PASS catalog: %', p_label;
END $fn$;

CREATE FUNCTION pg_temp.expect_catalog_fail(p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    PERFORM pg_temp.assert_audit_catalog();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS decoy-reject: % [%]', p_label, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'catalog assertion unexpectedly passed while the real object was unavailable: %', p_label;
END $fn$;

SELECT pg_temp.expect_catalog_pass('SQL-015..SQL-017 exact schema, table, column, definition, function, and event binding');

-- ---------------------------------------------------------------------------
-- Valid parent rows for FK tests (created inside the rollback-only tx).
-- ---------------------------------------------------------------------------

INSERT INTO public.forum_principals (id, auth_subject, "updatedAt") VALUES
  ('10000000-0000-0000-0000-000000000001', 'audit-verifier-subject', now());
INSERT INTO public.forum_threads (id, title, "createdById", "createdByName", "createdAt", "updatedAt") VALUES
  ('20000000-0000-0000-0000-000000000001', 'audit-verifier-thread', 'verifier', 'verifier', now(), now());

-- ---------------------------------------------------------------------------
-- 1) Provenance CHECK truth table (SQL-015).
-- ---------------------------------------------------------------------------

INSERT INTO public.forum_audit_events
  (event_id, event_type, actor_principal_id, target_type, payload, provenance)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'verifier.accept', '10000000-0000-0000-0000-000000000001', 'thread', '{}', 'runtime');
INSERT INTO public.forum_audit_events
  (event_id, event_type, target_type, payload, provenance)
VALUES
  ('30000000-0000-0000-0000-000000000002', 'verifier.accept.system', 'thread', '{}', 'migration');
SELECT pg_temp.expect_error('provenance backfill rejected', $q$
  INSERT INTO public.forum_audit_events (event_id, event_type, target_type, payload, provenance)
  VALUES ('30000000-0000-0000-0000-000000000003', 'verifier.reject', 'thread', '{}', 'backfill')
$q$, '23514');
SELECT pg_temp.expect_error('provenance NULL rejected by NOT NULL', $q$
  INSERT INTO public.forum_audit_events (event_id, event_type, target_type, payload, provenance)
  VALUES ('30000000-0000-0000-0000-000000000004', 'verifier.reject.null', 'thread', '{}', NULL)
$q$, '23502');
-- payload DB default '{}' applies when omitted.
DO $$
DECLARE d jsonb;
BEGIN
  INSERT INTO public.forum_audit_events (event_id, event_type, target_type, provenance)
  VALUES ('30000000-0000-0000-0000-000000000005', 'verifier.default-payload', 'thread', 'runtime');
  SELECT payload INTO d FROM public.forum_audit_events WHERE event_id = '30000000-0000-0000-0000-000000000005';
  IF d IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'payload default binding failed: %', d;
  END IF;
  RAISE NOTICE 'PASS default: payload omitted resolves to {}';
END $$;

-- ---------------------------------------------------------------------------
-- 2/3) FK negatives.
-- ---------------------------------------------------------------------------

SELECT pg_temp.expect_error('invalid actor principal FK', $q$
  INSERT INTO public.forum_audit_events (event_id, event_type, actor_principal_id, target_type, payload, provenance)
  VALUES ('30000000-0000-0000-0000-000000000006', 'verifier.fk', 'ffffffff-0000-0000-0000-00000000000f', 'thread', '{}', 'runtime')
$q$, '23503');
SELECT pg_temp.expect_error('invalid thread FK', $q$
  INSERT INTO public.forum_audit_events (event_id, event_type, target_type, thread_id, payload, provenance)
  VALUES ('30000000-0000-0000-0000-000000000007', 'verifier.fk', 'thread', 'ffffffff-0000-0000-0000-00000000000e', '{}', 'runtime')
$q$, '23503');

-- ---------------------------------------------------------------------------
-- 4/5) Append-only trigger rejects UPDATE and DELETE even for the table owner
--     (SQL-016). The owner name comes from the catalog, not a hard-coded value.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_owner name := pg_temp.audit_table_owner();
BEGIN
  RAISE NOTICE 'AUDIT_TABLE_OWNER=%', v_owner;
  RAISE NOTICE 'MIGRATION_OWNER_FORUM_APP_SEPARATED=YES';
END $$;
SELECT pg_temp.expect_role_error('append-only UPDATE rejected for table owner', $q$
  UPDATE public.forum_audit_events SET event_type = 'tampered' WHERE event_id = '30000000-0000-0000-0000-000000000001'
$q$, pg_temp.audit_table_owner(), '55000');
SELECT pg_temp.expect_role_error('append-only DELETE rejected for table owner', $q$
  DELETE FROM public.forum_audit_events WHERE event_id = '30000000-0000-0000-0000-000000000001'
$q$, pg_temp.audit_table_owner(), '55000');
SELECT pg_temp.expect_role_error('append-only UPDATE rejected for superuser', $q$
  UPDATE public.forum_audit_events SET payload = '{"tampered":true}' WHERE event_id = '30000000-0000-0000-0000-000000000001'
$q$, session_user, '55000');

-- ---------------------------------------------------------------------------
-- 6..10) forum_app effective privileges (SQL-017).
-- ---------------------------------------------------------------------------

SELECT pg_temp.expect_role_success('forum_app INSERT allowed', $q$
  INSERT INTO public.forum_audit_events
    (event_id, event_type, actor_principal_id, auth_subject, agent_id, client_id,
     target_type, target_id, thread_id, revision, request_correlation_id, idempotency_key,
     payload, provenance)
  VALUES
    ('40000000-0000-0000-0000-000000000001', 'verifier.app-insert',
     '10000000-0000-0000-0000-000000000001', 'audit-verifier-subject', NULL, 'verifier-client',
     'thread', NULL, '20000000-0000-0000-0000-000000000001', NULL, 'corr-1', 'idem-1',
     '{"bounded":"metadata"}', 'runtime')
$q$, 'forum_app');
SELECT pg_temp.expect_role_success('forum_app SELECT allowed', $q$
  SELECT count(*) FROM public.forum_audit_events WHERE event_type = 'verifier.app-insert'
$q$, 'forum_app');
SELECT pg_temp.expect_role_error('forum_app UPDATE denied', $q$
  UPDATE public.forum_audit_events SET payload = '{"tampered":true}' WHERE event_id = '40000000-0000-0000-0000-000000000001'
$q$, 'forum_app', '42501');
SELECT pg_temp.expect_role_error('forum_app DELETE denied', $q$
  DELETE FROM public.forum_audit_events WHERE event_id = '40000000-0000-0000-0000-000000000001'
$q$, 'forum_app', '42501');
SELECT pg_temp.expect_role_error('forum_app TRUNCATE denied', $q$
  TRUNCATE public.forum_audit_events
$q$, 'forum_app', '42501');

-- 11/12) forum_app cannot reconfigure the guard itself.
SELECT pg_temp.expect_role_error('forum_app cannot DISABLE TRIGGER', $q$
  ALTER TABLE public.forum_audit_events DISABLE TRIGGER forum_audit_events_append_only_tg
$q$, 'forum_app', '42501');
SELECT pg_temp.expect_role_error('forum_app cannot ALTER TABLE', $q$
  ALTER TABLE public.forum_audit_events ADD COLUMN tampered_by_app boolean DEFAULT false
$q$, 'forum_app', '42501');

-- ---------------------------------------------------------------------------
-- 14) PUBLIC holds no mutation privilege: functional proof with a fresh probe
--     role that has no grants at all (created and destroyed inside this tx).
-- ---------------------------------------------------------------------------

CREATE ROLE forum_public_probe NOLOGIN;
SELECT pg_temp.expect_role_error('probe role (PUBLIC only) UPDATE denied', $q$
  UPDATE public.forum_audit_events SET payload = '{"tampered":true}' WHERE true
$q$, 'forum_public_probe', '42501');
SELECT pg_temp.expect_role_error('probe role (PUBLIC only) DELETE denied', $q$
  DELETE FROM public.forum_audit_events WHERE true
$q$, 'forum_public_probe', '42501');
SELECT pg_temp.expect_role_error('probe role (PUBLIC only) TRUNCATE denied', $q$
  TRUNCATE public.forum_audit_events
$q$, 'forum_public_probe', '42501');

-- ---------------------------------------------------------------------------
-- Decoy resistance: same-name objects in a wrong schema / wrong bindings must
-- not substitute for the real SQL-015..017 objects.
-- ---------------------------------------------------------------------------

CREATE SCHEMA af_audit_decoy;
CREATE TABLE af_audit_decoy.decoy_target (id uuid PRIMARY KEY, provenance text);
ALTER TABLE af_audit_decoy.decoy_target
  ADD CONSTRAINT forum_audit_events_provenance_ck CHECK (provenance IN ('runtime'));
CREATE FUNCTION af_audit_decoy.forum_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $d$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000'; END $d$;
CREATE TRIGGER forum_audit_events_append_only_tg
BEFORE UPDATE OR DELETE ON af_audit_decoy.decoy_target
FOR EACH ROW EXECUTE FUNCTION af_audit_decoy.forum_forbid_mutation();

SELECT pg_temp.expect_catalog_pass('decoy objects present; real objects still exactly identified');

SAVEPOINT decoy_ck;
ALTER TABLE public.forum_audit_events
  RENAME CONSTRAINT forum_audit_events_provenance_ck TO forum_audit_events_provenance_ck_hidden;
SELECT pg_temp.expect_catalog_fail('DECOY wrong-schema same-name CHECK cannot substitute');
ROLLBACK TO SAVEPOINT decoy_ck;

SAVEPOINT decoy_tg;
DROP TRIGGER forum_audit_events_append_only_tg ON public.forum_audit_events;
CREATE TRIGGER forum_audit_events_append_only_tg
BEFORE UPDATE OR DELETE ON public.forum_audit_events
FOR EACH ROW EXECUTE FUNCTION af_audit_decoy.forum_forbid_mutation();
SELECT pg_temp.expect_catalog_fail('DECOY trigger rebound to wrong function cannot substitute');
ROLLBACK TO SAVEPOINT decoy_tg;

SAVEPOINT decoy_tg_events;
ALTER TRIGGER forum_audit_events_append_only_tg ON public.forum_audit_events
  RENAME TO forum_audit_events_append_only_tg_hidden;
SELECT pg_temp.expect_catalog_fail('DECOY renamed real trigger cannot be substituted by decoy');
ROLLBACK TO SAVEPOINT decoy_tg_events;

DROP SCHEMA af_audit_decoy CASCADE;
SELECT pg_temp.expect_catalog_pass('exact catalog binding restored after decoy removal');

DO $$
DECLARE n integer;
BEGIN
  IF pg_catalog.to_regnamespace('af_audit_decoy') IS NOT NULL THEN
    RAISE EXCEPTION 'decoy schema still exists';
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_proc
  WHERE proname = 'forum_forbid_mutation';
  IF n <> 1 THEN RAISE EXCEPTION 'forum_forbid_mutation count is % after decoys, expected 1', n; END IF;
  RAISE NOTICE 'DECOY_RESIDUE=NONE';
END $$;

SELECT pg_temp.expect_catalog_pass('final pre-rollback exact catalog binding');

ROLLBACK;

-- ---------------------------------------------------------------------------
-- Post-rollback assertions: audit table empty again, no test residue, guards
-- still enabled, and the probe role gone.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.forum_audit_events;
  IF n <> 0 THEN RAISE EXCEPTION 'forum_audit_events not empty after rollback: %', n; END IF;

  IF EXISTS (SELECT 1 FROM public.forum_principals WHERE id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'verifier principal row survived rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.forum_threads WHERE id = '20000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'verifier thread row survived rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'forum_public_probe') THEN
    RAISE EXCEPTION 'probe role survived rollback';
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_proc WHERE proname = 'forum_forbid_mutation';
  IF n <> 1 THEN
    RAISE EXCEPTION 'forum_forbid_mutation count is % after rollback, expected 1', n;
  END IF;

  -- The catalog bindings were already re-asserted before the ROLLBACK; after
  -- it, re-check the structural essentials with plain SQL only, because the
  -- pg_temp helpers do not survive the transaction rollback.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = pg_catalog.to_regclass('public.forum_audit_events')
      AND tgname = 'forum_audit_events_append_only_tg'
      AND tgfoid = pg_catalog.to_regprocedure('public.forum_forbid_mutation()')
      AND tgtype = 27 AND tgenabled = 'O' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'append-only trigger missing or misbound after rollback';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public' AND cl.relname = 'forum_audit_events'
      AND c.conname = 'forum_audit_events_provenance_ck' AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'provenance CHECK missing after rollback';
  END IF;
  IF pg_catalog.has_table_privilege('forum_app', 'public.forum_audit_events', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('forum_app', 'public.forum_audit_events', 'INSERT') THEN
    RAISE EXCEPTION 'forum_app privilege boundary changed after rollback';
  END IF;

  RAISE NOTICE 'AUDIT_TABLE_EMPTY_AFTER=PASS';
  RAISE NOTICE 'PROVENANCE_CHECK=PASS (runtime/migration accept; other 23514; NULL 23502)';
  RAISE NOTICE 'APPEND_ONLY_TRIGGER=PASS (owner/superuser UPDATE+DELETE 55000)';
  RAISE NOTICE 'FORUM_APP_SELECT=PASS';
  RAISE NOTICE 'FORUM_APP_INSERT=PASS';
  RAISE NOTICE 'FORUM_APP_UPDATE=DENIED 42501';
  RAISE NOTICE 'FORUM_APP_DELETE=DENIED 42501';
  RAISE NOTICE 'FORUM_APP_TRUNCATE=DENIED 42501';
  RAISE NOTICE 'FORUM_APP_CANNOT_DISABLE_TRIGGER=PASS';
  RAISE NOTICE 'FORUM_APP_CANNOT_ALTER_TABLE=PASS';
  RAISE NOTICE 'FORUM_APP_NOT_TABLE_OWNER=PASS';
  RAISE NOTICE 'PUBLIC_MUTATION_PRIVILEGES=NONE';
  RAISE NOTICE 'TABLE_OWNER_SEPARATED_FROM_FORUM_APP=YES';
  RAISE NOTICE 'PAYLOAD_BOUNDARY_RUNTIME_ENFORCEMENT=DEFERRED_TO_FUTURE_WRITER';
  RAISE NOTICE 'SQL_015_TO_017_COMPLETE=PASS';
END $$;
`;

const result = spawnSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl], {
  input: sql,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
