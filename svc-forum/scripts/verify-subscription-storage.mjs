#!/usr/bin/env node

// Subscription-storage verifier. Run only against a disposable PostgreSQL database:
// normal probes roll back, while concurrency probes briefly commit isolated fixtures.
import { spawn, spawnSync } from 'node:child_process';

const databaseUrl = process.env.SUBSCRIPTION_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SUBSCRIPTION_STORAGE_DATABASE_URL (or DATABASE_URL) to a disposable PostgreSQL database; never use a source or production database.');
  process.exit(2);
}

const targetTables = [
  'forum_participations',
  'forum_watch_subscriptions',
  'forum_read_states',
  'forum_mentions',
  'forum_notification_facts',
];

const psqlArgs = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl];

function runPsql(sql, label) {
  const result = spawnSync('psql', psqlArgs, {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit status ${result.status}`);
}

const mainSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SET search_path = pg_catalog, public;

DO $$
DECLARE table_name text; n bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[${targetTables.map((name) => `'${name}'`).join(',')}]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'public.% must contain zero rows before verification, found %', table_name, n;
    END IF;
  END LOOP;
  RAISE NOTICE 'FIVE_TABLES_ZERO_ROWS_BEFORE=PASS';
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
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% unexpectedly rejected with SQLSTATE %: %', label, SQLSTATE, SQLERRM;
  END;
  RAISE NOTICE 'PASS accept: %', label;
END $fn$;

CREATE FUNCTION pg_temp.assert_table_shape(p_table text, p_expected text[])
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE actual text[]; n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace
  WHERE ns.nspname='public' AND c.relname=p_table AND c.relkind='r';
  IF n <> 1 THEN RAISE EXCEPTION 'expected one ordinary table public.%, found %', p_table, n; END IF;

  SELECT array_agg(format('%s:%s:%s:%s', a.attname,
                         pg_catalog.format_type(a.atttypid,a.atttypmod),
                         a.attnotnull,
                         coalesce(pg_catalog.pg_get_expr(ad.adbin,ad.adrelid),'<null>')) ORDER BY a.attnum)
  INTO actual
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
  WHERE a.attrelid=pg_catalog.to_regclass(format('public.%I',p_table))
    AND a.attnum>0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'physical shape mismatch for public.%: %, expected %', p_table, actual, p_expected;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_fk(p_child text, p_name text, p_child_column text, p_parent text, p_parent_column text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class child ON child.oid=c.conrelid
  JOIN pg_catalog.pg_namespace cn ON cn.oid=child.relnamespace
  JOIN pg_catalog.pg_class parent ON parent.oid=c.confrelid
  JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
  WHERE cn.nspname='public' AND child.relname=p_child
    AND pn.nspname='public' AND parent.relname=p_parent
    AND c.conname=p_name AND c.contype='f' AND c.convalidated
    AND c.confdeltype='r' AND c.confupdtype='r'
    AND cardinality(c.conkey)=1 AND cardinality(c.confkey)=1
    AND (SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=c.conkey[1])=p_child_column
    AND (SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.confrelid AND a.attnum=c.confkey[1])=p_parent_column;
  IF n <> 1 THEN
    RAISE EXCEPTION 'exact validated RESTRICT/RESTRICT FK %.% (%) -> public.%(%) missing', p_child, p_name, p_child_column, p_parent, p_parent_column;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_check(p_table text, p_name text, p_definition text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid=pg_catalog.to_regclass(format('public.%I',p_table))
    AND c.conname=p_name AND c.contype='c' AND c.convalidated
    AND regexp_replace(pg_catalog.pg_get_constraintdef(c.oid), '\s+', '', 'g')
        = regexp_replace(p_definition, '\s+', '', 'g');
  IF n <> 1 THEN RAISE EXCEPTION 'exact validated CHECK public.%.% missing', p_table, p_name; END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_index(p_table text, p_name text, p_definition text, p_unique boolean, p_primary boolean, p_partial boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
  WHERE i.indrelid=pg_catalog.to_regclass(format('public.%I',p_table))
    AND ix.relnamespace='public'::pg_catalog.regnamespace AND ix.relname=p_name
    AND i.indisunique=p_unique AND i.indisprimary=p_primary AND i.indisvalid AND i.indisready
    AND (i.indpred IS NOT NULL)=p_partial AND i.indexprs IS NULL
    AND regexp_replace(pg_catalog.pg_get_indexdef(i.indexrelid), '\s+', ' ', 'g')=p_definition;
  IF n <> 1 THEN RAISE EXCEPTION 'exact index public.% on % missing', p_name, p_table; END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_subscription_catalog()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer; body text;
BEGIN
  PERFORM pg_temp.assert_table_shape('forum_participations', ARRAY[
    'id:uuid:t:<null>','thread_id:uuid:t:<null>','principal_id:uuid:t:<null>',
    'presentation_role:text:f:<null>','presentation_status:text:f:<null>',
    'joined_at:timestamp(3) with time zone:f:<null>','left_at:timestamp(3) with time zone:f:<null>',
    'fact_state:text:t:<null>','provenance:text:t:<null>','legacy_evidence_id:uuid:f:<null>',
    'created_at:timestamp(3) with time zone:t:CURRENT_TIMESTAMP','updated_at:timestamp(3) with time zone:t:<null>'
  ]);
  PERFORM pg_temp.assert_table_shape('forum_watch_subscriptions', ARRAY[
    'id:uuid:t:<null>','thread_id:uuid:t:<null>','principal_id:uuid:t:<null>',
    'state:text:t:<null>','source:text:t:<null>','provenance:text:t:<null>',
    'started_at:timestamp(3) with time zone:f:<null>','ended_at:timestamp(3) with time zone:f:<null>',
    'legacy_evidence_id:uuid:f:<null>','created_at:timestamp(3) with time zone:t:CURRENT_TIMESTAMP',
    'updated_at:timestamp(3) with time zone:t:<null>'
  ]);
  PERFORM pg_temp.assert_table_shape('forum_read_states', ARRAY[
    'thread_id:uuid:t:<null>','principal_id:uuid:t:<null>','state:text:t:<null>',
    'last_read_seq:integer:f:<null>','last_read_at:timestamp(3) with time zone:f:<null>',
    'provenance:text:t:<null>','legacy_evidence_id:uuid:f:<null>','updated_at:timestamp(3) with time zone:t:<null>'
  ]);
  PERFORM pg_temp.assert_table_shape('forum_mentions', ARRAY[
    'id:uuid:t:<null>','message_id:uuid:t:<null>','mentioned_principal_id:uuid:t:<null>',
    'source_agent_id:text:f:<null>','created_at:timestamp(3) with time zone:t:<null>'
  ]);
  PERFORM pg_temp.assert_table_shape('forum_notification_facts', ARRAY[
    'id:uuid:t:<null>','recipient_principal_id:uuid:t:<null>','thread_id:uuid:t:<null>',
    'message_id:uuid:f:<null>','reaction_id:uuid:f:<null>','reason:text:t:<null>',
    'source_event_key:text:t:<null>','created_at:timestamp(3) with time zone:t:<null>'
  ]);

  -- Ordinary surrogate primary keys plus the four business key structures.
  PERFORM pg_temp.assert_index('forum_participations','forum_participations_pkey',
    'CREATE UNIQUE INDEX forum_participations_pkey ON public.forum_participations USING btree (id)',true,true,false);
  PERFORM pg_temp.assert_index('forum_watch_subscriptions','forum_watch_subscriptions_pkey',
    'CREATE UNIQUE INDEX forum_watch_subscriptions_pkey ON public.forum_watch_subscriptions USING btree (id)',true,true,false);
  PERFORM pg_temp.assert_index('forum_mentions','forum_mentions_pkey',
    'CREATE UNIQUE INDEX forum_mentions_pkey ON public.forum_mentions USING btree (id)',true,true,false);
  PERFORM pg_temp.assert_index('forum_notification_facts','forum_notification_facts_pkey',
    'CREATE UNIQUE INDEX forum_notification_facts_pkey ON public.forum_notification_facts USING btree (id)',true,true,false);
  PERFORM pg_temp.assert_index('forum_participations','forum_participations_thread_id_principal_id_key',
    'CREATE UNIQUE INDEX forum_participations_thread_id_principal_id_key ON public.forum_participations USING btree (thread_id, principal_id)',true,false,false);
  PERFORM pg_temp.assert_index('forum_read_states','forum_read_states_pkey',
    'CREATE UNIQUE INDEX forum_read_states_pkey ON public.forum_read_states USING btree (thread_id, principal_id)',true,true,false);
  PERFORM pg_temp.assert_index('forum_mentions','forum_mentions_message_id_mentioned_principal_id_key',
    'CREATE UNIQUE INDEX forum_mentions_message_id_mentioned_principal_id_key ON public.forum_mentions USING btree (message_id, mentioned_principal_id)',true,false,false);
  PERFORM pg_temp.assert_index('forum_notification_facts','forum_notification_facts_recipient_principal_id_source_even_key',
    'CREATE UNIQUE INDEX forum_notification_facts_recipient_principal_id_source_even_key ON public.forum_notification_facts USING btree (recipient_principal_id, source_event_key)',true,false,false);
  PERFORM pg_temp.assert_index('forum_watch_subscriptions','forum_watch_subscriptions_one_active_uq',
    $d$CREATE UNIQUE INDEX forum_watch_subscriptions_one_active_uq ON public.forum_watch_subscriptions USING btree (thread_id, principal_id) WHERE ((state = 'active'::text) AND (ended_at IS NULL))$d$,true,false,true);
  SELECT count(*) INTO n FROM pg_catalog.pg_index i
  WHERE i.indrelid='public.forum_watch_subscriptions'::regclass
    AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one Watch partial unique index, found %',n; END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_constraint c
  WHERE c.conrelid=ANY(ARRAY[
    'public.forum_participations'::regclass,'public.forum_watch_subscriptions'::regclass,
    'public.forum_read_states'::regclass,'public.forum_mentions'::regclass,
    'public.forum_notification_facts'::regclass]) AND c.contype='f';
  IF n <> 15 THEN RAISE EXCEPTION 'expected exactly 15 FKs on the five tables, found %', n; END IF;

  PERFORM pg_temp.assert_fk('forum_participations','forum_participations_thread_id_fkey','thread_id','forum_threads','id');
  PERFORM pg_temp.assert_fk('forum_participations','forum_participations_principal_id_fkey','principal_id','forum_principals','id');
  PERFORM pg_temp.assert_fk('forum_participations','forum_participations_legacy_evidence_id_fkey','legacy_evidence_id','forum_migration_legacy_evidence','id');
  PERFORM pg_temp.assert_fk('forum_watch_subscriptions','forum_watch_subscriptions_thread_id_fkey','thread_id','forum_threads','id');
  PERFORM pg_temp.assert_fk('forum_watch_subscriptions','forum_watch_subscriptions_principal_id_fkey','principal_id','forum_principals','id');
  PERFORM pg_temp.assert_fk('forum_watch_subscriptions','forum_watch_subscriptions_legacy_evidence_id_fkey','legacy_evidence_id','forum_migration_legacy_evidence','id');
  PERFORM pg_temp.assert_fk('forum_read_states','forum_read_states_thread_id_fkey','thread_id','forum_threads','id');
  PERFORM pg_temp.assert_fk('forum_read_states','forum_read_states_principal_id_fkey','principal_id','forum_principals','id');
  PERFORM pg_temp.assert_fk('forum_read_states','forum_read_states_legacy_evidence_id_fkey','legacy_evidence_id','forum_migration_legacy_evidence','id');
  PERFORM pg_temp.assert_fk('forum_mentions','forum_mentions_message_id_fkey','message_id','forum_messages','id');
  PERFORM pg_temp.assert_fk('forum_mentions','forum_mentions_mentioned_principal_id_fkey','mentioned_principal_id','forum_principals','id');
  PERFORM pg_temp.assert_fk('forum_notification_facts','forum_notification_facts_recipient_principal_id_fkey','recipient_principal_id','forum_principals','id');
  PERFORM pg_temp.assert_fk('forum_notification_facts','forum_notification_facts_thread_id_fkey','thread_id','forum_threads','id');
  PERFORM pg_temp.assert_fk('forum_notification_facts','forum_notification_facts_message_id_fkey','message_id','forum_messages','id');
  PERFORM pg_temp.assert_fk('forum_notification_facts','forum_notification_facts_reaction_id_fkey','reaction_id','forum_reactions','id');

  SELECT count(*) INTO n FROM pg_catalog.pg_constraint c
  WHERE c.conrelid=ANY(ARRAY[
    'public.forum_participations'::regclass,'public.forum_watch_subscriptions'::regclass,
    'public.forum_read_states'::regclass,'public.forum_mentions'::regclass,
    'public.forum_notification_facts'::regclass]) AND c.contype='c';
  IF n <> 9 THEN RAISE EXCEPTION 'expected exactly nine CHECKs on the five tables, found %', n; END IF;

  PERFORM pg_temp.assert_check('forum_watch_subscriptions','forum_watch_subscriptions_state_ck',
    $d$CHECK ((state = ANY (ARRAY['active'::text, 'inactive'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_watch_subscriptions','forum_watch_subscriptions_source_ck',
    $d$CHECK ((source = ANY (ARRAY['explicit'::text, 'author'::text, 'mention'::text, 'migration'::text, 'unknown'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_watch_subscriptions','forum_watch_subscriptions_provenance_ck',
    $d$CHECK ((provenance = ANY (ARRAY['runtime'::text, 'migration'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_watch_subscriptions','forum_watch_subscriptions_shape_ck',
    $d$CHECK ((((state = 'active'::text) AND (ended_at IS NULL)) OR ((state = 'inactive'::text) AND (ended_at IS NOT NULL))))$d$);
  PERFORM pg_temp.assert_check('forum_participations','forum_participations_fact_state_ck',
    $d$CHECK ((fact_state = ANY (ARRAY['known'::text, 'partial'::text, 'unknown'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_participations','forum_participations_provenance_ck',
    $d$CHECK ((provenance = ANY (ARRAY['runtime'::text, 'migration'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_read_states','forum_read_states_shape_ck',
    $d$CHECK ((((state = 'unknown'::text) AND (last_read_seq IS NULL) AND (last_read_at IS NULL)) OR ((state = 'known'::text) AND (last_read_seq = 0) AND (last_read_at IS NULL)) OR ((state = 'known'::text) AND (last_read_seq > 0) AND (last_read_at IS NOT NULL))))$d$);
  PERFORM pg_temp.assert_check('forum_read_states','forum_read_states_provenance_ck',
    $d$CHECK ((provenance = ANY (ARRAY['runtime'::text, 'migration'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_notification_facts','forum_notifications_reason_ck',
    $d$CHECK ((reason = ANY (ARRAY['mention'::text, 'watch'::text, 'reaction'::text])))$d$);

  -- SQL-038: exactly one public, no-argument PL/pgSQL trigger function with the exact body and properties.
  SELECT count(*) INTO n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname='forum_read_cursor_monotonic_guard';
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-038 expected exactly one public function name, found %', n; END IF;
  SELECT regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g') INTO body
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname='forum_read_cursor_monotonic_guard'
    AND p.prokind='f' AND pg_catalog.pg_get_function_identity_arguments(p.oid)=''
    AND pg_catalog.pg_get_function_result(p.oid)='trigger'
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND p.provolatile='v' AND NOT p.proisstrict AND NOT p.prosecdef AND p.proconfig IS NULL;
  IF body IS DISTINCT FROM regexp_replace(btrim($body$
BEGIN
  IF OLD.state = 'known' AND NEW.state = 'unknown' THEN
    RAISE EXCEPTION 'read state must not regress from known to unknown' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'known' AND NEW.state = 'known' AND NEW.last_read_seq < OLD.last_read_seq THEN
    RAISE EXCEPTION 'read cursor must not regress' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$body$), '\s+', ' ', 'g') THEN RAISE EXCEPTION 'SQL-038 exact trigger function identity/body mismatch: %', body; END IF;

  -- SQL-039: enabled, noninternal, BEFORE ROW UPDATE-only, bound to the exact SQL-038 OID.
  SELECT count(*) INTO n FROM pg_catalog.pg_trigger tg
  WHERE tg.tgrelid='public.forum_read_states'::regclass
    AND tg.tgname='forum_read_cursor_monotonic_guard_tg'
    AND tg.tgfoid='public.forum_read_cursor_monotonic_guard()'::regprocedure
    AND NOT tg.tgisinternal AND tg.tgenabled='O' AND tg.tgtype=19
    AND (tg.tgtype&1)=1 AND (tg.tgtype&2)=2 AND (tg.tgtype&16)=16
    AND (tg.tgtype&4)=0 AND (tg.tgtype&8)=0 AND (tg.tgtype&32)=0;
  IF n <> 1 THEN RAISE EXCEPTION 'SQL-039 exact enabled noninternal BEFORE ROW UPDATE-only OID binding missing'; END IF;
END $fn$;

CREATE FUNCTION pg_temp.expect_catalog_pass(label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN PERFORM pg_temp.assert_subscription_catalog(); RAISE NOTICE 'PASS catalog: %',label; END $fn$;
CREATE FUNCTION pg_temp.expect_catalog_fail(label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN PERFORM pg_temp.assert_subscription_catalog();
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS decoy-reject: % [%]',label,SQLSTATE; RETURN; END;
  RAISE EXCEPTION 'catalog assertion accepted decoy: %',label;
END $fn$;

SELECT pg_temp.expect_catalog_pass('SQL-029..SQL-040 and five exact tables');

-- Transaction-only fixtures.
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES
 ('71000000-0000-0000-0000-000000000001','subscription-verifier-subject-1','subscription-verifier-agent-1',now()),
 ('71000000-0000-0000-0000-000000000002','subscription-verifier-subject-2','subscription-verifier-agent-2',now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
 ('72000000-0000-0000-0000-000000000001','subscription verifier','verifier','verifier',now(),now());
INSERT INTO public.forum_messages (id,"threadId",seq,"authorId","authorName",content,"createdAt") VALUES
 ('73000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',1,'verifier','verifier','probe',now());
INSERT INTO public.forum_reactions (id,message_id,thread_id,principal_id,principal_name,emoji,created_at) VALUES
 ('74000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','legacy-verifier','verifier','+',now());

-- Participation closed sets, uniqueness, nullable presentation shape, and parent FKs.
INSERT INTO public.forum_participations
 (id,thread_id,principal_id,presentation_role,presentation_status,joined_at,left_at,fact_state,provenance,updated_at)
VALUES ('75000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',NULL,NULL,NULL,NULL,'unknown','migration',now());
SELECT pg_temp.expect_success('participation unknown to partial', $$UPDATE public.forum_participations SET fact_state='partial',presentation_role='observer',provenance='runtime' WHERE id='75000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_success('participation ON CONFLICT partial to known', $$INSERT INTO public.forum_participations (id,thread_id,principal_id,fact_state,provenance,updated_at) VALUES ('75000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','known','runtime',now()) ON CONFLICT (thread_id,principal_id) DO UPDATE SET fact_state=EXCLUDED.fact_state,updated_at=EXCLUDED.updated_at$$);
SELECT pg_temp.expect_error('participation fact_state outside closed set', $$UPDATE public.forum_participations SET fact_state='guessed' WHERE id='75000000-0000-0000-0000-000000000001'$$,'23514');
SELECT pg_temp.expect_error('participation provenance outside closed set', $$UPDATE public.forum_participations SET provenance='import' WHERE id='75000000-0000-0000-0000-000000000001'$$,'23514');
SELECT pg_temp.expect_error('duplicate participation business key', $$INSERT INTO public.forum_participations (id,thread_id,principal_id,fact_state,provenance,updated_at) VALUES ('75000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','known','runtime',now())$$,'23505');
SELECT pg_temp.expect_error('participation invalid thread FK', $$UPDATE public.forum_participations SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='75000000-0000-0000-0000-000000000001'$$,'23503');
SELECT pg_temp.expect_error('participation invalid principal FK', $$UPDATE public.forum_participations SET principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='75000000-0000-0000-0000-000000000001'$$,'23503');
SELECT pg_temp.expect_error('participation invalid evidence FK', $$UPDATE public.forum_participations SET legacy_evidence_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='75000000-0000-0000-0000-000000000001'$$,'23503');

-- Watch interval shape and partial active uniqueness, including ON CONFLICT transition.
INSERT INTO public.forum_watch_subscriptions
 (id,thread_id,principal_id,state,source,provenance,started_at,ended_at,updated_at)
VALUES ('76000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','active','explicit','runtime',now(),NULL,now());
SELECT pg_temp.expect_error('second active watch', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at) VALUES ('76000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','active','mention','runtime',now(),now())$$,'23505');
SELECT pg_temp.expect_success('watch ON CONFLICT active to inactive', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at) VALUES ('76000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','active','author','runtime',now(),now()) ON CONFLICT (thread_id,principal_id) WHERE state='active' AND ended_at IS NULL DO UPDATE SET state='inactive',ended_at=now(),updated_at=now()$$);
SELECT pg_temp.expect_success('new active after inactive interval', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at) VALUES ('76000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','active','unknown','migration',NULL,now())$$);
SELECT pg_temp.expect_success('multiple inactive intervals allowed', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,ended_at,updated_at) VALUES ('76000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','inactive','explicit','runtime',NULL,now(),now())$$);
SELECT pg_temp.expect_error('watch state outside closed set', $$UPDATE public.forum_watch_subscriptions SET state='paused' WHERE id='76000000-0000-0000-0000-000000000004'$$,'23514');
SELECT pg_temp.expect_error('active watch with ended_at', $$UPDATE public.forum_watch_subscriptions SET ended_at=now() WHERE id='76000000-0000-0000-0000-000000000004'$$,'23514');
SELECT pg_temp.expect_error('inactive watch without ended_at', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,updated_at) VALUES ('76000000-0000-0000-0000-000000000006','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','inactive','migration','migration',now())$$,'23514');
SELECT pg_temp.expect_error('watch source outside closed set', $$UPDATE public.forum_watch_subscriptions SET source='implicit' WHERE id='76000000-0000-0000-0000-000000000004'$$,'23514');
SELECT pg_temp.expect_error('watch provenance outside closed set', $$UPDATE public.forum_watch_subscriptions SET provenance='import' WHERE id='76000000-0000-0000-0000-000000000004'$$,'23514');
SELECT pg_temp.expect_error('watch invalid thread FK', $$UPDATE public.forum_watch_subscriptions SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='76000000-0000-0000-0000-000000000004'$$,'23503');
SELECT pg_temp.expect_error('watch invalid principal FK', $$UPDATE public.forum_watch_subscriptions SET principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='76000000-0000-0000-0000-000000000004'$$,'23503');
SELECT pg_temp.expect_error('watch invalid evidence FK', $$UPDATE public.forum_watch_subscriptions SET legacy_evidence_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='76000000-0000-0000-0000-000000000004'$$,'23503');

-- Read shapes and every frozen monotonic transition. Same cursor with an earlier timestamp is deliberately accepted.
SELECT pg_temp.expect_error('read unknown plus cursor', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','unknown',1,NULL,'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read unknown plus timestamp', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','unknown',NULL,now(),'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read known positive without timestamp', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','known',1,NULL,'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read known negative cursor', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','known',-1,now(),'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read state outside closed shape', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','other',NULL,NULL,'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read provenance outside closed set on insert', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','unknown',NULL,NULL,'import',now())$$,'23514');
INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at)
VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','unknown',NULL,NULL,'migration',now()),
       ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','unknown',NULL,NULL,'runtime',now());
SELECT pg_temp.expect_success('read unknown to unknown', $$UPDATE public.forum_read_states SET updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_success('read unknown to known zero', $$UPDATE public.forum_read_states SET state='known',last_read_seq=0,last_read_at=NULL,provenance='runtime',updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_error('read known zero to unknown', $$UPDATE public.forum_read_states SET state='unknown',last_read_seq=NULL,last_read_at=NULL,updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$,'23514');
SELECT pg_temp.expect_success('read unknown to known positive', $$UPDATE public.forum_read_states SET state='known',last_read_seq=3,last_read_at=now(),updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000002'$$);
SELECT pg_temp.expect_success('read cursor advance to five', $$UPDATE public.forum_read_states SET last_read_seq=5,last_read_at=TIMESTAMPTZ '2026-08-27 12:00:00+00',updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_success('read known same cursor', $$UPDATE public.forum_read_states SET last_read_seq=5,last_read_at=TIMESTAMPTZ '2026-08-27 12:00:00+00',updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_success('same cursor earlier timestamp accepted', $$UPDATE public.forum_read_states SET last_read_at=TIMESTAMPTZ '2026-08-26 12:00:00+00',updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_success('read known higher cursor', $$UPDATE public.forum_read_states SET last_read_seq=6,last_read_at=now(),updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_error('read cursor regression', $$UPDATE public.forum_read_states SET last_read_seq=4,last_read_at=now(),updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$,'23514');
SELECT pg_temp.expect_error('known positive to unknown direct', $$UPDATE public.forum_read_states SET state='unknown',last_read_seq=NULL,last_read_at=NULL,updated_at=now() WHERE principal_id='71000000-0000-0000-0000-000000000001'$$,'23514');
SELECT pg_temp.expect_error('known to unknown ON CONFLICT', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','unknown',NULL,NULL,'runtime',now()) ON CONFLICT (thread_id,principal_id) DO UPDATE SET state=EXCLUDED.state,last_read_seq=EXCLUDED.last_read_seq,last_read_at=EXCLUDED.last_read_at$$,'23514');
SELECT pg_temp.expect_error('known to unknown MERGE', $$MERGE INTO public.forum_read_states r USING (VALUES ('72000000-0000-0000-0000-000000000001'::uuid,'71000000-0000-0000-0000-000000000001'::uuid)) s(thread_id,principal_id) ON r.thread_id=s.thread_id AND r.principal_id=s.principal_id WHEN MATCHED THEN UPDATE SET state='unknown',last_read_seq=NULL,last_read_at=NULL$$,'23514');
SELECT pg_temp.expect_error('read invalid thread FK', $$UPDATE public.forum_read_states SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE principal_id='71000000-0000-0000-0000-000000000002'$$,'23503');
SELECT pg_temp.expect_error('read invalid principal FK', $$UPDATE public.forum_read_states SET principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE principal_id='71000000-0000-0000-0000-000000000002'$$,'23503');
SELECT pg_temp.expect_error('read invalid evidence FK', $$UPDATE public.forum_read_states SET legacy_evidence_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE principal_id='71000000-0000-0000-0000-000000000002'$$,'23503');

-- Mention and notification uniqueness, reason, and every direct parent FK.
INSERT INTO public.forum_mentions (id,message_id,mentioned_principal_id,source_agent_id,created_at)
VALUES ('77000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002',NULL,now());
SELECT pg_temp.expect_error('duplicate mention business key', $$INSERT INTO public.forum_mentions VALUES ('77000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','agent',now())$$,'23505');
SELECT pg_temp.expect_error('mention invalid message FK', $$UPDATE public.forum_mentions SET message_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='77000000-0000-0000-0000-000000000001'$$,'23503');
SELECT pg_temp.expect_error('mention invalid principal FK', $$UPDATE public.forum_mentions SET mentioned_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='77000000-0000-0000-0000-000000000001'$$,'23503');
INSERT INTO public.forum_notification_facts
 (id,recipient_principal_id,thread_id,message_id,reaction_id,reason,source_event_key,created_at)
VALUES ('78000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001',NULL,'mention','event-1',now());
SELECT pg_temp.expect_success('notification nullable message and reaction', $$INSERT INTO public.forum_notification_facts (id,recipient_principal_id,thread_id,reason,source_event_key,created_at) VALUES ('78000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','watch','event-2',now())$$);
SELECT pg_temp.expect_success('notification reaction reason and FK', $$INSERT INTO public.forum_notification_facts VALUES ('78000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',NULL,'74000000-0000-0000-0000-000000000001','reaction','event-3',now())$$);
SELECT pg_temp.expect_error('duplicate notification business key', $$INSERT INTO public.forum_notification_facts (id,recipient_principal_id,thread_id,reason,source_event_key,created_at) VALUES ('78000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','watch','event-1',now())$$,'23505');
SELECT pg_temp.expect_error('notification reason outside closed set', $$UPDATE public.forum_notification_facts SET reason='reply' WHERE id='78000000-0000-0000-0000-000000000001'$$,'23514');
SELECT pg_temp.expect_error('notification invalid recipient FK', $$UPDATE public.forum_notification_facts SET recipient_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='78000000-0000-0000-0000-000000000001'$$,'23503');
SELECT pg_temp.expect_error('notification invalid thread FK', $$UPDATE public.forum_notification_facts SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='78000000-0000-0000-0000-000000000001'$$,'23503');
SELECT pg_temp.expect_error('notification invalid message FK', $$UPDATE public.forum_notification_facts SET message_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='78000000-0000-0000-0000-000000000001'$$,'23503');
SELECT pg_temp.expect_error('notification invalid reaction FK', $$UPDATE public.forum_notification_facts SET reaction_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id='78000000-0000-0000-0000-000000000001'$$,'23503');

-- Wrong-schema, wrong-target, and wrong-function-OID decoys.
CREATE SCHEMA subscription_decoy;
CREATE TABLE subscription_decoy.forum_read_states (thread_id uuid, principal_id uuid, state text, last_read_seq integer, last_read_at timestamptz, provenance text, updated_at timestamptz);
ALTER TABLE subscription_decoy.forum_read_states ADD CONSTRAINT forum_read_states_provenance_ck CHECK (provenance IN ('runtime','migration'));
CREATE FUNCTION subscription_decoy.forum_read_cursor_monotonic_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
CREATE TRIGGER forum_read_cursor_monotonic_guard_tg BEFORE UPDATE ON subscription_decoy.forum_read_states FOR EACH ROW EXECUTE FUNCTION subscription_decoy.forum_read_cursor_monotonic_guard();
SELECT pg_temp.expect_catalog_pass('decoys coexist without satisfying public identities');
SAVEPOINT wrong_schema_check;
ALTER TABLE public.forum_read_states RENAME CONSTRAINT forum_read_states_provenance_ck TO forum_read_states_provenance_ck_hidden;
SELECT pg_temp.expect_catalog_fail('wrong-schema CHECK cannot substitute');
ROLLBACK TO SAVEPOINT wrong_schema_check;
SAVEPOINT wrong_schema_function;
ALTER FUNCTION public.forum_read_cursor_monotonic_guard() RENAME TO forum_read_cursor_monotonic_guard_hidden;
SELECT pg_temp.expect_catalog_fail('wrong-schema function cannot substitute');
ROLLBACK TO SAVEPOINT wrong_schema_function;
SAVEPOINT wrong_function_oid;
DROP TRIGGER forum_read_cursor_monotonic_guard_tg ON public.forum_read_states;
CREATE TRIGGER forum_read_cursor_monotonic_guard_tg BEFORE UPDATE ON public.forum_read_states FOR EACH ROW EXECUTE FUNCTION subscription_decoy.forum_read_cursor_monotonic_guard();
SELECT pg_temp.expect_catalog_fail('same trigger name with wrong function OID cannot substitute');
ROLLBACK TO SAVEPOINT wrong_function_oid;
SAVEPOINT wrong_target;
ALTER TRIGGER forum_read_cursor_monotonic_guard_tg ON public.forum_read_states RENAME TO forum_read_cursor_monotonic_guard_tg_hidden;
SELECT pg_temp.expect_catalog_fail('same trigger name on wrong target cannot substitute');
ROLLBACK TO SAVEPOINT wrong_target;
DROP SCHEMA subscription_decoy CASCADE;
SELECT pg_temp.expect_catalog_pass('catalog restored after decoys');

ROLLBACK;

DO $$
DECLARE table_name text; n bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[${targetTables.map((name) => `'${name}'`).join(',')}]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'public.% must contain zero rows after rollback, found %', table_name, n; END IF;
  END LOOP;
  IF pg_catalog.to_regnamespace('subscription_decoy') IS NOT NULL THEN RAISE EXCEPTION 'subscription decoy schema survived rollback'; END IF;
  RAISE NOTICE 'FIVE_EXACT_TABLE_SHAPES=PASS';
  RAISE NOTICE 'FIFTEEN_VALIDATED_FKS_RESTRICT_RESTRICT=PASS';
  RAISE NOTICE 'FOUR_BUSINESS_KEYS_AND_WATCH_PARTIAL_UNIQUE=PASS';
  RAISE NOTICE 'SQL_029_THROUGH_SQL_040_EXACT_CATALOG=PASS';
  RAISE NOTICE 'TRANSACTIONAL_BEHAVIOR_AND_SQLSTATES=PASS';
  RAISE NOTICE 'FIVE_TABLES_ZERO_ROWS_AFTER_MAIN_ROLLBACK=PASS';
END $$;
`;

const setupSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout='5s'; SET statement_timeout='60s';
BEGIN;
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES
 ('81000000-0000-0000-0000-000000000001','subscription-concurrency-subject','subscription-concurrency-agent',now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
 ('82000000-0000-0000-0000-000000000001','subscription concurrency verifier','verifier','verifier',now(),now());
INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','known',0,NULL,'runtime',now());
COMMIT;
`;

const firstSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout='5s'; SET statement_timeout='60s';
BEGIN;
INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at)
VALUES ('83000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','active','explicit','runtime',now(),now());
UPDATE public.forum_read_states SET last_read_seq=10,last_read_at=now(),updated_at=now()
WHERE thread_id='82000000-0000-0000-0000-000000000001' AND principal_id='81000000-0000-0000-0000-000000000001';
\echo CONCURRENCY_LOCKS_READY
SELECT pg_sleep(2);
COMMIT;
`;

const secondSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout='5s'; SET statement_timeout='60s';
BEGIN;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at)
    VALUES ('83000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','active','mention','runtime',now(),now());
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23505' THEN RAISE EXCEPTION 'concurrent second active returned unexpected SQLSTATE %, expected 23505: %',SQLSTATE,SQLERRM; END IF;
    RAISE NOTICE 'CONCURRENT_SECOND_ACTIVE_23505=PASS';
  END;
  BEGIN
    UPDATE public.forum_read_states SET last_read_seq=5,last_read_at=now(),updated_at=now()
    WHERE thread_id='82000000-0000-0000-0000-000000000001' AND principal_id='81000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23514' THEN RAISE EXCEPTION 'concurrent cursor 10/5 returned unexpected SQLSTATE %, expected 23514: %',SQLSTATE,SQLERRM; END IF;
    RAISE NOTICE 'CONCURRENT_CURSOR_10_5_23514=PASS';
    RETURN;
  END;
  RAISE EXCEPTION 'concurrent cursor 10/5 unexpectedly succeeded';
END $$;
ROLLBACK;
`;

const cleanupSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout='5s'; SET statement_timeout='60s';
BEGIN;
DELETE FROM public.forum_read_states
WHERE thread_id='82000000-0000-0000-0000-000000000001' AND principal_id='81000000-0000-0000-0000-000000000001';
DELETE FROM public.forum_watch_subscriptions
WHERE id IN ('83000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000002');
DELETE FROM public.forum_threads WHERE id='82000000-0000-0000-0000-000000000001';
DELETE FROM public.forum_principals WHERE id='81000000-0000-0000-0000-000000000001';
COMMIT;
DO $$ DECLARE table_name text; n bigint; BEGIN
  FOREACH table_name IN ARRAY ARRAY[${targetTables.map((name) => `'${name}'`).join(',')}] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'public.% must contain zero rows after concurrency cleanup, found %',table_name,n; END IF;
  END LOOP;
  RAISE NOTICE 'CONCURRENCY_CLEANUP_AND_FIVE_TABLES_ZERO=PASS';
  RAISE NOTICE 'SUBSCRIPTION_STORAGE=PASS';
END $$;
`;

function runConcurrentProbe() {
  return new Promise((resolve, reject) => {
    const first = spawn('psql', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let firstOut = '';
    let firstErr = '';
    let secondStarted = false;
    let secondPromise;

    const startSecond = () => {
      if (secondStarted) return;
      secondStarted = true;
      secondPromise = new Promise((resolveSecond, rejectSecond) => {
        const second = spawn('psql', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        second.stdout.on('data', (chunk) => { out += chunk; process.stdout.write(chunk); });
        second.stderr.on('data', (chunk) => { err += chunk; process.stderr.write(chunk); });
        second.on('error', rejectSecond);
        second.on('close', (code) => code === 0 ? resolveSecond() : rejectSecond(new Error(`second concurrency psql exited ${code}: ${err || out}`)));
        second.stdin.end(secondSql);
      });
    };

    first.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      firstOut += text;
      process.stdout.write(chunk);
      if (firstOut.includes('CONCURRENCY_LOCKS_READY')) startSecond();
    });
    first.stderr.on('data', (chunk) => { firstErr += chunk; process.stderr.write(chunk); });
    first.on('error', reject);
    first.on('close', async (code) => {
      try {
        if (code !== 0) throw new Error(`first concurrency psql exited ${code}: ${firstErr || firstOut}`);
        if (!secondStarted) throw new Error('first concurrency psql never reported lock readiness');
        await secondPromise;
        resolve();
      } catch (error) { reject(error); }
    });
    first.stdin.end(firstSql);
  });
}

let failure;
try {
  runPsql(mainSql, 'main subscription-storage verification');
  runPsql(setupSql, 'concurrency fixture setup');
  await runConcurrentProbe();
} catch (error) {
  failure = error;
} finally {
  try {
    runPsql(cleanupSql, 'concurrency cleanup');
  } catch (cleanupError) {
    failure = failure ? new Error(`${failure.message}; cleanup also failed: ${cleanupError.message}`) : cleanupError;
  }
}

if (failure) {
  console.error(failure.message);
  process.exit(1);
}
