#!/usr/bin/env node

// Subscription-storage verifier. Run only against a disposable PostgreSQL database:
// normal probes roll back, while concurrency probes briefly commit isolated fixtures.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.SUBSCRIPTION_STORAGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set SUBSCRIPTION_STORAGE_DATABASE_URL (or DATABASE_URL) to a disposable PostgreSQL database; never use a source or production database.');
  process.exit(2);
}

// Test-only fault: exit before any metadata output so the external coordinator
// must recover from the absence of child stdout identity instead of trusting it.
if (process.env.SUBSCRIPTION_VERIFIER_TEST_FAULT === 'pre-metadata-exit') {
  process.exit(3);
}

const targetTables = [
  'forum_participations',
  'forum_watch_subscriptions',
  'forum_read_states',
  'forum_mentions',
  'forum_notification_facts',
];

const psqlArgs = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', databaseUrl];

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function fixtureUuid(name) {
  const injected = process.env[`SUBSCRIPTION_VERIFIER_TEST_${name}`];
  const value = injected || randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`invalid test-only ${name} UUID: ${value}`);
  }
  return value;
}

// Coordinator mode identity: the external parallel-isolation coordinator
// prespawns this run's identity and passes it through explicit test-only
// environment variables. Without them the independent verifier path keeps
// generating its own random UUIDs.
const coordinatorIdentityFields = {
  RUN_ID: 'SUBSCRIPTION_VERIFIER_COORDINATOR_RUN_ID',
  PRINCIPAL_ID: 'SUBSCRIPTION_VERIFIER_COORDINATOR_PRINCIPAL_ID',
  THREAD_ID: 'SUBSCRIPTION_VERIFIER_COORDINATOR_THREAD_ID',
  FIRST_WATCH_ID: 'SUBSCRIPTION_VERIFIER_COORDINATOR_FIRST_WATCH_ID',
  SECOND_WATCH_ID: 'SUBSCRIPTION_VERIFIER_COORDINATOR_SECOND_WATCH_ID',
};

function readCoordinatorIdentity() {
  const present = Object.values(coordinatorIdentityFields).filter((name) => process.env[name] !== undefined);
  if (present.length === 0) return null;
  const missing = Object.values(coordinatorIdentityFields).filter((name) => process.env[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`coordinator identity environment variables must be set together; missing ${missing.join(', ')}`);
  }
  const values = {};
  for (const [field, envName] of Object.entries(coordinatorIdentityFields)) {
    const value = process.env[envName];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error(`invalid coordinator ${field} UUID: ${value}`);
    }
    if (process.env[`SUBSCRIPTION_VERIFIER_TEST_${field}`] !== undefined) {
      throw new Error(`both coordinator identity and test-only override provided for ${field}`);
    }
    values[field] = value;
  }
  if (new Set([values.PRINCIPAL_ID, values.THREAD_ID, values.FIRST_WATCH_ID, values.SECOND_WATCH_ID]).size !== 4) {
    throw new Error('coordinator identity fixture IDs are not distinct');
  }
  return values;
}

const coordinatorIdentity = readCoordinatorIdentity();
const fixtureRunId = coordinatorIdentity?.RUN_ID ?? randomUUID();
const ownershipMarker = `subscription-verifier:${fixtureRunId}`;
const decoySchema = `subscription_decoy_${fixtureRunId.replaceAll('-', '')}`;
const fixtureNames = [
  'PRINCIPAL_ID', 'THREAD_ID', 'FIRST_WATCH_ID', 'SECOND_WATCH_ID',
  'MAIN_PRINCIPAL_1_ID', 'MAIN_PRINCIPAL_2_ID', 'MAIN_THREAD_ID',
  'MAIN_MESSAGE_ID', 'MAIN_REACTION_ID', 'MAIN_PARTICIPATION_1_ID',
  'MAIN_PARTICIPATION_2_ID', 'MAIN_PARTICIPATION_3_ID',
  'MAIN_WATCH_1_ID', 'MAIN_WATCH_2_ID', 'MAIN_WATCH_3_ID',
  'MAIN_WATCH_4_ID', 'MAIN_WATCH_5_ID', 'MAIN_WATCH_6_ID',
  'MAIN_MENTION_1_ID', 'MAIN_MENTION_2_ID',
  'MAIN_NOTIFICATION_1_ID', 'MAIN_NOTIFICATION_2_ID',
  'MAIN_NOTIFICATION_3_ID', 'MAIN_NOTIFICATION_4_ID',
];
const fixtures = Object.fromEntries(fixtureNames.map((name) => [name, coordinatorIdentity?.[name] ?? fixtureUuid(name)]));
const principalId = fixtures.PRINCIPAL_ID;
const threadId = fixtures.THREAD_ID;
const firstWatchId = fixtures.FIRST_WATCH_ID;
const secondWatchId = fixtures.SECOND_WATCH_ID;
const q = Object.fromEntries(Object.entries({
  fixtureRunId,
  ownershipMarker,
  principalId,
  threadId,
  firstWatchId,
  secondWatchId,
  mainPrincipal1Id: fixtures.MAIN_PRINCIPAL_1_ID,
  mainPrincipal2Id: fixtures.MAIN_PRINCIPAL_2_ID,
  mainThreadId: fixtures.MAIN_THREAD_ID,
  mainMessageId: fixtures.MAIN_MESSAGE_ID,
  mainReactionId: fixtures.MAIN_REACTION_ID,
  mainParticipation1Id: fixtures.MAIN_PARTICIPATION_1_ID,
  mainParticipation2Id: fixtures.MAIN_PARTICIPATION_2_ID,
  mainParticipation3Id: fixtures.MAIN_PARTICIPATION_3_ID,
  mainWatch1Id: fixtures.MAIN_WATCH_1_ID,
  mainWatch2Id: fixtures.MAIN_WATCH_2_ID,
  mainWatch3Id: fixtures.MAIN_WATCH_3_ID,
  mainWatch4Id: fixtures.MAIN_WATCH_4_ID,
  mainWatch5Id: fixtures.MAIN_WATCH_5_ID,
  mainWatch6Id: fixtures.MAIN_WATCH_6_ID,
  mainMention1Id: fixtures.MAIN_MENTION_1_ID,
  mainMention2Id: fixtures.MAIN_MENTION_2_ID,
  mainNotification1Id: fixtures.MAIN_NOTIFICATION_1_ID,
  mainNotification2Id: fixtures.MAIN_NOTIFICATION_2_ID,
  mainNotification3Id: fixtures.MAIN_NOTIFICATION_3_ID,
  mainNotification4Id: fixtures.MAIN_NOTIFICATION_4_ID,
  mainSubject1: `${ownershipMarker}:main-subject-1`,
  mainSubject2: `${ownershipMarker}:main-subject-2`,
  mainAgent1: `${ownershipMarker}:main-agent-1`,
  mainAgent2: `${ownershipMarker}:main-agent-2`,
  mainEvent1: `${ownershipMarker}:event-1`,
  mainEvent2: `${ownershipMarker}:event-2`,
  mainEvent3: `${ownershipMarker}:event-3`,
}).map(([key, value]) => [key, sqlLiteral(value)]));

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

function captureBaseline() {
  const result = spawnSync('psql', [...psqlArgs, '--tuples-only', '--no-align'], {
    input: String.raw`
\set ON_ERROR_STOP on
SET statement_timeout='60s';
WITH baseline AS (
  SELECT 'forum_participations' AS table_name, to_jsonb(x) AS row_value
  FROM public.forum_participations x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.forum_principals p, public.forum_threads t
    WHERE p.id=x.principal_id AND t.id=x.thread_id
      AND p.auth_subject=p.agent_id AND p.auth_subject ~ '^subscription-verifier:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND t.title=t."createdById" AND t.title=p.auth_subject)
  UNION ALL
  SELECT 'forum_watch_subscriptions', to_jsonb(x)
  FROM public.forum_watch_subscriptions x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.forum_principals p, public.forum_threads t
    WHERE p.id=x.principal_id AND t.id=x.thread_id
      AND p.auth_subject=p.agent_id AND p.auth_subject ~ '^subscription-verifier:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND t.title=t."createdById" AND t.title=p.auth_subject)
  UNION ALL
  SELECT 'forum_read_states', to_jsonb(x)
  FROM public.forum_read_states x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.forum_principals p, public.forum_threads t
    WHERE p.id=x.principal_id AND t.id=x.thread_id
      AND p.auth_subject=p.agent_id AND p.auth_subject ~ '^subscription-verifier:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND t.title=t."createdById" AND t.title=p.auth_subject)
  UNION ALL SELECT 'forum_mentions', to_jsonb(x) FROM public.forum_mentions x
  UNION ALL SELECT 'forum_notification_facts', to_jsonb(x) FROM public.forum_notification_facts x
)
SELECT jsonb_build_object(
  'capture','exact',
  'rows',coalesce(jsonb_agg(jsonb_build_object('table',table_name,'row',row_value)
    ORDER BY table_name, row_value::text),'[]'::jsonb)
)::text FROM baseline;
`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`exact baseline capture: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`exact baseline capture failed with exit status ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}

const mainSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SET search_path = pg_catalog, public;

BEGIN;
-- Catalog decoy probes temporarily rename shared public objects; serialize only
-- this rollback-only main transaction. Per-run fixtures remain unique, and the
-- committed two-session concurrency probes run in parallel after this lock ends.
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('subscription-storage-main-verifier-v1', 0));

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
 (${q.mainPrincipal1Id},${q.mainSubject1},${q.mainAgent1},now()),
 (${q.mainPrincipal2Id},${q.mainSubject2},${q.mainAgent2},now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
 (${q.mainThreadId},'subscription verifier','verifier','verifier',now(),now());
INSERT INTO public.forum_messages (id,"threadId",seq,"authorId","authorName",content,"createdAt") VALUES
 (${q.mainMessageId},${q.mainThreadId},1,'verifier','verifier','probe',now());
INSERT INTO public.forum_reactions (id,message_id,thread_id,principal_id,principal_name,emoji,created_at) VALUES
 (${q.mainReactionId},${q.mainMessageId},${q.mainThreadId},'legacy-verifier','verifier','+',now());

-- Participation closed sets, uniqueness, nullable presentation shape, and parent FKs.
INSERT INTO public.forum_participations
 (id,thread_id,principal_id,presentation_role,presentation_status,joined_at,left_at,fact_state,provenance,updated_at)
VALUES (${q.mainParticipation1Id},${q.mainThreadId},${q.mainPrincipal1Id},NULL,NULL,NULL,NULL,'unknown','migration',now());
SELECT pg_temp.expect_success('participation unknown to partial', $$UPDATE public.forum_participations SET fact_state='partial',presentation_role='observer',provenance='runtime' WHERE id=${q.mainParticipation1Id}$$);
SELECT pg_temp.expect_success('participation ON CONFLICT partial to known', $$INSERT INTO public.forum_participations (id,thread_id,principal_id,fact_state,provenance,updated_at) VALUES (${q.mainParticipation2Id},${q.mainThreadId},${q.mainPrincipal1Id},'known','runtime',now()) ON CONFLICT (thread_id,principal_id) DO UPDATE SET fact_state=EXCLUDED.fact_state,updated_at=EXCLUDED.updated_at$$);
SELECT pg_temp.expect_error('participation fact_state outside closed set', $$UPDATE public.forum_participations SET fact_state='guessed' WHERE id=${q.mainParticipation1Id}$$,'23514');
SELECT pg_temp.expect_error('participation provenance outside closed set', $$UPDATE public.forum_participations SET provenance='import' WHERE id=${q.mainParticipation1Id}$$,'23514');
SELECT pg_temp.expect_error('duplicate participation business key', $$INSERT INTO public.forum_participations (id,thread_id,principal_id,fact_state,provenance,updated_at) VALUES (${q.mainParticipation3Id},${q.mainThreadId},${q.mainPrincipal1Id},'known','runtime',now())$$,'23505');
SELECT pg_temp.expect_error('participation invalid thread FK', $$UPDATE public.forum_participations SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainParticipation1Id}$$,'23503');
SELECT pg_temp.expect_error('participation invalid principal FK', $$UPDATE public.forum_participations SET principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainParticipation1Id}$$,'23503');
SELECT pg_temp.expect_error('participation invalid evidence FK', $$UPDATE public.forum_participations SET legacy_evidence_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainParticipation1Id}$$,'23503');

-- Watch interval shape and partial active uniqueness, including ON CONFLICT transition.
INSERT INTO public.forum_watch_subscriptions
 (id,thread_id,principal_id,state,source,provenance,started_at,ended_at,updated_at)
VALUES (${q.mainWatch1Id},${q.mainThreadId},${q.mainPrincipal1Id},'active','explicit','runtime',now(),NULL,now());
SELECT pg_temp.expect_error('second active watch', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at) VALUES (${q.mainWatch2Id},${q.mainThreadId},${q.mainPrincipal1Id},'active','mention','runtime',now(),now())$$,'23505');
SELECT pg_temp.expect_success('watch ON CONFLICT active to inactive', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at) VALUES (${q.mainWatch3Id},${q.mainThreadId},${q.mainPrincipal1Id},'active','author','runtime',now(),now()) ON CONFLICT (thread_id,principal_id) WHERE state='active' AND ended_at IS NULL DO UPDATE SET state='inactive',ended_at=now(),updated_at=now()$$);
SELECT pg_temp.expect_success('new active after inactive interval', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at) VALUES (${q.mainWatch4Id},${q.mainThreadId},${q.mainPrincipal1Id},'active','unknown','migration',NULL,now())$$);
SELECT pg_temp.expect_success('multiple inactive intervals allowed', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,ended_at,updated_at) VALUES (${q.mainWatch5Id},${q.mainThreadId},${q.mainPrincipal1Id},'inactive','explicit','runtime',NULL,now(),now())$$);
SELECT pg_temp.expect_error('watch state outside closed set', $$UPDATE public.forum_watch_subscriptions SET state='paused' WHERE id=${q.mainWatch4Id}$$,'23514');
SELECT pg_temp.expect_error('active watch with ended_at', $$UPDATE public.forum_watch_subscriptions SET ended_at=now() WHERE id=${q.mainWatch4Id}$$,'23514');
SELECT pg_temp.expect_error('inactive watch without ended_at', $$INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,updated_at) VALUES (${q.mainWatch6Id},${q.mainThreadId},${q.mainPrincipal2Id},'inactive','migration','migration',now())$$,'23514');
SELECT pg_temp.expect_error('watch source outside closed set', $$UPDATE public.forum_watch_subscriptions SET source='implicit' WHERE id=${q.mainWatch4Id}$$,'23514');
SELECT pg_temp.expect_error('watch provenance outside closed set', $$UPDATE public.forum_watch_subscriptions SET provenance='import' WHERE id=${q.mainWatch4Id}$$,'23514');
SELECT pg_temp.expect_error('watch invalid thread FK', $$UPDATE public.forum_watch_subscriptions SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainWatch4Id}$$,'23503');
SELECT pg_temp.expect_error('watch invalid principal FK', $$UPDATE public.forum_watch_subscriptions SET principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainWatch4Id}$$,'23503');
SELECT pg_temp.expect_error('watch invalid evidence FK', $$UPDATE public.forum_watch_subscriptions SET legacy_evidence_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainWatch4Id}$$,'23503');

-- Read shapes and every frozen monotonic transition. Same cursor with an earlier timestamp is deliberately accepted.
SELECT pg_temp.expect_error('read unknown plus cursor', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${q.mainThreadId},${q.mainPrincipal2Id},'unknown',1,NULL,'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read unknown plus timestamp', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${q.mainThreadId},${q.mainPrincipal2Id},'unknown',NULL,now(),'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read known positive without timestamp', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${q.mainThreadId},${q.mainPrincipal2Id},'known',1,NULL,'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read known negative cursor', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${q.mainThreadId},${q.mainPrincipal2Id},'known',-1,now(),'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read state outside closed shape', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${q.mainThreadId},${q.mainPrincipal2Id},'other',NULL,NULL,'runtime',now())$$,'23514');
SELECT pg_temp.expect_error('read provenance outside closed set on insert', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${q.mainThreadId},${q.mainPrincipal2Id},'unknown',NULL,NULL,'import',now())$$,'23514');
INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at)
VALUES (${q.mainThreadId},${q.mainPrincipal1Id},'unknown',NULL,NULL,'migration',now()),
       (${q.mainThreadId},${q.mainPrincipal2Id},'unknown',NULL,NULL,'runtime',now());
SELECT pg_temp.expect_success('read unknown to unknown', $$UPDATE public.forum_read_states SET updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$);
SELECT pg_temp.expect_success('read unknown to known zero', $$UPDATE public.forum_read_states SET state='known',last_read_seq=0,last_read_at=NULL,provenance='runtime',updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$);
SELECT pg_temp.expect_error('read known zero to unknown', $$UPDATE public.forum_read_states SET state='unknown',last_read_seq=NULL,last_read_at=NULL,updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$,'23514');
SELECT pg_temp.expect_success('read unknown to known positive', $$UPDATE public.forum_read_states SET state='known',last_read_seq=3,last_read_at=now(),updated_at=now() WHERE principal_id=${q.mainPrincipal2Id}$$);
SELECT pg_temp.expect_success('read cursor advance to five', $$UPDATE public.forum_read_states SET last_read_seq=5,last_read_at=TIMESTAMPTZ '2026-08-27 12:00:00+00',updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$);
SELECT pg_temp.expect_success('read known same cursor', $$UPDATE public.forum_read_states SET last_read_seq=5,last_read_at=TIMESTAMPTZ '2026-08-27 12:00:00+00',updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$);
SELECT pg_temp.expect_success('same cursor earlier timestamp accepted', $$UPDATE public.forum_read_states SET last_read_at=TIMESTAMPTZ '2026-08-26 12:00:00+00',updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$);
SELECT pg_temp.expect_success('read known higher cursor', $$UPDATE public.forum_read_states SET last_read_seq=6,last_read_at=now(),updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$);
SELECT pg_temp.expect_error('read cursor regression', $$UPDATE public.forum_read_states SET last_read_seq=4,last_read_at=now(),updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$,'23514');
SELECT pg_temp.expect_error('known positive to unknown direct', $$UPDATE public.forum_read_states SET state='unknown',last_read_seq=NULL,last_read_at=NULL,updated_at=now() WHERE principal_id=${q.mainPrincipal1Id}$$,'23514');
SELECT pg_temp.expect_error('known to unknown ON CONFLICT', $$INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES (${q.mainThreadId},${q.mainPrincipal1Id},'unknown',NULL,NULL,'runtime',now()) ON CONFLICT (thread_id,principal_id) DO UPDATE SET state=EXCLUDED.state,last_read_seq=EXCLUDED.last_read_seq,last_read_at=EXCLUDED.last_read_at$$,'23514');
SELECT pg_temp.expect_error('known to unknown MERGE', $$MERGE INTO public.forum_read_states r USING (VALUES (${q.mainThreadId}::uuid,${q.mainPrincipal1Id}::uuid)) s(thread_id,principal_id) ON r.thread_id=s.thread_id AND r.principal_id=s.principal_id WHEN MATCHED THEN UPDATE SET state='unknown',last_read_seq=NULL,last_read_at=NULL$$,'23514');
SELECT pg_temp.expect_error('read invalid thread FK', $$UPDATE public.forum_read_states SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE principal_id=${q.mainPrincipal2Id}$$,'23503');
SELECT pg_temp.expect_error('read invalid principal FK', $$UPDATE public.forum_read_states SET principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE principal_id=${q.mainPrincipal2Id}$$,'23503');
SELECT pg_temp.expect_error('read invalid evidence FK', $$UPDATE public.forum_read_states SET legacy_evidence_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE principal_id=${q.mainPrincipal2Id}$$,'23503');

-- Mention and notification uniqueness, reason, and every direct parent FK.
INSERT INTO public.forum_mentions (id,message_id,mentioned_principal_id,source_agent_id,created_at)
VALUES (${q.mainMention1Id},${q.mainMessageId},${q.mainPrincipal2Id},NULL,now());
SELECT pg_temp.expect_error('duplicate mention business key', $$INSERT INTO public.forum_mentions VALUES (${q.mainMention2Id},${q.mainMessageId},${q.mainPrincipal2Id},'agent',now())$$,'23505');
SELECT pg_temp.expect_error('mention invalid message FK', $$UPDATE public.forum_mentions SET message_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainMention1Id}$$,'23503');
SELECT pg_temp.expect_error('mention invalid principal FK', $$UPDATE public.forum_mentions SET mentioned_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainMention1Id}$$,'23503');
INSERT INTO public.forum_notification_facts
 (id,recipient_principal_id,thread_id,message_id,reaction_id,reason,source_event_key,created_at)
VALUES (${q.mainNotification1Id},${q.mainPrincipal2Id},${q.mainThreadId},${q.mainMessageId},NULL,'mention',${q.mainEvent1},now());
SELECT pg_temp.expect_success('notification nullable message and reaction', $$INSERT INTO public.forum_notification_facts (id,recipient_principal_id,thread_id,reason,source_event_key,created_at) VALUES (${q.mainNotification2Id},${q.mainPrincipal1Id},${q.mainThreadId},'watch',${q.mainEvent2},now())$$);
SELECT pg_temp.expect_success('notification reaction reason and FK', $$INSERT INTO public.forum_notification_facts VALUES (${q.mainNotification3Id},${q.mainPrincipal1Id},${q.mainThreadId},NULL,${q.mainReactionId},'reaction',${q.mainEvent3},now())$$);
SELECT pg_temp.expect_error('duplicate notification business key', $$INSERT INTO public.forum_notification_facts (id,recipient_principal_id,thread_id,reason,source_event_key,created_at) VALUES (${q.mainNotification4Id},${q.mainPrincipal2Id},${q.mainThreadId},'watch',${q.mainEvent1},now())$$,'23505');
SELECT pg_temp.expect_error('notification reason outside closed set', $$UPDATE public.forum_notification_facts SET reason='reply' WHERE id=${q.mainNotification1Id}$$,'23514');
SELECT pg_temp.expect_error('notification invalid recipient FK', $$UPDATE public.forum_notification_facts SET recipient_principal_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainNotification1Id}$$,'23503');
SELECT pg_temp.expect_error('notification invalid thread FK', $$UPDATE public.forum_notification_facts SET thread_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainNotification1Id}$$,'23503');
SELECT pg_temp.expect_error('notification invalid message FK', $$UPDATE public.forum_notification_facts SET message_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainNotification1Id}$$,'23503');
SELECT pg_temp.expect_error('notification invalid reaction FK', $$UPDATE public.forum_notification_facts SET reaction_id='ffffffff-ffff-ffff-ffff-ffffffffffff' WHERE id=${q.mainNotification1Id}$$,'23503');

-- Wrong-schema, wrong-target, and wrong-function-OID decoys.
CREATE SCHEMA ${decoySchema};
CREATE TABLE ${decoySchema}.forum_read_states (thread_id uuid, principal_id uuid, state text, last_read_seq integer, last_read_at timestamptz, provenance text, updated_at timestamptz);
ALTER TABLE ${decoySchema}.forum_read_states ADD CONSTRAINT forum_read_states_provenance_ck CHECK (provenance IN ('runtime','migration'));
CREATE FUNCTION ${decoySchema}.forum_read_cursor_monotonic_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
CREATE TRIGGER forum_read_cursor_monotonic_guard_tg BEFORE UPDATE ON ${decoySchema}.forum_read_states FOR EACH ROW EXECUTE FUNCTION ${decoySchema}.forum_read_cursor_monotonic_guard();
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
CREATE TRIGGER forum_read_cursor_monotonic_guard_tg BEFORE UPDATE ON public.forum_read_states FOR EACH ROW EXECUTE FUNCTION ${decoySchema}.forum_read_cursor_monotonic_guard();
SELECT pg_temp.expect_catalog_fail('same trigger name with wrong function OID cannot substitute');
ROLLBACK TO SAVEPOINT wrong_function_oid;
SAVEPOINT wrong_target;
ALTER TRIGGER forum_read_cursor_monotonic_guard_tg ON public.forum_read_states RENAME TO forum_read_cursor_monotonic_guard_tg_hidden;
SELECT pg_temp.expect_catalog_fail('same trigger name on wrong target cannot substitute');
ROLLBACK TO SAVEPOINT wrong_target;
DROP SCHEMA ${decoySchema} CASCADE;
SELECT pg_temp.expect_catalog_pass('catalog restored after decoys');

ROLLBACK;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.forum_participations WHERE id IN (${q.mainParticipation1Id}::uuid,${q.mainParticipation2Id}::uuid,${q.mainParticipation3Id}::uuid))
     OR EXISTS (SELECT 1 FROM public.forum_watch_subscriptions WHERE id IN (${q.mainWatch1Id}::uuid,${q.mainWatch2Id}::uuid,${q.mainWatch3Id}::uuid,${q.mainWatch4Id}::uuid,${q.mainWatch5Id}::uuid,${q.mainWatch6Id}::uuid))
     OR EXISTS (SELECT 1 FROM public.forum_read_states WHERE thread_id=${q.mainThreadId}::uuid AND principal_id IN (${q.mainPrincipal1Id}::uuid,${q.mainPrincipal2Id}::uuid))
     OR EXISTS (SELECT 1 FROM public.forum_mentions WHERE id IN (${q.mainMention1Id}::uuid,${q.mainMention2Id}::uuid))
     OR EXISTS (SELECT 1 FROM public.forum_notification_facts WHERE id IN (${q.mainNotification1Id}::uuid,${q.mainNotification2Id}::uuid,${q.mainNotification3Id}::uuid,${q.mainNotification4Id}::uuid)) THEN
    RAISE EXCEPTION 'transaction-only fixture survived main rollback';
  END IF;
  IF pg_catalog.to_regnamespace(${sqlLiteral(decoySchema)}) IS NOT NULL THEN RAISE EXCEPTION 'subscription decoy schema survived rollback'; END IF;
  RAISE NOTICE 'FIVE_EXACT_TABLE_SHAPES=PASS';
  RAISE NOTICE 'FIFTEEN_VALIDATED_FKS_RESTRICT_RESTRICT=PASS';
  RAISE NOTICE 'FOUR_BUSINESS_KEYS_AND_WATCH_PARTIAL_UNIQUE=PASS';
  RAISE NOTICE 'SQL_029_THROUGH_SQL_040_EXACT_CATALOG=PASS';
  RAISE NOTICE 'TRANSACTIONAL_BEHAVIOR_AND_SQLSTATES=PASS';
  RAISE NOTICE 'PER_RUN_MAIN_FIXTURE_CLEAN=PASS';
END $$;
`;

const faultMode = process.env.SUBSCRIPTION_VERIFIER_TEST_FAULT ?? '';
const pauseAfterSetup = process.env.SUBSCRIPTION_VERIFIER_TEST_PAUSE_AFTER_SETUP === '1';
const holdAfterSetupMs = Number.parseInt(process.env.SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS ?? '0', 10);
if (!Number.isSafeInteger(holdAfterSetupMs) || holdAfterSetupMs < 0 || holdAfterSetupMs > 30_000) {
  throw new Error(`invalid test-only HOLD_AFTER_SETUP_MS: ${process.env.SUBSCRIPTION_VERIFIER_TEST_HOLD_AFTER_SETUP_MS}`);
}

const fixtureMetadataLines = {
  FIXTURE_RUN_ID: fixtureRunId,
  FIXTURE_OWNERSHIP_MARKER: ownershipMarker,
  FIXTURE_PRINCIPAL_ID: principalId,
  FIXTURE_THREAD_ID: threadId,
  FIXTURE_FIRST_WATCH_ID: firstWatchId,
  FIXTURE_SECOND_WATCH_ID: secondWatchId,
};

// Test-only metadata fault modes: the verifier still uses its real coordinator
// identity for every database operation, but the echoed metadata is absent,
// partial, duplicated, forged, or mixed with foreign-kind prefixes so the
// coordinator must reject it and recover from its own expected identity.
if (faultMode === 'partial-metadata') {
  console.log(`FIXTURE_RUN_ID=${fixtureRunId}`);
  console.log(`FIXTURE_OWNERSHIP_MARKER=${ownershipMarker}`);
  process.exit(3);
}
if (faultMode === 'duplicate-metadata') {
  for (const [name, value] of Object.entries(fixtureMetadataLines)) console.log(`${name}=${value}`);
  console.log(`FIXTURE_RUN_ID=${fixtureRunId}`);
  process.exit(3);
}
let printedMetadataLines = fixtureMetadataLines;
if (faultMode === 'forged-metadata') {
  const foreignRunId = randomUUID();
  const forgedVariants = {
    'wrong-run-id': { ...fixtureMetadataLines, FIXTURE_RUN_ID: foreignRunId, FIXTURE_OWNERSHIP_MARKER: `subscription-verifier:${foreignRunId}` },
    'wrong-marker': { ...fixtureMetadataLines, FIXTURE_OWNERSHIP_MARKER: `subscription-verifier:${randomUUID()}` },
    'non-uuid': { ...fixtureMetadataLines, FIXTURE_PRINCIPAL_ID: 'not-a-uuid' },
    'duplicate-ids': { ...fixtureMetadataLines, FIXTURE_THREAD_ID: principalId },
    'foreign-run': {
      FIXTURE_RUN_ID: foreignRunId,
      FIXTURE_OWNERSHIP_MARKER: `subscription-verifier:${foreignRunId}`,
      FIXTURE_PRINCIPAL_ID: randomUUID(),
      FIXTURE_THREAD_ID: randomUUID(),
      FIXTURE_FIRST_WATCH_ID: randomUUID(),
      FIXTURE_SECOND_WATCH_ID: randomUUID(),
    },
  };
  const forgedVariant = process.env.SUBSCRIPTION_VERIFIER_TEST_FORGED_VARIANT ?? '';
  printedMetadataLines = forgedVariants[forgedVariant];
  if (!printedMetadataLines) throw new Error(`unknown forged metadata variant: ${forgedVariant}`);
}
for (const [name, value] of Object.entries(printedMetadataLines)) console.log(`${name}=${value}`);
if (faultMode === 'mixed-metadata') console.log(`HARNESS_RUN_ID=${randomUUID()}`);
console.log('MAIN_FIXTURE_IDENTITY=UNIQUE_PER_RUN');
const baseline = captureBaseline();
console.log('BASELINE_CAPTURE=EXACT');

const setupSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout='5s'; SET statement_timeout='60s';
BEGIN;
INSERT INTO public.forum_principals (id,auth_subject,agent_id,"updatedAt") VALUES
 (${q.principalId},${q.ownershipMarker},${q.ownershipMarker},now());
INSERT INTO public.forum_threads (id,title,"createdById","createdByName","createdAt","updatedAt") VALUES
 (${q.threadId},${q.ownershipMarker},${q.ownershipMarker},'subscription verifier',now(),now());
INSERT INTO public.forum_read_states (thread_id,principal_id,state,last_read_seq,last_read_at,provenance,updated_at) VALUES
 (${q.threadId},${q.principalId},'known',0,NULL,'runtime',now());
COMMIT;
`;

const firstFailureBeforeReady = faultMode === 'first-before-ready'
  ? `SELECT public.subscription_verifier_injected_first_before_ready_failure();`
  : '';
const firstFailureAfterReady = faultMode === 'first-after-ready'
  ? `SELECT public.subscription_verifier_injected_first_after_ready_failure();`
  : '';
const firstSleepSeconds = faultMode === 'signal-active' ? 30 : 2;
const firstSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout='5s'; SET statement_timeout='60s';
SELECT pg_catalog.set_config('application_name', 'subver:' || ${q.fixtureRunId} || ':first', false);
BEGIN;
INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at)
VALUES (${q.firstWatchId},${q.threadId},${q.principalId},'active','explicit','runtime',now(),now());
UPDATE public.forum_read_states SET last_read_seq=10,last_read_at=now(),updated_at=now()
WHERE thread_id=${q.threadId} AND principal_id=${q.principalId};
${firstFailureBeforeReady}
\echo CONCURRENCY_LOCKS_READY
${firstFailureAfterReady}
SELECT pg_sleep(${firstSleepSeconds});
COMMIT;
`;

const secondPrelude = faultMode === 'second-failure'
  ? `SELECT public.subscription_verifier_injected_second_failure();`
  : faultMode === 'statement-timeout'
    ? `SET statement_timeout='100ms'; SELECT pg_sleep(1);`
    : faultMode === 'lock-timeout'
      ? `SET lock_timeout='100ms';`
      : '';
const secondSql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout='5s'; SET statement_timeout='60s';
SELECT pg_catalog.set_config('application_name', 'subver:' || ${q.fixtureRunId} || ':second', false);
BEGIN;
${secondPrelude}
DO $$
BEGIN
  BEGIN
    INSERT INTO public.forum_watch_subscriptions (id,thread_id,principal_id,state,source,provenance,started_at,updated_at)
    VALUES (${q.secondWatchId},${q.threadId},${q.principalId},'active','mention','runtime',now(),now());
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23505' THEN RAISE EXCEPTION 'concurrent second active returned unexpected SQLSTATE %, expected 23505: %',SQLSTATE,SQLERRM; END IF;
    RAISE NOTICE 'CONCURRENT_SECOND_ACTIVE_23505=PASS';
  END;
  BEGIN
    UPDATE public.forum_read_states SET last_read_seq=5,last_read_at=now(),updated_at=now()
    WHERE thread_id=${q.threadId} AND principal_id=${q.principalId};
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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.forum_principals WHERE id=${q.principalId}::uuid
             AND (auth_subject IS DISTINCT FROM ${q.ownershipMarker} OR agent_id IS DISTINCT FROM ${q.ownershipMarker})) THEN
    RAISE EXCEPTION 'cleanup ownership mismatch for Principal %',${q.principalId} USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.forum_threads WHERE id=${q.threadId}::uuid
             AND (title IS DISTINCT FROM ${q.ownershipMarker} OR "createdById" IS DISTINCT FROM ${q.ownershipMarker})) THEN
    RAISE EXCEPTION 'cleanup ownership mismatch for Thread %',${q.threadId} USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.forum_read_states WHERE thread_id=${q.threadId}::uuid AND principal_id=${q.principalId}::uuid)
     AND NOT (
       EXISTS (SELECT 1 FROM public.forum_principals WHERE id=${q.principalId}::uuid AND auth_subject=${q.ownershipMarker} AND agent_id=${q.ownershipMarker})
       AND EXISTS (SELECT 1 FROM public.forum_threads WHERE id=${q.threadId}::uuid AND title=${q.ownershipMarker} AND "createdById"=${q.ownershipMarker})
     ) THEN
    RAISE EXCEPTION 'cleanup ownership mismatch for ReadState (%,%)',${q.threadId},${q.principalId} USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.forum_watch_subscriptions
    WHERE id IN (${q.firstWatchId}::uuid,${q.secondWatchId}::uuid)
      AND (thread_id IS DISTINCT FROM ${q.threadId}::uuid OR principal_id IS DISTINCT FROM ${q.principalId}::uuid)
  ) THEN
    RAISE EXCEPTION 'cleanup ownership mismatch for Watch fixture' USING ERRCODE='42501';
  END IF;
END $$;

DELETE FROM public.forum_read_states r
WHERE r.thread_id=${q.threadId}::uuid AND r.principal_id=${q.principalId}::uuid
  AND EXISTS (SELECT 1 FROM public.forum_principals p WHERE p.id=r.principal_id AND p.auth_subject=${q.ownershipMarker} AND p.agent_id=${q.ownershipMarker})
  AND EXISTS (SELECT 1 FROM public.forum_threads t WHERE t.id=r.thread_id AND t.title=${q.ownershipMarker} AND t."createdById"=${q.ownershipMarker});
DELETE FROM public.forum_watch_subscriptions w
WHERE w.id IN (${q.firstWatchId}::uuid,${q.secondWatchId}::uuid)
  AND w.thread_id=${q.threadId}::uuid AND w.principal_id=${q.principalId}::uuid
  AND EXISTS (SELECT 1 FROM public.forum_principals p WHERE p.id=w.principal_id AND p.auth_subject=${q.ownershipMarker} AND p.agent_id=${q.ownershipMarker})
  AND EXISTS (SELECT 1 FROM public.forum_threads t WHERE t.id=w.thread_id AND t.title=${q.ownershipMarker} AND t."createdById"=${q.ownershipMarker});
DELETE FROM public.forum_threads
WHERE id=${q.threadId}::uuid AND title=${q.ownershipMarker} AND "createdById"=${q.ownershipMarker};
DELETE FROM public.forum_principals
WHERE id=${q.principalId}::uuid AND auth_subject=${q.ownershipMarker} AND agent_id=${q.ownershipMarker};
COMMIT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.forum_principals WHERE id=${q.principalId}::uuid)
     OR EXISTS (SELECT 1 FROM public.forum_threads WHERE id=${q.threadId}::uuid)
     OR EXISTS (SELECT 1 FROM public.forum_read_states WHERE thread_id=${q.threadId}::uuid AND principal_id=${q.principalId}::uuid)
     OR EXISTS (SELECT 1 FROM public.forum_watch_subscriptions WHERE id IN (${q.firstWatchId}::uuid,${q.secondWatchId}::uuid)) THEN
    RAISE EXCEPTION 'owned fixture residue remained after cleanup';
  END IF;
  RAISE NOTICE 'CLEANUP_OWNERSHIP_VERIFIED=PASS';
  RAISE NOTICE 'PER_RUN_FIXTURE_CLEAN=PASS';
  RAISE NOTICE 'OWNED_ROWS_AFTER_CLEANUP=0';
  RAISE NOTICE 'SUBSCRIPTION_STORAGE=PASS';
END $$;
`;

function assertBaselinePreserved() {
  const after = captureBaseline();
  if (after !== baseline) throw new Error('exact non-verifier baseline changed during verifier run');
  console.log('BASELINE_PRESERVATION=PASS');
}

const activeChildren = new Set();
const activeChildClosures = new Map();
let setupAttempted = false;
let setupCommitted = false;
let cleanupInProgress = false;
let cleanupCompleted = false;
let cleanupFailure;
let cleanupAttempts = 0;
let terminating = false;

function trackChild(child) {
  activeChildren.add(child);
  const closed = new Promise((resolve) => child.once('close', resolve));
  activeChildClosures.set(child, closed);
  closed.finally(() => {
    activeChildren.delete(child);
    activeChildClosures.delete(child);
  });
  return child;
}

async function stopActiveChildren() {
  const waits = [];
  for (const child of activeChildren) {
    waits.push(activeChildClosures.get(child));
    if (!child.killed) child.kill('SIGTERM');
  }
  const settled = Promise.allSettled(waits);
  await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  for (const child of activeChildren) {
    if (!child.killed || child.exitCode === null) child.kill('SIGKILL');
  }
  await settled;
}

function terminateOwnedDatabaseSessions() {
  runPsql(String.raw`
\set ON_ERROR_STOP on
SET statement_timeout='10s';
SELECT pg_catalog.pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE pid <> pg_catalog.pg_backend_pid()
  AND application_name IN ('subver:' || ${q.fixtureRunId} || ':first', 'subver:' || ${q.fixtureRunId} || ':second');
`, 'terminate owned concurrency database sessions');
}

function cleanupOwnedFixture() {
  if (!setupAttempted || cleanupCompleted || cleanupInProgress) return;
  cleanupInProgress = true;
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      cleanupAttempts += 1;
      console.error(`CLEANUP_ATTEMPT=${cleanupAttempts}`);
      try {
        if (faultMode === 'cleanup-first-failure' && cleanupAttempts === 1) {
          throw new Error('injected first cleanup attempt failure');
        }
        runPsql(cleanupSql, 'ownership-safe concurrency cleanup');
        cleanupCompleted = true;
        cleanupFailure = undefined;
        setupAttempted = false;
        setupCommitted = false;
        return;
      } catch (error) {
        cleanupFailure = error;
        if (attempt === 2) throw error;
      }
    }
  } finally {
    cleanupInProgress = false;
  }
}

async function terminate(reason, error) {
  if (terminating) return;
  terminating = true;
  console.error(`${reason}: ${error instanceof Error ? error.message : String(error ?? reason)}`);
  await stopActiveChildren();
  try {
    terminateOwnedDatabaseSessions();
  } catch (sessionError) {
    console.error(`owned database session termination failed: ${sessionError.message}`);
  }
  try {
    cleanupOwnedFixture();
    assertBaselinePreserved();
    console.error('CATCHABLE_SIGNAL_CLEANUP=PASS');
  } catch (cleanupError) {
    console.error(`catchable termination cleanup failed: ${cleanupError.message}`);
  }
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { void terminate(signal, new Error(`received ${signal}`)); });
}
process.on('uncaughtException', (error) => { void terminate('uncaughtException', error); });
process.on('unhandledRejection', (error) => { void terminate('unhandledRejection', error); });

function runConcurrentProbe() {
  return new Promise((resolve, reject) => {
    const first = trackChild(spawn('psql', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] }));
    let firstOut = '';
    let firstErr = '';
    let secondStarted = false;
    let secondPromise;

    const startSecond = () => {
      if (secondStarted || terminating) return;
      secondStarted = true;
      console.log('SECOND_SESSION_STARTED=YES');
      secondPromise = new Promise((resolveSecond, rejectSecond) => {
        const second = trackChild(spawn('psql', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] }));
        let out = '';
        let err = '';
        second.stdout.on('data', (chunk) => { out += chunk; process.stdout.write(chunk); });
        second.stderr.on('data', (chunk) => { err += chunk; process.stderr.write(chunk); });
        second.on('error', rejectSecond);
        second.on('close', (code) => code === 0 ? resolveSecond() : rejectSecond(new Error(`second concurrency psql exited ${code}: ${err || out}`)));
        second.stdin.end(secondSql);
      });
      secondPromise.catch(() => {});
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
      let firstFailure;
      let secondFailure;
      if (code !== 0) firstFailure = new Error(`first concurrency psql exited ${code}: ${firstErr || firstOut}`);
      if (secondStarted) {
        try { await secondPromise; } catch (error) { secondFailure = error; }
      } else if (!firstFailure) {
        firstFailure = new Error('first concurrency psql never reported lock readiness');
      }
      if (firstFailure && secondFailure) {
        reject(new Error(`${firstFailure.message}; second concurrency session also failed: ${secondFailure.message}`));
      } else if (firstFailure || secondFailure) {
        reject(firstFailure || secondFailure);
      } else {
        resolve();
      }
    });
    first.stdin.end(firstSql);
  });
}

let failure;
try {
  runPsql(mainSql, 'main subscription-storage verification');
  setupAttempted = true;
  runPsql(setupSql, 'atomic concurrency fixture setup');
  if (faultMode === 'setup-postcommit-before-ack') {
    throw new Error('injected post-COMMIT pre-acknowledgement failure');
  }
  setupCommitted = true;
  console.log('SETUP_COMMITTED=YES');
  if (faultMode === 'uncaught-exception') {
    setImmediate(() => { throw new Error('injected verifier uncaught exception'); });
    await new Promise(() => {});
  }
  if (faultMode === 'unhandled-rejection') {
    setImmediate(() => { void Promise.reject(new Error('injected verifier unhandled rejection')); });
    await new Promise(() => {});
  }
  if (pauseAfterSetup) {
    console.log('TEST_PAUSE_AFTER_SETUP=READY');
    await new Promise(() => { setInterval(() => {}, 1_000); });
  }
  if (holdAfterSetupMs > 0) {
    console.log('TEST_HOLD_AFTER_SETUP=READY');
    await new Promise((resolve) => setTimeout(resolve, holdAfterSetupMs));
  }
  await runConcurrentProbe();
} catch (error) {
  failure = error;
} finally {
  if (!terminating) {
    try {
      cleanupOwnedFixture();
      assertBaselinePreserved();
    } catch (cleanupError) {
      failure = failure
        ? new Error(`${failure.message}; cleanup/baseline verification also failed: ${cleanupError.message}`)
        : cleanupError;
    }
  }
}

if (!terminating && (failure || cleanupFailure)) {
  console.error((failure || cleanupFailure).message);
  process.exit(1);
}
