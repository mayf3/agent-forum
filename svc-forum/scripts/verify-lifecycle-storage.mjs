#!/usr/bin/env node

// Phase 2 lifecycle-storage verifier. Run only against a disposable PostgreSQL
// database: data probes are rollback-only and the two concurrent indexes are
// dropped/recreated to rehearse the accepted forward-repair procedure.

import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.LIFECYCLE_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set LIFECYCLE_STORAGE_DATABASE_URL (or DATABASE_URL) to a disposable PostgreSQL database; never use a source or production database.');
  process.exit(2);
}

const sql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SET search_path = pg_catalog, public;

CREATE FUNCTION pg_temp.expect_error(label text, command text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION '% rejected with unexpected SQLSTATE %, expected %: %', label, SQLSTATE, expected_state, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS reject: % [%]', label, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'expected rejection but command succeeded: %', label;
END $fn$;

CREATE FUNCTION pg_temp.expect_success(label text, command text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% unexpectedly rejected with SQLSTATE %: %', label, SQLSTATE, SQLERRM;
  END;
  RAISE NOTICE 'PASS accept: %', label;
END $fn$;

CREATE FUNCTION pg_temp.assert_column(
  p_table text, p_column text, p_type text, p_notnull boolean, p_default text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  SELECT a.attnotnull,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS ty,
         pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS def
  INTO r
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class cl ON cl.oid = a.attrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE ns.nspname = 'public' AND cl.relname = p_table
    AND a.attname = p_column AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'column missing: public.%.%', p_table, p_column;
  END IF;
  IF r.ty <> p_type OR r.attnotnull <> p_notnull OR r.def IS DISTINCT FROM p_default THEN
    RAISE EXCEPTION 'column shape mismatch public.%.%: type=% notnull=% default=%, expected type=% notnull=% default=%',
      p_table, p_column, r.ty, r.attnotnull, r.def, p_type, p_notnull, p_default;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_lifecycle_catalog()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  n integer;
  actual text[];
  body text;
BEGIN
  IF pg_catalog.to_regclass('public.forum_thread_revisions') IS NULL THEN
    RAISE EXCEPTION 'public.forum_thread_revisions is missing';
  END IF;

  PERFORM pg_temp.assert_column('forum_thread_revisions', 'id', 'uuid', true, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'thread_id', 'uuid', true, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'revision', 'integer', true, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'discussion_state', 'text', true, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'opened_at', 'timestamp(3) with time zone', true, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'opened_by_principal_id', 'uuid', true, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'resolved_at', 'timestamp(3) with time zone', false, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'resolved_by_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_thread_revisions', 'created_at', 'timestamp(3) with time zone', true, 'CURRENT_TIMESTAMP');

  SELECT array_agg(a.attname ORDER BY a.attnum) INTO actual
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.forum_thread_revisions'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual <> ARRAY[
    'id','thread_id','revision','discussion_state','opened_at',
    'opened_by_principal_id','resolved_at','resolved_by_principal_id','created_at'
  ]::text[] THEN
    RAISE EXCEPTION 'forum_thread_revisions column set/order mismatch: %', actual;
  END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.forum_thread_revisions'::regclass
    AND c.conname = 'forum_thread_revisions_shape_ck'
    AND c.contype = 'c' AND c.convalidated;
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-041 exact validated CHECK is missing'; END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  WHERE i.indrelid = 'public.forum_thread_revisions'::regclass
    AND idx.relname = 'forum_thread_revisions_thread_id_revision_key'
    AND i.indisunique AND i.indisvalid AND i.indisready
    AND (SELECT array_agg(a.attname::text ORDER BY key.ord)
         FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = i.indrelid AND a.attnum = key.attnum
         WHERE key.ord <= i.indnkeyatts)
        = ARRAY['thread_id','revision']::text[];
  IF n <> 1 THEN RAISE EXCEPTION 'thread/revision unique index is missing or malformed'; END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.forum_thread_revisions'::regclass
    AND c.contype = 'f' AND c.convalidated
    AND c.confdeltype = 'r' AND c.confupdtype = 'r'
    AND c.conname IN (
      'forum_thread_revisions_thread_id_fkey',
      'forum_thread_revisions_opened_by_principal_id_fkey',
      'forum_thread_revisions_resolved_by_principal_id_fkey'
    );
  IF n <> 3 THEN RAISE EXCEPTION 'three validated revision RESTRICT FKs expected, found %', n; END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.forum_threads'::regclass
    AND c.confrelid = 'public.forum_thread_revisions'::regclass
    AND c.conname = 'forum_threads_current_revision_fk'
    AND c.contype = 'f' AND c.convalidated
    AND c.confdeltype = 'r' AND c.confupdtype = 'r'
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
         FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
        = ARRAY['id','current_revision']::text[]
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
         FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum)
        = ARRAY['thread_id','revision']::text[];
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-046 exact validated composite FK is missing'; END IF;

  SELECT regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g') INTO body
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'forum_guard_current_revision'
    AND p.prokind = 'f' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    AND pg_catalog.pg_get_function_result(p.oid) = 'trigger'
    AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
    AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.prosecdef AND p.proconfig IS NULL;
  IF body IS NULL OR body NOT LIKE '%OLD.current_revision IS NULL%NEW.current_revision <> 1%NEW.current_revision > OLD.current_revision + 1%' THEN
    RAISE EXCEPTION 'SQL-042 exact function identity/body mismatch: %', body;
  END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_trigger tg
  WHERE tg.tgrelid = 'public.forum_threads'::regclass
    AND tg.tgname = 'forum_guard_current_revision_tg'
    AND tg.tgfoid = 'public.forum_guard_current_revision()'::regprocedure
    AND NOT tg.tgisinternal AND tg.tgenabled = 'O' AND tg.tgtype = 19;
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-043 exact BEFORE ROW UPDATE trigger is missing'; END IF;

  SELECT regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g') INTO body
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'forum_thread_revisions_insert_guard'
    AND p.prokind = 'f' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    AND pg_catalog.pg_get_function_result(p.oid) = 'trigger'
    AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
    AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.prosecdef AND p.proconfig IS NULL;
  IF body IS NULL OR body NOT LIKE '%FROM "public"."forum_threads"%FOR SHARE%NEW.revision <> cur + 1%' THEN
    RAISE EXCEPTION 'SQL-044 exact function identity/body mismatch: %', body;
  END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_trigger tg
  WHERE tg.tgrelid = 'public.forum_thread_revisions'::regclass
    AND tg.tgname = 'forum_thread_revisions_insert_guard_tg'
    AND tg.tgfoid = 'public.forum_thread_revisions_insert_guard()'::regprocedure
    AND NOT tg.tgisinternal AND tg.tgenabled = 'O' AND tg.tgtype = 7;
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-045 exact BEFORE ROW INSERT trigger is missing'; END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  WHERE i.indrelid = 'public.forum_threads'::regclass
    AND idx.relname = 'forum_threads_visibility_state_cic_idx'
    AND i.indisvalid AND i.indisready AND NOT i.indisunique
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(visibility_state IS NOT NULL)';
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-047 exact valid partial CIC index is missing'; END IF;

  SELECT count(*) INTO n
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  WHERE i.indrelid = 'public.forum_messages'::regclass
    AND idx.relname = 'forum_thread_messages_discussion_revision_cic_idx'
    AND i.indisvalid AND i.indisready AND NOT i.indisunique
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(discussion_revision IS NOT NULL)'
    AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%("threadId", discussion_revision)%';
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-048 exact valid partial CIC index is missing'; END IF;
END $fn$;

SELECT pg_temp.assert_lifecycle_catalog();

DO $fn$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.forum_thread_revisions;
  IF n <> 0 THEN RAISE EXCEPTION 'revision table must be empty before verification, found %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.forum_threads WHERE visibility_state IS NOT NULL OR current_revision IS NOT NULL) THEN
    RAISE EXCEPTION 'Phase 2 lifecycle columns must remain NULL before verification';
  END IF;
  IF EXISTS (SELECT 1 FROM public.forum_messages WHERE discussion_revision IS NOT NULL) THEN
    RAISE EXCEPTION 'Phase 2 message discussion_revision must remain NULL before verification';
  END IF;
  RAISE NOTICE 'LIFECYCLE_EMPTY_AND_NO_BACKFILL_BEFORE=PASS';
END $fn$;

BEGIN;

INSERT INTO public.forum_principals (id, auth_subject, agent_id, "updatedAt") VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'lifecycle-verifier-a', now()),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'lifecycle-verifier-b', now());

INSERT INTO public.forum_threads
  (id, title, "createdById", "createdByName", "createdAt", "updatedAt")
VALUES
  ('30000000-0000-4000-8000-000000000001', 'lifecycle verifier', 'legacy-verifier', 'verifier', now(), now());

SELECT pg_temp.expect_error('initial revision must be one', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 2, 'open', now(), '10000000-0000-4000-8000-000000000001')
$q$, '23514');

SELECT pg_temp.expect_error('legacy_unknown is not a runtime state', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 1, 'legacy_unknown', now(), '10000000-0000-4000-8000-000000000001')
$q$, '23514');

SELECT pg_temp.expect_error('open revision cannot carry resolved time', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id, resolved_at)
  VALUES
    ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', 1, 'open', now(), '10000000-0000-4000-8000-000000000001', now())
$q$, '23514');

SELECT pg_temp.expect_error('resolved revision requires actor and time', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', 1, 'resolved', now(), '10000000-0000-4000-8000-000000000001')
$q$, '23514');

SELECT pg_temp.expect_error('revision thread FK is RESTRICT-bound', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000006', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 1, 'open', now(), '10000000-0000-4000-8000-000000000001')
$q$, '23503');

SELECT pg_temp.expect_error('revision principal FK is RESTRICT-bound', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', 1, 'open', now(), 'ffffffff-ffff-4fff-8fff-ffffffffffff')
$q$, '23503');

SELECT pg_temp.expect_success('insert initial open revision', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, 'open', now(), '10000000-0000-4000-8000-000000000001')
$q$);

SELECT pg_temp.expect_error('duplicate thread revision is rejected', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000001', 1, 'open', now(), '10000000-0000-4000-8000-000000000001')
$q$, '23505');

SELECT pg_temp.expect_error('revision two cannot precede pointer one', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000001', 2, 'open', now(), '10000000-0000-4000-8000-000000000001')
$q$, '23514');

SELECT pg_temp.expect_error('orphan pointer on thread insert is rejected', $q$
  INSERT INTO public.forum_threads
    (id, title, "createdById", "createdByName", "createdAt", "updatedAt", current_revision)
  VALUES
    ('30000000-0000-4000-8000-000000000002', 'orphan pointer', 'legacy-verifier', 'verifier', now(), now(), 1)
$q$, '23503');

SELECT pg_temp.expect_success('set initial pointer to one', $q$
  UPDATE public.forum_threads SET current_revision = 1
  WHERE id = '30000000-0000-4000-8000-000000000001'
$q$);
SELECT pg_temp.expect_success('unchanged pointer is allowed', $q$
  UPDATE public.forum_threads SET current_revision = 1
  WHERE id = '30000000-0000-4000-8000-000000000001'
$q$);
SELECT pg_temp.expect_error('pointer cannot be cleared', $q$
  UPDATE public.forum_threads SET current_revision = NULL
  WHERE id = '30000000-0000-4000-8000-000000000001'
$q$, '23514');
SELECT pg_temp.expect_error('pointer cannot jump', $q$
  UPDATE public.forum_threads SET current_revision = 3
  WHERE id = '30000000-0000-4000-8000-000000000001'
$q$, '23514');

SELECT pg_temp.expect_error('revision insert cannot jump', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000001', 3, 'open', now(), '10000000-0000-4000-8000-000000000001')
$q$, '23514');

SELECT pg_temp.expect_success('insert exact next revision', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000001', 2, 'open', now(), '10000000-0000-4000-8000-000000000001')
$q$);
SELECT pg_temp.expect_success('advance pointer by one', $q$
  UPDATE public.forum_threads SET current_revision = 2
  WHERE id = '30000000-0000-4000-8000-000000000001'
$q$);
SELECT pg_temp.expect_error('pointer cannot decrease', $q$
  UPDATE public.forum_threads SET current_revision = 1
  WHERE id = '30000000-0000-4000-8000-000000000001'
$q$, '23514');
SELECT pg_temp.expect_error('otherwise valid plus-one orphan pointer hits composite FK', $q$
  UPDATE public.forum_threads SET current_revision = 3
  WHERE id = '30000000-0000-4000-8000-000000000001'
$q$, '23503');

SELECT pg_temp.expect_success('resolved revision has actor and time', $q$
  INSERT INTO public.forum_thread_revisions
    (id, thread_id, revision, discussion_state, opened_at, opened_by_principal_id, resolved_at, resolved_by_principal_id)
  VALUES
    ('40000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000001', 3, 'resolved', now(), '10000000-0000-4000-8000-000000000001', now(), '10000000-0000-4000-8000-000000000002')
$q$);

ROLLBACK;

DO $fn$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.forum_thread_revisions;
  IF n <> 0 THEN RAISE EXCEPTION 'revision verifier rows survived rollback: %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.forum_threads WHERE visibility_state IS NOT NULL OR current_revision IS NOT NULL) THEN
    RAISE EXCEPTION 'Phase 2 lifecycle columns were backfilled or verifier data survived rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.forum_messages WHERE discussion_revision IS NOT NULL) THEN
    RAISE EXCEPTION 'Phase 2 message discussion_revision was backfilled';
  END IF;
  RAISE NOTICE 'LIFECYCLE_EMPTY_AND_NO_BACKFILL_AFTER=PASS';
END $fn$;

-- D18 forward-repair rehearsal for the two standalone concurrent indexes.
DROP INDEX CONCURRENTLY "public"."forum_threads_visibility_state_cic_idx";
CREATE INDEX CONCURRENTLY "forum_threads_visibility_state_cic_idx"
ON "public"."forum_threads"("visibility_state")
WHERE "visibility_state" IS NOT NULL;

DROP INDEX CONCURRENTLY "public"."forum_thread_messages_discussion_revision_cic_idx";
CREATE INDEX CONCURRENTLY "forum_thread_messages_discussion_revision_cic_idx"
ON "public"."forum_messages"("threadId", "discussion_revision")
WHERE "discussion_revision" IS NOT NULL;

SELECT pg_temp.assert_lifecycle_catalog();

DO $fn$
BEGIN
  RAISE NOTICE 'SQL_041_REVISION_SHAPE=PASS';
  RAISE NOTICE 'SQL_042_043_POINTER_GUARD=PASS';
  RAISE NOTICE 'SQL_044_045_INSERT_GUARD=PASS';
  RAISE NOTICE 'SQL_046_COMPOSITE_FK=PASS';
  RAISE NOTICE 'SQL_047_048_CIC_FORWARD_REPAIR=PASS';
  RAISE NOTICE 'LIFECYCLE_STORAGE_PHASE_2=PASS';
END $fn$;
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
