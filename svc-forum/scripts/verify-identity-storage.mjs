#!/usr/bin/env node

// Phase 2 identity-storage verifier. Run only against a disposable PostgreSQL
// database: behavioral probes are rollback-only, but catalog decoys require DDL.

import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.IDENTITY_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set IDENTITY_STORAGE_DATABASE_URL (or DATABASE_URL) to a disposable PostgreSQL database; never use a source or production database.');
  process.exit(2);
}

const sql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SET search_path = pg_catalog, public;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.forum_principal_aliases;
  IF n <> 0 THEN
    RAISE EXCEPTION 'public.forum_principal_aliases must contain zero rows before verification, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_proc
  WHERE proname = 'forum_alias_owner_immutable_guard';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one cluster-wide forum_alias_owner_immutable_guard function before verification, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_trigger
  WHERE tgname IN ('forum_alias_owner_immutable_guard_tg', 'forum_alias_owner_immutable_guard_truncate_tg');
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected exactly the two named alias guard triggers cluster-wide before verification, found %', n;
  END IF;
  RAISE NOTICE 'ALIAS_TABLE_ZERO_ROWS_BEFORE=PASS';
  RAISE NOTICE 'NO_SECOND_SAME_NAME_FUNCTION_OR_TRIGGER=PASS';
END $$;

BEGIN;

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

CREATE FUNCTION pg_temp.assert_check(p_table text, p_name text, p_definition text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
  WHERE ns.nspname = 'public' AND cl.relname = p_table
    AND c.conname = p_name AND c.contype = 'c' AND c.convalidated
    AND regexp_replace(pg_catalog.pg_get_constraintdef(c.oid), '\s+', ' ', 'g') = p_definition;
  IF n <> 1 THEN
    RAISE EXCEPTION 'exact CHECK binding failed for public.%.%, found %', p_table, p_name, n;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_fk(p_child text, p_name text, p_column text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class child ON child.oid = c.conrelid
  JOIN pg_catalog.pg_namespace cn ON cn.oid = child.relnamespace
  JOIN pg_catalog.pg_class parent ON parent.oid = c.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
  WHERE cn.nspname = 'public' AND child.relname = p_child
    AND pn.nspname = 'public' AND parent.relname = 'forum_principals'
    AND c.conname = p_name AND c.contype = 'f' AND c.convalidated
    AND c.confdeltype = 'r' AND c.confupdtype = 'r'
    AND cardinality(c.conkey) = 1 AND cardinality(c.confkey) = 1
    AND (SELECT a.attname FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = p_column
    AND (SELECT a.attname FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) = 'id';
  IF n <> 1 THEN
    RAISE EXCEPTION 'exact validated RESTRICT/RESTRICT FK binding failed for public.%.% (%) -> public.forum_principals(id), found %',
      p_child, p_name, p_column, n;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_identity_catalog()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer; actual text[]; expected text[];
BEGIN
  -- Exactly the thirteen additive columns: nullable, no DB default, and NULL in every row.
  PERFORM pg_temp.assert_column('forum_threads', 'creator_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_threads', 'visibility_state', 'text', false, NULL);
  PERFORM pg_temp.assert_column('forum_threads', 'current_revision', 'integer', false, NULL);
  PERFORM pg_temp.assert_column('forum_messages', 'author_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_messages', 'discussion_revision', 'integer', false, NULL);
  PERFORM pg_temp.assert_column('forum_thread_views', 'viewer_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_outcomes', 'created_by_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_outcomes', 'authority_kind', 'text', false, NULL);
  PERFORM pg_temp.assert_column('forum_context_snapshots', 'taken_by_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_context_snapshots', 'discussion_revision', 'integer', false, NULL);
  PERFORM pg_temp.assert_column('forum_reports', 'reporter_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_reports', 'handled_by_principal_id', 'uuid', false, NULL);
  PERFORM pg_temp.assert_column('forum_reactions', 'actor_principal_id', 'uuid', false, NULL);

  expected := ARRAY[
    'forum_context_snapshots.discussion_revision','forum_context_snapshots.taken_by_principal_id',
    'forum_messages.author_principal_id','forum_messages.discussion_revision',
    'forum_outcomes.authority_kind','forum_outcomes.created_by_principal_id',
    'forum_reactions.actor_principal_id','forum_reports.handled_by_principal_id',
    'forum_reports.reporter_principal_id','forum_thread_views.viewer_principal_id',
    'forum_threads.creator_principal_id','forum_threads.current_revision','forum_threads.visibility_state'
  ];
  SELECT array_agg(cl.relname || '.' || a.attname ORDER BY cl.relname || '.' || a.attname)
  INTO actual
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class cl ON cl.oid=a.attrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
  WHERE ns.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
    AND (cl.relname || '.' || a.attname)=ANY(expected)
    AND NOT a.attnotnull AND ad.oid IS NULL;
  IF actual IS DISTINCT FROM expected OR cardinality(actual) <> 13 THEN
    RAISE EXCEPTION 'expected exactly thirteen named nullable no-default identity columns, found %', actual;
  END IF;

  IF EXISTS (SELECT 1 FROM public.forum_threads WHERE creator_principal_id IS NOT NULL OR visibility_state IS NOT NULL OR current_revision IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_messages WHERE author_principal_id IS NOT NULL OR discussion_revision IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_thread_views WHERE viewer_principal_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_outcomes WHERE created_by_principal_id IS NOT NULL OR authority_kind IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_context_snapshots WHERE taken_by_principal_id IS NOT NULL OR discussion_revision IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_reports WHERE reporter_principal_id IS NOT NULL OR handled_by_principal_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_reactions WHERE actor_principal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'one or more of the thirteen additive columns contains non-NULL migration data';
  END IF;

  -- Exact physical alias table shape, including ordinal positions and defaults.
  SELECT array_agg(format('%s:%s:%s:%s', a.attname,
                         pg_catalog.format_type(a.atttypid,a.atttypmod),
                         a.attnotnull,
                         coalesce(pg_catalog.pg_get_expr(ad.adbin,ad.adrelid),'<null>')) ORDER BY a.attnum)
  INTO actual
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
  WHERE a.attrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
    AND a.attnum>0 AND NOT a.attisdropped;
  expected := ARRAY[
    'id:uuid:t:<null>','principal_id:uuid:t:<null>','namespace:text:t:<null>',
    'value:text:t:<null>','first_seen_at:timestamp(3) with time zone:t:<null>',
    'retired_at:timestamp(3) with time zone:f:<null>',
    'created_at:timestamp(3) with time zone:t:CURRENT_TIMESTAMP'
  ];
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'alias physical column shape mismatch: %', actual;
  END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_constraint c
  WHERE c.conrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
    AND c.conname='forum_principal_aliases_pkey' AND c.contype='p'
    AND pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (id)';
  IF n <> 1 THEN RAISE EXCEPTION 'exact alias PRIMARY KEY (id) missing'; END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
  WHERE i.indrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
    AND ix.relnamespace='public'::pg_catalog.regnamespace
    AND ix.relname='forum_principal_aliases_principal_id_namespace_idx'
    AND NOT i.indisunique AND NOT i.indisprimary AND i.indisvalid AND i.indisready
    AND i.indpred IS NULL AND i.indexprs IS NULL
    AND pg_catalog.pg_get_indexdef(i.indexrelid)='CREATE INDEX forum_principal_aliases_principal_id_namespace_idx ON public.forum_principal_aliases USING btree (principal_id, namespace)';
  IF n <> 1 THEN RAISE EXCEPTION 'exact alias principal_id/namespace index missing'; END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
  WHERE i.indrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
    AND ix.relnamespace='public'::pg_catalog.regnamespace
    AND ix.relname='forum_principal_aliases_namespace_value_key'
    AND i.indisunique AND NOT i.indisprimary AND i.indisvalid AND i.indisready
    AND i.indpred IS NULL AND i.indexprs IS NULL
    AND pg_catalog.pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX forum_principal_aliases_namespace_value_key ON public.forum_principal_aliases USING btree (namespace, value)';
  IF n <> 1 THEN RAISE EXCEPTION 'exact alias namespace/value unique index missing'; END IF;

  PERFORM pg_temp.assert_fk('forum_principal_aliases','forum_principal_aliases_principal_id_fkey','principal_id');
  PERFORM pg_temp.assert_check('forum_principal_aliases','forum_principal_aliases_namespace_ck',
    $d$CHECK ((namespace = ANY (ARRAY['auth_subject'::text, 'agent_id'::text])))$d$);

  -- SQL-019: one exact public no-argument trigger function identity, no overloads.
  SELECT count(*) INTO n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname='forum_alias_owner_immutable_guard';
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-019 expected one public function name, found %', n; END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname='forum_alias_owner_immutable_guard'
    AND p.prokind='f' AND pg_catalog.pg_get_function_identity_arguments(p.oid)=''
    AND pg_catalog.pg_get_function_result(p.oid)='trigger'
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql');
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-019 exact no-arg trigger function identity missing'; END IF;

  -- SQL-020 tgtype 27, with every event/level/timing bit asserted independently.
  SELECT count(*) INTO n FROM pg_catalog.pg_trigger tg
  WHERE NOT tg.tgisinternal AND tg.tgenabled='O'
    AND tg.tgrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
    AND tg.tgname='forum_alias_owner_immutable_guard_tg'
    AND tg.tgfoid=pg_catalog.to_regprocedure('public.forum_alias_owner_immutable_guard()')
    AND tg.tgtype=27
    AND (tg.tgtype & 1)=1 AND (tg.tgtype & 2)=2
    AND (tg.tgtype & 16)=16 AND (tg.tgtype & 8)=8
    AND (tg.tgtype & 4)=0 AND (tg.tgtype & 32)=0;
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-020 exact enabled noninternal tgtype 27 binding/bits missing'; END IF;

  -- SQL-075 tgtype 34: statement BEFORE TRUNCATE only.
  SELECT count(*) INTO n FROM pg_catalog.pg_trigger tg
  WHERE NOT tg.tgisinternal AND tg.tgenabled='O'
    AND tg.tgrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
    AND tg.tgname='forum_alias_owner_immutable_guard_truncate_tg'
    AND tg.tgfoid=pg_catalog.to_regprocedure('public.forum_alias_owner_immutable_guard()')
    AND tg.tgtype=34
    AND (tg.tgtype & 1)=0 AND (tg.tgtype & 2)=2 AND (tg.tgtype & 32)=32
    AND (tg.tgtype & 4)=0 AND (tg.tgtype & 8)=0 AND (tg.tgtype & 16)=0;
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-075 exact enabled noninternal statement BEFORE TRUNCATE-only binding missing'; END IF;

  PERFORM pg_temp.assert_fk('forum_threads','forum_threads_creator_principal_fk','creator_principal_id');
  PERFORM pg_temp.assert_fk('forum_messages','forum_messages_author_principal_fk','author_principal_id');
  PERFORM pg_temp.assert_fk('forum_thread_views','forum_thread_views_viewer_principal_fk','viewer_principal_id');
  PERFORM pg_temp.assert_fk('forum_outcomes','forum_outcomes_created_by_principal_fk','created_by_principal_id');
  PERFORM pg_temp.assert_fk('forum_context_snapshots','forum_context_snapshots_taken_by_principal_fk','taken_by_principal_id');
  PERFORM pg_temp.assert_fk('forum_reports','forum_reports_reporter_principal_fk','reporter_principal_id');
  PERFORM pg_temp.assert_fk('forum_reports','forum_reports_handled_by_principal_fk','handled_by_principal_id');
  PERFORM pg_temp.assert_fk('forum_reactions','forum_reactions_actor_principal_fk','actor_principal_id');

  -- SQL-029 is future watch-subscription work and must not be reused here.
  IF pg_catalog.to_regclass('public.forum_watch_subscriptions') IS NOT NULL THEN
    RAISE EXCEPTION 'SQL-029 boundary violated: forum_watch_subscriptions already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='forum_watch_subscriptions_state_ck')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relname='forum_watch_subscriptions_state_ck')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='forum_watch_subscriptions_state_ck')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname='forum_watch_subscriptions_state_ck') THEN
    RAISE EXCEPTION 'SQL-029 name forum_watch_subscriptions_state_ck was reused by identity storage';
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.expect_catalog_pass(label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN PERFORM pg_temp.assert_identity_catalog(); RAISE NOTICE 'PASS catalog: %', label; END $fn$;
CREATE FUNCTION pg_temp.expect_catalog_fail(label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN PERFORM pg_temp.assert_identity_catalog();
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS decoy-reject: % [%]', label, SQLSTATE; RETURN; END;
  RAISE EXCEPTION 'catalog assertion unexpectedly accepted a decoy: %', label;
END $fn$;

SELECT pg_temp.expect_catalog_pass('SQL-018..SQL-028 and SQL-075 exact catalog identities');

-- All behavioral rows exist only in this transaction.
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES
 ('10000000-0000-0000-0000-000000000001','identity-verifier-subject-1','identity-verifier-agent-1',now()),
 ('10000000-0000-0000-0000-000000000002','identity-verifier-subject-2','identity-verifier-agent-2',now());

INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
 ('20000000-0000-0000-0000-000000000001','identity verifier','verifier','verifier',now(),now());
INSERT INTO public.forum_messages (id,"threadId",seq,"authorId","authorName",content,"createdAt") VALUES
 ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',1,'verifier','verifier','probe',now());
INSERT INTO public.forum_thread_views (id,"threadId",principal_id,viewed_at) VALUES
 ('20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','legacy-verifier',now());
INSERT INTO public.forum_outcomes (id,"threadId","summaryMd","createdById","createdByName","createdAt","updatedAt") VALUES
 ('20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','probe','verifier','verifier',now(),now());
INSERT INTO public.forum_context_snapshots (id,"threadId","sourceType","sourceRef",title,"takenById","takenByName","takenAt") VALUES
 ('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','verifier','ref','probe','verifier','verifier',now());
INSERT INTO public.forum_reports (id,target_type,target_id,reporter_id,reporter_name,reason,created_at,updated_at) VALUES
 ('20000000-0000-0000-0000-000000000006','thread','20000000-0000-0000-0000-000000000001','verifier','verifier','other',now(),now());
INSERT INTO public.forum_reactions (id,message_id,thread_id,principal_id,principal_name,emoji,created_at) VALUES
 ('20000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','legacy-verifier','verifier','+',now());

-- Eight actor FKs: invalid non-NULL must be 23503; NULL must be accepted.
SELECT pg_temp.expect_error('thread creator invalid FK', $$UPDATE public.forum_threads SET creator_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000001'$$, '23503');
SELECT pg_temp.expect_success('thread creator NULL accepted', $$UPDATE public.forum_threads SET creator_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_error('message author invalid FK', $$UPDATE public.forum_messages SET author_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000002'$$, '23503');
SELECT pg_temp.expect_success('message author NULL accepted', $$UPDATE public.forum_messages SET author_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000002'$$);
SELECT pg_temp.expect_error('view viewer invalid FK', $$UPDATE public.forum_thread_views SET viewer_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000003'$$, '23503');
SELECT pg_temp.expect_success('view viewer NULL accepted', $$UPDATE public.forum_thread_views SET viewer_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000003'$$);
SELECT pg_temp.expect_error('outcome creator invalid FK', $$UPDATE public.forum_outcomes SET created_by_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000004'$$, '23503');
SELECT pg_temp.expect_success('outcome creator NULL accepted', $$UPDATE public.forum_outcomes SET created_by_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000004'$$);
SELECT pg_temp.expect_error('snapshot taker invalid FK', $$UPDATE public.forum_context_snapshots SET taken_by_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000005'$$, '23503');
SELECT pg_temp.expect_success('snapshot taker NULL accepted', $$UPDATE public.forum_context_snapshots SET taken_by_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000005'$$);
SELECT pg_temp.expect_error('report reporter invalid FK', $$UPDATE public.forum_reports SET reporter_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000006'$$, '23503');
SELECT pg_temp.expect_success('report reporter NULL accepted', $$UPDATE public.forum_reports SET reporter_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000006'$$);
SELECT pg_temp.expect_error('report handler invalid FK', $$UPDATE public.forum_reports SET handled_by_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000006'$$, '23503');
SELECT pg_temp.expect_success('report handler NULL accepted', $$UPDATE public.forum_reports SET handled_by_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000006'$$);
SELECT pg_temp.expect_error('reaction actor invalid FK', $$UPDATE public.forum_reactions SET actor_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='20000000-0000-0000-0000-000000000007'$$, '23503');
SELECT pg_temp.expect_success('reaction actor NULL accepted', $$UPDATE public.forum_reactions SET actor_principal_id=NULL WHERE id='20000000-0000-0000-0000-000000000007'$$);

-- Namespace truth table.
INSERT INTO public.forum_principal_aliases (id,principal_id,namespace,value,first_seen_at) VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','auth_subject','alias-original',TIMESTAMPTZ '2026-01-01 00:00:00+00'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','agent_id','agent-original',TIMESTAMPTZ '2026-01-01 00:00:00+00');
SELECT pg_temp.expect_error('namespace outside closed set', $q$INSERT INTO public.forum_principal_aliases VALUES ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','client_id','bad',now(),NULL,now())$q$, '23514');
SELECT pg_temp.expect_error('namespace NULL', $q$INSERT INTO public.forum_principal_aliases VALUES ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',NULL,'bad',now(),NULL,now())$q$, '23502');

-- Immutable identity fields.
SELECT pg_temp.expect_error('principal_id immutable', $$UPDATE public.forum_principal_aliases SET principal_id='10000000-0000-0000-0000-000000000002' WHERE id='30000000-0000-0000-0000-000000000001'$$, '55000');
SELECT pg_temp.expect_error('namespace immutable', $$UPDATE public.forum_principal_aliases SET namespace='agent_id' WHERE id='30000000-0000-0000-0000-000000000001'$$, '55000');
SELECT pg_temp.expect_error('value immutable', $$UPDATE public.forum_principal_aliases SET value='changed' WHERE id='30000000-0000-0000-0000-000000000001'$$, '55000');
SELECT pg_temp.expect_error('first_seen_at immutable', $$UPDATE public.forum_principal_aliases SET first_seen_at=first_seen_at+interval '1 second' WHERE id='30000000-0000-0000-0000-000000000001'$$, '55000');
SELECT pg_temp.expect_error('created_at immutable', $$UPDATE public.forum_principal_aliases SET created_at=created_at+interval '1 second' WHERE id='30000000-0000-0000-0000-000000000001'$$, '55000');

-- Retirement is one-way; idempotent same-value updates are allowed.
SELECT pg_temp.expect_success('retired_at NULL to timestamp', $$UPDATE public.forum_principal_aliases SET retired_at=TIMESTAMPTZ '2026-02-01 00:00:00+00' WHERE id='30000000-0000-0000-0000-000000000002'$$);
SELECT pg_temp.expect_success('retired_at same timestamp', $$UPDATE public.forum_principal_aliases SET retired_at=TIMESTAMPTZ '2026-02-01 00:00:00+00' WHERE id='30000000-0000-0000-0000-000000000002'$$);
SELECT pg_temp.expect_error('retired_at timestamp to NULL', $$UPDATE public.forum_principal_aliases SET retired_at=NULL WHERE id='30000000-0000-0000-0000-000000000002'$$, '55000');
SELECT pg_temp.expect_error('retired_at timestamp to different timestamp', $$UPDATE public.forum_principal_aliases SET retired_at=TIMESTAMPTZ '2026-02-02 00:00:00+00' WHERE id='30000000-0000-0000-0000-000000000002'$$, '55000');
SELECT pg_temp.expect_error('alias DELETE permanent', $$DELETE FROM public.forum_principal_aliases WHERE id='30000000-0000-0000-0000-000000000001'$$, '55000');
SELECT pg_temp.expect_error('alias TRUNCATE permanent', $$TRUNCATE public.forum_principal_aliases$$, '55000');
SELECT pg_temp.expect_error('principal TRUNCATE CASCADE reaches alias guard', $$TRUNCATE public.forum_principals CASCADE$$, '55000');

SELECT pg_temp.expect_error('same alias another principal including retired alias', $q$
 INSERT INTO public.forum_principal_aliases (id,principal_id,namespace,value,first_seen_at)
 VALUES ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','agent_id','agent-original',now())
$q$, '23505');
SELECT pg_temp.expect_error('ON CONFLICT owner update forbidden', $q$
 INSERT INTO public.forum_principal_aliases (id,principal_id,namespace,value,first_seen_at)
 VALUES ('30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002','auth_subject','alias-original',now())
 ON CONFLICT (namespace,value) DO UPDATE SET principal_id=EXCLUDED.principal_id
$q$, '55000');
SELECT pg_temp.expect_error('ON CONFLICT value update forbidden', $q$
 INSERT INTO public.forum_principal_aliases (id,principal_id,namespace,value,first_seen_at)
 VALUES ('30000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','auth_subject','alias-original',now())
 ON CONFLICT (namespace,value) DO UPDATE SET value=EXCLUDED.value || '-changed'
$q$, '55000');
SELECT pg_temp.expect_error('MERGE UPDATE forbidden', $q$
 MERGE INTO public.forum_principal_aliases a USING (VALUES ('auth_subject','alias-original')) s(namespace,value)
 ON a.namespace=s.namespace AND a.value=s.value WHEN MATCHED THEN UPDATE SET value=a.value || '-changed'
$q$, '55000');
SELECT pg_temp.expect_error('MERGE DELETE forbidden', $q$
 MERGE INTO public.forum_principal_aliases a USING (VALUES ('auth_subject','alias-original')) s(namespace,value)
 ON a.namespace=s.namespace AND a.value=s.value WHEN MATCHED THEN DELETE
$q$, '55000');
SELECT pg_temp.expect_error('delete referenced principal RESTRICT', $$DELETE FROM public.forum_principals WHERE id='10000000-0000-0000-0000-000000000001'$$, '23503');

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.forum_principal_aliases WHERE id='30000000-0000-0000-0000-000000000001';
  IF NOT FOUND OR r.principal_id<>'10000000-0000-0000-0000-000000000001' OR r.namespace<>'auth_subject'
     OR r.value<>'alias-original' OR r.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'original alias was changed or removed by a rejected operation';
  END IF;
  RAISE NOTICE 'ORIGINAL_ALIAS_REMAINS=PASS';
END $$;

-- Decoys prove schema, target relation, and function OID are indispensable.
CREATE SCHEMA identity_decoy;
CREATE TABLE identity_decoy.forum_principal_aliases (id uuid, principal_id uuid, namespace text, value text);
ALTER TABLE identity_decoy.forum_principal_aliases ADD CONSTRAINT forum_principal_aliases_namespace_ck CHECK (namespace IN ('auth_subject','agent_id'));
CREATE TABLE identity_decoy.forum_principals (id uuid PRIMARY KEY);
ALTER TABLE identity_decoy.forum_principal_aliases ADD CONSTRAINT forum_principal_aliases_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES identity_decoy.forum_principals(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION identity_decoy.forum_alias_owner_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
CREATE TRIGGER forum_alias_owner_immutable_guard_tg BEFORE UPDATE OR DELETE ON identity_decoy.forum_principal_aliases FOR EACH ROW EXECUTE FUNCTION identity_decoy.forum_alias_owner_immutable_guard();
CREATE TRIGGER forum_alias_owner_immutable_guard_truncate_tg BEFORE TRUNCATE ON identity_decoy.forum_principal_aliases FOR EACH STATEMENT EXECUTE FUNCTION identity_decoy.forum_alias_owner_immutable_guard();
SELECT pg_temp.expect_catalog_pass('wrong-schema and wrong-target decoys present');

SAVEPOINT decoy_check;
ALTER TABLE public.forum_principal_aliases RENAME CONSTRAINT forum_principal_aliases_namespace_ck TO forum_principal_aliases_namespace_ck_hidden;
SELECT pg_temp.expect_catalog_fail('wrong-schema CHECK cannot substitute');
ROLLBACK TO SAVEPOINT decoy_check;
SAVEPOINT decoy_fk;
ALTER TABLE public.forum_principal_aliases RENAME CONSTRAINT forum_principal_aliases_principal_id_fkey TO forum_principal_aliases_principal_id_fkey_hidden;
SELECT pg_temp.expect_catalog_fail('wrong-target FK cannot substitute');
ROLLBACK TO SAVEPOINT decoy_fk;
SAVEPOINT decoy_function;
ALTER FUNCTION public.forum_alias_owner_immutable_guard() RENAME TO forum_alias_owner_immutable_guard_hidden;
SELECT pg_temp.expect_catalog_fail('wrong-schema function cannot substitute');
ROLLBACK TO SAVEPOINT decoy_function;
SAVEPOINT decoy_wrong_function;
DROP TRIGGER forum_alias_owner_immutable_guard_tg ON public.forum_principal_aliases;
CREATE TRIGGER forum_alias_owner_immutable_guard_tg BEFORE UPDATE OR DELETE ON public.forum_principal_aliases FOR EACH ROW EXECUTE FUNCTION identity_decoy.forum_alias_owner_immutable_guard();
SELECT pg_temp.expect_catalog_fail('same trigger name bound to wrong function OID cannot substitute');
ROLLBACK TO SAVEPOINT decoy_wrong_function;
SAVEPOINT decoy_wrong_target;
ALTER TRIGGER forum_alias_owner_immutable_guard_truncate_tg ON public.forum_principal_aliases RENAME TO forum_alias_owner_immutable_guard_truncate_tg_hidden;
SELECT pg_temp.expect_catalog_fail('wrong-target truncate trigger cannot substitute');
ROLLBACK TO SAVEPOINT decoy_wrong_target;

DROP SCHEMA identity_decoy CASCADE;
SELECT pg_temp.expect_catalog_pass('exact catalog restored after decoys');

DO $$
BEGIN
  IF pg_catalog.to_regnamespace('identity_decoy') IS NOT NULL THEN RAISE EXCEPTION 'decoy schema residue'; END IF;
  RAISE NOTICE 'WRONG_SCHEMA_DECOYS=PASS';
  RAISE NOTICE 'WRONG_TARGET_DECOYS=PASS';
  RAISE NOTICE 'WRONG_FUNCTION_TRIGGER_DECOY=PASS';
  RAISE NOTICE 'SQL_029_ABSENT_NOT_REUSED=PASS';
END $$;

ROLLBACK;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.forum_principal_aliases;
  IF n <> 0 THEN RAISE EXCEPTION 'public.forum_principal_aliases must contain zero rows after rollback, found %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.forum_threads WHERE creator_principal_id IS NOT NULL OR visibility_state IS NOT NULL OR current_revision IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_messages WHERE author_principal_id IS NOT NULL OR discussion_revision IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_thread_views WHERE viewer_principal_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_outcomes WHERE created_by_principal_id IS NOT NULL OR authority_kind IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_context_snapshots WHERE taken_by_principal_id IS NOT NULL OR discussion_revision IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_reports WHERE reporter_principal_id IS NOT NULL OR handled_by_principal_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.forum_reactions WHERE actor_principal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'one or more of the thirteen additive columns is non-NULL after rollback';
  END IF;
  IF pg_catalog.to_regnamespace('identity_decoy') IS NOT NULL THEN RAISE EXCEPTION 'identity decoy schema survived rollback'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
      AND tgname='forum_alias_owner_immutable_guard_tg'
      AND tgfoid=pg_catalog.to_regprocedure('public.forum_alias_owner_immutable_guard()')
      AND tgtype=27 AND tgenabled='O' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'SQL-020 trigger missing or changed after rollback'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid=pg_catalog.to_regclass('public.forum_principal_aliases')
      AND tgname='forum_alias_owner_immutable_guard_truncate_tg'
      AND tgfoid=pg_catalog.to_regprocedure('public.forum_alias_owner_immutable_guard()')
      AND tgtype=34 AND tgenabled='O' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'SQL-075 trigger missing or changed after rollback'; END IF;
  RAISE NOTICE 'ALIAS_TABLE_ZERO_ROWS_AFTER=PASS';
  RAISE NOTICE 'THIRTEEN_NULLABLE_NO_DEFAULT_COLUMNS_ALL_NULL=PASS';
  RAISE NOTICE 'ALIAS_PHYSICAL_SHAPE_DEFAULTS_INDEXES_UNIQUE_FK=PASS';
  RAISE NOTICE 'SQL_018_EXACT_CHECK=PASS';
  RAISE NOTICE 'SQL_019_EXACT_FUNCTION_IDENTITY=PASS';
  RAISE NOTICE 'SQL_020_EXACT_TGTYPE_27_BITS=PASS';
  RAISE NOTICE 'SQL_075_EXACT_TGTYPE_34_BITS=PASS';
  RAISE NOTICE 'EIGHT_VALIDATED_ACTOR_FKS_RESTRICT_RESTRICT=PASS';
  RAISE NOTICE 'ALIAS_BEHAVIOR_AND_SQLSTATES=PASS';
  RAISE NOTICE 'IDENTITY_STORAGE_PHASE_2=PASS';
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
