#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.MIGRATION_FOUNDATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set MIGRATION_FOUNDATION_DATABASE_URL to a disposable PostgreSQL database.');
  process.exit(2);
}

const sql = String.raw`
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '60s';
SET search_path = pg_catalog, public;

DO $$
DECLARE total bigint;
BEGIN
  SELECT sum(row_count) INTO total
  FROM (
    SELECT count(*) AS row_count FROM forum_migration_runs
    UNION ALL SELECT count(*) FROM forum_migration_legacy_evidence
    UNION ALL SELECT count(*) FROM forum_migration_field_decisions
    UNION ALL SELECT count(*) FROM forum_migration_quarantines
    UNION ALL SELECT count(*) FROM forum_migration_validation_results
  ) counts;
  IF total <> 0 THEN
    RAISE EXCEPTION 'foundation tables must be empty before verification, found % rows', total;
  END IF;
END $$;

BEGIN;

CREATE FUNCTION pg_temp.expect_error(label text, command text, expected_state text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF expected_state IS NOT NULL AND SQLSTATE <> expected_state THEN
      RAISE EXCEPTION '% rejected with SQLSTATE %, expected %: %', label, SQLSTATE, expected_state, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS reject: % [%]', label, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'expected rejection but command succeeded: %', label;
END $$;

CREATE FUNCTION pg_temp.expect_success(label text, command text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE command;
  RAISE NOTICE 'PASS accept: %', label;
END $$;

-- ---------------------------------------------------------------------------
-- Exact catalog binding assertions (B-VERIFIER-001).
--
-- Every foundation object is bound by schema, target relation, object type,
-- normalized definition, function identity, and trigger event mask. None of
-- these queries depend on the caller search_path; safety is additionally
-- pinned by the session-level SET above. tgtype 27 is exactly
-- ROW(1) | BEFORE(2) | DELETE(8) | UPDATE(16): no INSERT(4), no TRUNCATE(32).
-- ---------------------------------------------------------------------------

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
    RAISE EXCEPTION 'FK exact binding failed: public.%.% (%) -> public.% (%): expected exactly one contype=f, confdeltype=r, confupdtype=r row, found %', p_child, p_conname, p_child_cols, p_parent, p_parent_cols, n;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.assert_function(p_name text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_catalog.pg_proc pr
  JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public'
    AND pr.proname = p_name
    AND pr.prokind = 'f'
    AND pg_catalog.pg_get_function_identity_arguments(pr.oid) = ''
    AND pg_catalog.pg_get_function_result(pr.oid) = 'trigger'
    AND pr.prolang = (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'plpgsql');
  IF n <> 1 THEN
    RAISE EXCEPTION 'function exact binding failed: public.%() returns trigger language plpgsql prokind f: expected exactly one row, found %', p_name, n;
  END IF;
END $fn$;

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

CREATE FUNCTION pg_temp.assert_foundation_catalog()
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.assert_check('forum_migration_runs', 'forum_migration_runs_status_ck',
    $d$CHECK ((status = ANY (ARRAY['planned'::text, 'running'::text, 'validated'::text, 'failed'::text, 'rolled_back'::text, 'sealed'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_migration_runs', 'forum_migration_runs_attempt_pos_ck',
    $d$CHECK ((attempt > 0))$d$);
  PERFORM pg_temp.assert_check('forum_migration_legacy_evidence', 'forum_migration_legacy_evidence_classification_ck',
    $d$CHECK ((classification = ANY (ARRAY['deterministic'::text, 'ambiguous'::text, 'unprovable'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_migration_field_decisions', 'forum_migration_field_decisions_classification_ck',
    $d$CHECK ((classification = ANY (ARRAY['deterministic'::text, 'ambiguous'::text, 'unprovable'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_migration_field_decisions', 'forum_migration_field_decisions_selected_ck',
    $d$CHECK (((classification = 'deterministic'::text) OR (selected_value_safe IS NULL)))$d$);
  PERFORM pg_temp.assert_check('forum_migration_quarantines', 'forum_migration_quarantines_category_ck',
    $d$CHECK ((category = ANY (ARRAY['participant_collision'::text, 'unresolved_participant'::text, 'archived_lifecycle_unknown'::text, 'other'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_migration_quarantines', 'forum_migration_quarantines_status_ck',
    $d$CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))$d$);
  PERFORM pg_temp.assert_check('forum_migration_validation_results', 'forum_migration_validation_results_result_ck',
    $d$CHECK ((result = ANY (ARRAY['pass'::text, 'fail'::text, 'inconclusive'::text])))$d$);

  PERFORM pg_temp.assert_fk('forum_migration_legacy_evidence', 'forum_migration_legacy_evidence_migration_run_id_fkey',
    'migration_run_id', 'forum_migration_runs', 'id');
  PERFORM pg_temp.assert_fk('forum_migration_legacy_evidence', 'forum_migration_legacy_evidence_candidate_principal_id_fkey',
    'candidate_principal_id', 'forum_principals', 'id');
  PERFORM pg_temp.assert_fk('forum_migration_field_decisions', 'forum_migration_field_decisions_legacy_evidence_id_fkey',
    'legacy_evidence_id', 'forum_migration_legacy_evidence', 'id');
  PERFORM pg_temp.assert_fk('forum_migration_quarantines', 'forum_migration_quarantines_legacy_evidence_id_fkey',
    'legacy_evidence_id', 'forum_migration_legacy_evidence', 'id');
  PERFORM pg_temp.assert_fk('forum_migration_quarantines', 'forum_migration_quarantines_resolved_by_principal_id_fkey',
    'resolved_by_principal_id', 'forum_principals', 'id');
  PERFORM pg_temp.assert_fk('forum_migration_validation_results', 'forum_migration_validation_results_migration_run_id_fkey',
    'migration_run_id', 'forum_migration_runs', 'id');

  PERFORM pg_temp.assert_function('forum_forbid_mutation');
  PERFORM pg_temp.assert_function('forum_migration_runs_sealed_guard');

  PERFORM pg_temp.assert_trigger('forum_migration_legacy_evidence', 'forum_migration_legacy_evidence_append_only_tg', 'forum_forbid_mutation');
  PERFORM pg_temp.assert_trigger('forum_migration_field_decisions', 'forum_migration_field_decisions_append_only_tg', 'forum_forbid_mutation');
  PERFORM pg_temp.assert_trigger('forum_migration_validation_results', 'forum_migration_validation_results_append_only_tg', 'forum_forbid_mutation');
  PERFORM pg_temp.assert_trigger('forum_migration_runs', 'forum_migration_runs_sealed_guard_tg', 'forum_migration_runs_sealed_guard');

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'public'
      AND cl.relname IN (
        'forum_migration_runs',
        'forum_migration_legacy_evidence',
        'forum_migration_field_decisions',
        'forum_migration_quarantines',
        'forum_migration_validation_results'
      )
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%185%'
  ) THEN
    RAISE EXCEPTION '185 must not be encoded in a foundation constraint';
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.expect_catalog_pass(p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.assert_foundation_catalog();
  RAISE NOTICE 'PASS catalog: %', p_label;
END $fn$;

CREATE FUNCTION pg_temp.expect_catalog_fail(p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    PERFORM pg_temp.assert_foundation_catalog();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS decoy-reject: % [%]', p_label, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'catalog assertion unexpectedly passed while the real object was unavailable: %', p_label;
END $fn$;

SELECT pg_temp.expect_catalog_pass('SQL-001..SQL-014 exact schema, table, type, definition, function, and event binding');

-- MigrationRun CHECK and uniqueness negatives.
SELECT pg_temp.expect_error('MigrationRun invalid status', $q$
  INSERT INTO forum_migration_runs VALUES
  ('00000000-0000-0000-0000-000000000001','s','ss','t','ts','test','d',now(),'p','base','k1',1,'invalid',now(),NULL,NULL,now())
$q$, '23514');
SELECT pg_temp.expect_error('MigrationRun attempt zero', $q$
  INSERT INTO forum_migration_runs VALUES
  ('00000000-0000-0000-0000-000000000002','s','ss','t','ts','test','d',now(),'p','base','k2',0,'planned',now(),NULL,NULL,now())
$q$, '23514');
SELECT pg_temp.expect_error('MigrationRun attempt negative', $q$
  INSERT INTO forum_migration_runs VALUES
  ('00000000-0000-0000-0000-000000000003','s','ss','t','ts','test','d',now(),'p','base','k3',-1,'planned',now(),NULL,NULL,now())
$q$, '23514');

INSERT INTO forum_migration_runs VALUES
('00000000-0000-0000-0000-000000000010','s','ss','t','ts','test','d',now(),'p','base','duplicate-key',1,'planned',now(),NULL,NULL,now());
SELECT pg_temp.expect_error('MigrationRun duplicate identity attempt', $q$
  INSERT INTO forum_migration_runs VALUES
  ('00000000-0000-0000-0000-000000000011','s','ss','t','ts','test','d',now(),'p','base','duplicate-key',1,'planned',now(),NULL,NULL,now())
$q$, '23505');

-- Every legal transition.
INSERT INTO forum_migration_runs VALUES
('00000000-0000-0000-0000-000000000020','s','ss','t','ts','test','d',now(),'p','base','legal-1',1,'planned',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000021','s','ss','t','ts','test','d',now(),'p','base','legal-2',1,'planned',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000022','s','ss','t','ts','test','d',now(),'p','base','legal-3',1,'running',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000023','s','ss','t','ts','test','d',now(),'p','base','legal-4',1,'running',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000024','s','ss','t','ts','test','d',now(),'p','base','legal-5',1,'validated',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000025','s','ss','t','ts','test','d',now(),'p','base','legal-6',1,'validated',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000026','s','ss','t','ts','test','d',now(),'p','base','legal-7',1,'validated',now(),NULL,NULL,now());
UPDATE forum_migration_runs SET status='running' WHERE id='00000000-0000-0000-0000-000000000020';
UPDATE forum_migration_runs SET status='failed' WHERE id='00000000-0000-0000-0000-000000000021';
UPDATE forum_migration_runs SET status='validated' WHERE id='00000000-0000-0000-0000-000000000022';
UPDATE forum_migration_runs SET status='failed' WHERE id='00000000-0000-0000-0000-000000000023';
UPDATE forum_migration_runs SET status='sealed' WHERE id='00000000-0000-0000-0000-000000000024';
UPDATE forum_migration_runs SET status='rolled_back' WHERE id='00000000-0000-0000-0000-000000000025';
UPDATE forum_migration_runs SET status='failed' WHERE id='00000000-0000-0000-0000-000000000026';

-- Illegal and terminal transitions.
INSERT INTO forum_migration_runs VALUES
('00000000-0000-0000-0000-000000000030','s','ss','t','ts','test','d',now(),'p','base','illegal-1',1,'planned',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000031','s','ss','t','ts','test','d',now(),'p','base','illegal-2',1,'planned',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000032','s','ss','t','ts','test','d',now(),'p','base','illegal-3',1,'running',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000033','s','ss','t','ts','test','d',now(),'p','base','illegal-4',1,'validated',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000034','s','ss','t','ts','test','d',now(),'p','base','illegal-5',1,'sealed',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000035','s','ss','t','ts','test','d',now(),'p','base','illegal-6',1,'failed',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000036','s','ss','t','ts','test','d',now(),'p','base','illegal-7',1,'rolled_back',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000037','s','ss','t','ts','test','d',now(),'p','base','identity',1,'planned',now(),NULL,NULL,now());
SELECT pg_temp.expect_error('planned to validated', $$UPDATE forum_migration_runs SET status='validated' WHERE id='00000000-0000-0000-0000-000000000030'$$, '23514');
SELECT pg_temp.expect_error('planned to sealed', $$UPDATE forum_migration_runs SET status='sealed' WHERE id='00000000-0000-0000-0000-000000000031'$$, '23514');
SELECT pg_temp.expect_error('running to planned', $$UPDATE forum_migration_runs SET status='planned' WHERE id='00000000-0000-0000-0000-000000000032'$$, '23514');
SELECT pg_temp.expect_error('validated to running', $$UPDATE forum_migration_runs SET status='running' WHERE id='00000000-0000-0000-0000-000000000033'$$, '23514');
SELECT pg_temp.expect_error('sealed terminal update', $$UPDATE forum_migration_runs SET status='running' WHERE id='00000000-0000-0000-0000-000000000034'$$, '55000');
SELECT pg_temp.expect_error('failed terminal update', $$UPDATE forum_migration_runs SET status='running' WHERE id='00000000-0000-0000-0000-000000000035'$$, '55000');
SELECT pg_temp.expect_error('rolled_back terminal update', $$UPDATE forum_migration_runs SET status='running' WHERE id='00000000-0000-0000-0000-000000000036'$$, '55000');
SELECT pg_temp.expect_error('id update', $$UPDATE forum_migration_runs SET status='running', id='00000000-0000-0000-0000-000000000038' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('source_commit update', $$UPDATE forum_migration_runs SET status='running', source_commit='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('source_schema_revision update', $$UPDATE forum_migration_runs SET status='running', source_schema_revision='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('target_commit update', $$UPDATE forum_migration_runs SET status='running', target_commit='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('target_schema_revision update', $$UPDATE forum_migration_runs SET status='running', target_schema_revision='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('environment update', $$UPDATE forum_migration_runs SET status='running', environment='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('dataset_id update', $$UPDATE forum_migration_runs SET status='running', dataset_id='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('snapshot_at update', $$UPDATE forum_migration_runs SET status='running', snapshot_at=snapshot_at + interval '1 second' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('policy_id update', $$UPDATE forum_migration_runs SET status='running', policy_id='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('phase update', $$UPDATE forum_migration_runs SET status='running', phase='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('run_identity_key update', $$UPDATE forum_migration_runs SET status='running', run_identity_key='changed' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('attempt update', $$UPDATE forum_migration_runs SET status='running', attempt=2 WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('started_at update', $$UPDATE forum_migration_runs SET status='running', started_at=started_at + interval '1 second' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('created_at update', $$UPDATE forum_migration_runs SET status='running', created_at=created_at + interval '1 second' WHERE id='00000000-0000-0000-0000-000000000037'$$, '55000');
SELECT pg_temp.expect_error('sealed terminal run delete', $$DELETE FROM forum_migration_runs WHERE id='00000000-0000-0000-0000-000000000034'$$, '55000');
SELECT pg_temp.expect_error('failed terminal run delete', $$DELETE FROM forum_migration_runs WHERE id='00000000-0000-0000-0000-000000000035'$$, '55000');
SELECT pg_temp.expect_error('rolled_back terminal run delete', $$DELETE FROM forum_migration_runs WHERE id='00000000-0000-0000-0000-000000000036'$$, '55000');

-- Adopted DELETE advisory: nonterminal DELETE returns NEW(NULL), suppressing deletion.
INSERT INTO forum_migration_runs VALUES
('00000000-0000-0000-0000-000000000040','s','ss','t','ts','test','d',now(),'p','base','delete-planned',1,'planned',now(),NULL,NULL,now()),
('00000000-0000-0000-0000-000000000041','s','ss','t','ts','test','d',now(),'p','base','delete-running',1,'running',now(),NULL,NULL,now());
DO $$
DECLARE affected integer;
BEGIN
  DELETE FROM forum_migration_runs WHERE id='00000000-0000-0000-0000-000000000040';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 OR NOT EXISTS (SELECT 1 FROM forum_migration_runs WHERE id='00000000-0000-0000-0000-000000000040') THEN
    RAISE EXCEPTION 'unexpected planned run delete behavior';
  END IF;
  RAISE NOTICE 'PLANNED_RUN_DELETE_BEHAVIOR=SILENTLY_SUPPRESSED';

  DELETE FROM forum_migration_runs WHERE id='00000000-0000-0000-0000-000000000041';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 OR NOT EXISTS (SELECT 1 FROM forum_migration_runs WHERE id='00000000-0000-0000-0000-000000000041') THEN
    RAISE EXCEPTION 'unexpected running run delete behavior';
  END IF;
  RAISE NOTICE 'RUNNING_RUN_DELETE_BEHAVIOR=SILENTLY_SUPPRESSED';
  RAISE NOTICE 'TERMINAL_RUN_DELETE_BEHAVIOR=REJECTED';
END $$;

-- Shared valid parent rows.
INSERT INTO forum_principals (id,auth_subject,"updatedAt") VALUES
('10000000-0000-0000-0000-000000000001','foundation-test-subject',now());
INSERT INTO forum_migration_runs VALUES
('20000000-0000-0000-0000-000000000001','s','ss','t','ts','test','d',now(),'p','base','evidence-parent',1,'running',now(),NULL,NULL,now());

-- LegacyEvidence classification, unique key, FK, and append-only behavior.
SELECT pg_temp.expect_error('LegacyEvidence invalid classification', $q$
  INSERT INTO forum_migration_legacy_evidence VALUES
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','forum_participants','bad-class',decode('00','hex'),NULL,NULL,'invalid','{}',now())
$q$, '23514');
INSERT INTO forum_migration_legacy_evidence VALUES
('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','forum_participants','row-1',decode('01','hex'),NULL,'10000000-0000-0000-0000-000000000001','deterministic','{}',now());
SELECT pg_temp.expect_error('LegacyEvidence duplicate source reference', $q$
  INSERT INTO forum_migration_legacy_evidence VALUES
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','forum_participants','row-1',decode('02','hex'),NULL,NULL,'ambiguous','{}',now())
$q$, '23505');
SELECT pg_temp.expect_error('LegacyEvidence update append-only', $$UPDATE forum_migration_legacy_evidence SET source_table='changed' WHERE id='30000000-0000-0000-0000-000000000002'$$, '55000');
SELECT pg_temp.expect_error('LegacyEvidence delete append-only', $$DELETE FROM forum_migration_legacy_evidence WHERE id='30000000-0000-0000-0000-000000000002'$$, '55000');

-- FieldDecision classification and complete six-cell selected-value truth table.
SELECT pg_temp.expect_error('FieldDecision invalid classification', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','invalid-class','invalid','[]',NULL,'r','p',now())
$q$, '23514');
SELECT pg_temp.expect_success('deterministic + NULL', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','det-null','deterministic','[]',NULL,'r','p',now())
$q$);
SELECT pg_temp.expect_success('deterministic + non-NULL', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','det-value','deterministic','[]','1','r','p',now())
$q$);
SELECT pg_temp.expect_success('ambiguous + NULL', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000002','amb-null','ambiguous','[]',NULL,'r','p',now())
$q$);
SELECT pg_temp.expect_error('ambiguous + non-NULL', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000002','amb-value','ambiguous','[]','1','r','p',now())
$q$, '23514');
SELECT pg_temp.expect_success('unprovable + NULL', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000002','unp-null','unprovable','[]',NULL,'r','p',now())
$q$);
SELECT pg_temp.expect_error('unprovable + non-NULL', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000002','unp-value','unprovable','[]','1','r','p',now())
$q$, '23514');
SELECT pg_temp.expect_error('FieldDecision duplicate evidence field', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('40000000-0000-0000-0000-000000000008','30000000-0000-0000-0000-000000000002','det-null','deterministic','[]',NULL,'r','p',now())
$q$, '23505');
SELECT pg_temp.expect_error('FieldDecision update append-only', $$UPDATE forum_migration_field_decisions SET reason_code='changed' WHERE id='40000000-0000-0000-0000-000000000002'$$, '55000');
SELECT pg_temp.expect_error('FieldDecision delete append-only', $$DELETE FROM forum_migration_field_decisions WHERE id='40000000-0000-0000-0000-000000000002'$$, '55000');

-- Quarantine category/status, one-per-evidence, and no hard-coded local count.
SELECT pg_temp.expect_error('Quarantine invalid category', $q$
  INSERT INTO forum_migration_quarantines VALUES
  ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','invalid','blocked','open','r','need',now(),NULL,NULL)
$q$, '23514');
SELECT pg_temp.expect_error('Quarantine invalid status', $q$
  INSERT INTO forum_migration_quarantines VALUES
  ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','other','blocked','invalid','r','need',now(),NULL,NULL)
$q$, '23514');
INSERT INTO forum_migration_quarantines VALUES
('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','participant_collision','blocked','open','r','need',now(),NULL,NULL);
SELECT pg_temp.expect_error('Quarantine duplicate legacy evidence', $q$
  INSERT INTO forum_migration_quarantines VALUES
  ('50000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000002','other','blocked','open','r','need',now(),NULL,NULL)
$q$, '23505');

-- ValidationResult closed set, unique key, FK, and append-only behavior.
INSERT INTO forum_migration_validation_results VALUES
('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','check-1','CTR-MIG-004',true,'{}','{}','pass','evidence',now());
SELECT pg_temp.expect_error('ValidationResult invalid result', $q$
  INSERT INTO forum_migration_validation_results VALUES
  ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','bad-result',NULL,true,'{}','{}','invalid','evidence',now())
$q$, '23514');
SELECT pg_temp.expect_error('ValidationResult duplicate run check', $q$
  INSERT INTO forum_migration_validation_results VALUES
  ('60000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','check-1',NULL,true,'{}','{}','pass','evidence',now())
$q$, '23505');
SELECT pg_temp.expect_error('ValidationResult update append-only', $$UPDATE forum_migration_validation_results SET result='fail' WHERE id='60000000-0000-0000-0000-000000000001'$$, '55000');
SELECT pg_temp.expect_error('ValidationResult delete append-only', $$DELETE FROM forum_migration_validation_results WHERE id='60000000-0000-0000-0000-000000000001'$$, '55000');

-- Every required FK rejects an invalid child; catalog confirms RESTRICT action.
SELECT pg_temp.expect_error('LegacyEvidence migrationRun FK', $q$
  INSERT INTO forum_migration_legacy_evidence VALUES
  ('70000000-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001','x','x',decode('00','hex'),NULL,NULL,'deterministic','{}',now())
$q$, '23503');
SELECT pg_temp.expect_error('LegacyEvidence candidatePrincipal FK', $q$
  INSERT INTO forum_migration_legacy_evidence VALUES
  ('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','x','bad-principal',decode('00','hex'),NULL,'ffffffff-0000-0000-0000-000000000002','deterministic','{}',now())
$q$, '23503');
SELECT pg_temp.expect_error('FieldDecision legacyEvidence FK', $q$
  INSERT INTO forum_migration_field_decisions VALUES
  ('70000000-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-000000000003','x','deterministic','[]',NULL,'r','p',now())
$q$, '23503');
SELECT pg_temp.expect_error('Quarantine legacyEvidence FK', $q$
  INSERT INTO forum_migration_quarantines VALUES
  ('70000000-0000-0000-0000-000000000004','ffffffff-0000-0000-0000-000000000004','other','blocked','open','r','need',now(),NULL,NULL)
$q$, '23503');
INSERT INTO forum_migration_legacy_evidence VALUES
('70000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','x','resolver-fk',decode('00','hex'),NULL,NULL,'deterministic','{}',now());
SELECT pg_temp.expect_error('Quarantine resolvedByPrincipal FK', $q$
  INSERT INTO forum_migration_quarantines VALUES
  ('70000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000005','other','blocked','resolved','r','need',now(),now(),'ffffffff-0000-0000-0000-000000000006')
$q$, '23503');
SELECT pg_temp.expect_error('ValidationResult migrationRun FK', $q$
  INSERT INTO forum_migration_validation_results VALUES
  ('70000000-0000-0000-0000-000000000007','ffffffff-0000-0000-0000-000000000007','x',NULL,true,'{}','{}','pass','evidence',now())
$q$, '23503');
SELECT pg_temp.expect_error('Principal delete RESTRICT', $$DELETE FROM forum_principals WHERE id='10000000-0000-0000-0000-000000000001'$$, '23503');

-- ---------------------------------------------------------------------------
-- Six FK parent-ID mutation tests (B-FK-001).
--
-- Each test creates a fresh parent referenced only through the target FK by
-- one fresh child row, mutates the parent primary key, and requires
-- SQLSTATE 23503 from the ON UPDATE RESTRICT action itself. Where the parent
-- table has its own user-defined mutation trigger (sealed guard, append-only
-- guard), only that named user trigger is disabled for the duration of the
-- single UPDATE and re-enabled immediately afterwards; internal FK triggers
-- are asserted to remain enabled. No global bypass is used.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.fk_update_restrict_test(
  p_label text,
  p_parent regclass,
  p_parent_id uuid,
  p_new_parent_id uuid,
  p_child regclass,
  p_child_id uuid,
  p_child_fk_col text,
  p_disable_trigger text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_state text := NULL;
  v_value text;
BEGIN
  IF p_disable_trigger IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = p_parent AND tgname = p_disable_trigger AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION '%: user trigger % not found on %', p_label, p_disable_trigger, p_parent;
    END IF;
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', p_parent, p_disable_trigger);
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = p_parent AND tgisinternal AND tgenabled <> 'O'
    ) THEN
      RAISE EXCEPTION '%: internal FK triggers must never be disabled', p_label;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = p_parent AND tgname = p_disable_trigger AND tgenabled = 'D'
    ) THEN
      RAISE EXCEPTION '%: expected only trigger % to be disabled on %', p_label, p_disable_trigger, p_parent;
    END IF;
  END IF;

  BEGIN
    EXECUTE format('UPDATE %s SET id = %L WHERE id = %L', p_parent, p_new_parent_id, p_parent_id);
  EXCEPTION
    WHEN foreign_key_violation THEN
      v_state := SQLSTATE;
    WHEN OTHERS THEN
      RAISE EXCEPTION '% rejected with SQLSTATE %, expected 23503: %', p_label, SQLSTATE, SQLERRM;
  END;

  IF p_disable_trigger IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', p_parent, p_disable_trigger);
  END IF;

  IF v_state IS DISTINCT FROM '23503' THEN
    RAISE EXCEPTION '%: parent id update did not fail with SQLSTATE 23503', p_label;
  END IF;

  EXECUTE format('SELECT id::text FROM %s WHERE id = %L', p_parent, p_parent_id) INTO v_value;
  IF v_value IS DISTINCT FROM p_parent_id::text THEN
    RAISE EXCEPTION '%: parent id was mutated to %', p_label, v_value;
  END IF;

  EXECUTE format('SELECT %I::text FROM %s WHERE id = %L', p_child_fk_col, p_child, p_child_id) INTO v_value;
  IF v_value IS DISTINCT FROM p_parent_id::text THEN
    RAISE EXCEPTION '%: child FK value was mutated to %', p_label, v_value;
  END IF;

  RAISE NOTICE 'PASS fk-update-restrict: % [23503; parent and child values unchanged]', p_label;
END $fn$;

-- TEST_FK_UPDATE_01
INSERT INTO forum_migration_runs VALUES
('81000000-0000-0000-0000-000000000001','s','ss','t','ts','test','d',now(),'p','base','fk-update-01',1,'planned',now(),NULL,NULL,now());
INSERT INTO forum_migration_legacy_evidence VALUES
('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','forum_participants','fk-update-01',decode('00','hex'),NULL,NULL,'deterministic','{}',now());
SELECT pg_temp.fk_update_restrict_test(
  'TEST_FK_UPDATE_01 forum_migration_runs.id <- forum_migration_legacy_evidence.migration_run_id',
  'public.forum_migration_runs', '81000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001',
  'public.forum_migration_legacy_evidence', '82000000-0000-0000-0000-000000000001', 'migration_run_id',
  'forum_migration_runs_sealed_guard_tg');

-- TEST_FK_UPDATE_02
INSERT INTO forum_principals (id,auth_subject,"updatedAt") VALUES
('81000000-0000-0000-0000-000000000002','fk-update-02-subject',now());
INSERT INTO forum_migration_legacy_evidence VALUES
('82000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','forum_participants','fk-update-02',decode('00','hex'),NULL,'81000000-0000-0000-0000-000000000002','deterministic','{}',now());
SELECT pg_temp.fk_update_restrict_test(
  'TEST_FK_UPDATE_02 forum_principals.id <- forum_migration_legacy_evidence.candidate_principal_id',
  'public.forum_principals', '81000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000002',
  'public.forum_migration_legacy_evidence', '82000000-0000-0000-0000-000000000002', 'candidate_principal_id',
  NULL);

-- TEST_FK_UPDATE_03
INSERT INTO forum_migration_legacy_evidence VALUES
('81000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','forum_participants','fk-update-03',decode('00','hex'),NULL,NULL,'deterministic','{}',now());
INSERT INTO forum_migration_field_decisions VALUES
('82000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000003','fk-update-03','deterministic','[]',NULL,'r','p',now());
SELECT pg_temp.fk_update_restrict_test(
  'TEST_FK_UPDATE_03 forum_migration_legacy_evidence.id <- forum_migration_field_decisions.legacy_evidence_id',
  'public.forum_migration_legacy_evidence', '81000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000003',
  'public.forum_migration_field_decisions', '82000000-0000-0000-0000-000000000003', 'legacy_evidence_id',
  'forum_migration_legacy_evidence_append_only_tg');

-- TEST_FK_UPDATE_04
INSERT INTO forum_migration_legacy_evidence VALUES
('81000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','forum_participants','fk-update-04',decode('00','hex'),NULL,NULL,'deterministic','{}',now());
INSERT INTO forum_migration_quarantines VALUES
('82000000-0000-0000-0000-000000000004','81000000-0000-0000-0000-000000000004','other','blocked','open','r','need',now(),NULL,NULL);
SELECT pg_temp.fk_update_restrict_test(
  'TEST_FK_UPDATE_04 forum_migration_legacy_evidence.id <- forum_migration_quarantines.legacy_evidence_id',
  'public.forum_migration_legacy_evidence', '81000000-0000-0000-0000-000000000004', '83000000-0000-0000-0000-000000000004',
  'public.forum_migration_quarantines', '82000000-0000-0000-0000-000000000004', 'legacy_evidence_id',
  'forum_migration_legacy_evidence_append_only_tg');

-- TEST_FK_UPDATE_05
INSERT INTO forum_principals (id,auth_subject,"updatedAt") VALUES
('81000000-0000-0000-0000-000000000005','fk-update-05-subject',now());
INSERT INTO forum_migration_quarantines VALUES
('82000000-0000-0000-0000-000000000005','81000000-0000-0000-0000-000000000003','other','blocked','resolved','r','need',now(),now(),'81000000-0000-0000-0000-000000000005');
SELECT pg_temp.fk_update_restrict_test(
  'TEST_FK_UPDATE_05 forum_principals.id <- forum_migration_quarantines.resolved_by_principal_id',
  'public.forum_principals', '81000000-0000-0000-0000-000000000005', '83000000-0000-0000-0000-000000000005',
  'public.forum_migration_quarantines', '82000000-0000-0000-0000-000000000005', 'resolved_by_principal_id',
  NULL);

-- TEST_FK_UPDATE_06
INSERT INTO forum_migration_runs VALUES
('81000000-0000-0000-0000-000000000006','s','ss','t','ts','test','d',now(),'p','base','fk-update-06',1,'planned',now(),NULL,NULL,now());
INSERT INTO forum_migration_validation_results VALUES
('82000000-0000-0000-0000-000000000006','81000000-0000-0000-0000-000000000006','fk-update-06',NULL,true,'{}','{}','pass','evidence',now());
SELECT pg_temp.fk_update_restrict_test(
  'TEST_FK_UPDATE_06 forum_migration_runs.id <- forum_migration_validation_results.migration_run_id',
  'public.forum_migration_runs', '81000000-0000-0000-0000-000000000006', '83000000-0000-0000-0000-000000000006',
  'public.forum_migration_validation_results', '82000000-0000-0000-0000-000000000006', 'migration_run_id',
  'forum_migration_runs_sealed_guard_tg');

DO $$
BEGIN
  RAISE NOTICE 'SIX_FK_PARENT_ID_MUTATION_TESTS=PASS';
  RAISE NOTICE 'SIX_FK_UPDATE_SQLSTATE=23503';
  RAISE NOTICE 'PARENT_CHILD_VALUES_UNCHANGED=PASS';
END $$;

-- ---------------------------------------------------------------------------
-- Decoy resistance tests (B-VERIFIER-001).
--
-- Same-named objects are planted in a wrong schema (af_decoy), on wrong
-- target tables, and a trigger is rebound to a wrong function. With decoys
-- present the exact assertion still identifies the real objects; with each
-- real object temporarily renamed, removed, or misbound inside a SAVEPOINT,
-- the assertion must fail even though the decoy remains; rollback restores
-- the real structure and the assertion passes again.
-- ---------------------------------------------------------------------------

CREATE SCHEMA af_decoy;
CREATE TABLE af_decoy.decoy_parent (id uuid PRIMARY KEY);
CREATE TABLE af_decoy.decoy_child (id uuid PRIMARY KEY, ref uuid);
CREATE TABLE af_decoy.forum_migration_runs (id uuid PRIMARY KEY, status text, attempt integer);

-- DECOY_01: same-name CHECK in a wrong schema with a different definition.
ALTER TABLE af_decoy.forum_migration_runs
  ADD CONSTRAINT forum_migration_runs_status_ck CHECK (status IN ('planned'));

-- DECOY_02: same-name FK between wrong tables in a wrong schema.
ALTER TABLE af_decoy.decoy_child
  ADD CONSTRAINT forum_migration_legacy_evidence_migration_run_id_fkey
  FOREIGN KEY (ref) REFERENCES af_decoy.decoy_parent (id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- DECOY_03: same-name function in a wrong schema.
CREATE FUNCTION af_decoy.forum_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $d$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $d$;

-- DECOY_04: same-name trigger on a wrong table in a wrong schema.
CREATE TRIGGER forum_migration_legacy_evidence_append_only_tg
BEFORE UPDATE OR DELETE ON af_decoy.decoy_child
FOR EACH ROW EXECUTE FUNCTION af_decoy.forum_forbid_mutation();

SELECT pg_temp.expect_catalog_pass('decoy objects present; real objects still exactly identified');

-- DECOY_01 proof: real CHECK renamed away; wrong-schema decoy must not substitute.
SAVEPOINT decoy_01;
ALTER TABLE public.forum_migration_runs
  RENAME CONSTRAINT forum_migration_runs_status_ck TO forum_migration_runs_status_ck_real_hidden;
SELECT pg_temp.expect_catalog_fail('DECOY_01 wrong-schema same-name CHECK cannot substitute for the real constraint');
ROLLBACK TO SAVEPOINT decoy_01;

-- DECOY_02 proof: real FK renamed away; wrong-target decoy must not substitute.
SAVEPOINT decoy_02;
ALTER TABLE public.forum_migration_legacy_evidence
  RENAME CONSTRAINT forum_migration_legacy_evidence_migration_run_id_fkey
  TO forum_migration_legacy_evidence_migration_run_fk_hidden;
SELECT pg_temp.expect_catalog_fail('DECOY_02 wrong-schema wrong-target same-name FK cannot substitute for the real FK');
ROLLBACK TO SAVEPOINT decoy_02;

-- DECOY_03 proof: real function renamed away; wrong-schema decoy must not substitute.
SAVEPOINT decoy_03;
ALTER FUNCTION public.forum_forbid_mutation() RENAME TO forum_forbid_mutation_real_hidden;
SELECT pg_temp.expect_catalog_fail('DECOY_03 wrong-schema same-name function cannot substitute for the real function');
ROLLBACK TO SAVEPOINT decoy_03;

-- DECOY_04 proof: real trigger renamed away; wrong-table decoy must not substitute.
SAVEPOINT decoy_04;
ALTER TRIGGER forum_migration_legacy_evidence_append_only_tg
  ON public.forum_migration_legacy_evidence
  RENAME TO forum_migration_legacy_evidence_append_only_tg_real_hidden;
SELECT pg_temp.expect_catalog_fail('DECOY_04 wrong-table same-name trigger cannot substitute for the real trigger');
ROLLBACK TO SAVEPOINT decoy_04;

-- DECOY_05 proof: same-name trigger on the real table rebound to a wrong function.
SAVEPOINT decoy_05;
DROP TRIGGER forum_migration_field_decisions_append_only_tg ON public.forum_migration_field_decisions;
CREATE TRIGGER forum_migration_field_decisions_append_only_tg
BEFORE UPDATE OR DELETE ON public.forum_migration_field_decisions
FOR EACH ROW EXECUTE FUNCTION af_decoy.forum_forbid_mutation();
SELECT pg_temp.expect_catalog_fail('DECOY_05 trigger bound to the wrong function cannot substitute for the real binding');
ROLLBACK TO SAVEPOINT decoy_05;

DROP SCHEMA af_decoy CASCADE;
SELECT pg_temp.expect_catalog_pass('exact catalog binding restored after decoy removal');

DO $$
DECLARE n integer;
BEGIN
  IF pg_catalog.to_regnamespace('af_decoy') IS NOT NULL THEN
    RAISE EXCEPTION 'decoy schema still exists';
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_constraint
  WHERE conname IN (
    'forum_migration_runs_status_ck',
    'forum_migration_legacy_evidence_migration_run_id_fkey'
  ) AND connamespace <> 'public'::pg_catalog.regnamespace;
  IF n <> 0 THEN RAISE EXCEPTION 'decoy constraint residue: %', n; END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
  WHERE p.proname = 'forum_forbid_mutation' AND ns.nspname <> 'public';
  IF n <> 0 THEN RAISE EXCEPTION 'decoy function residue: %', n; END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_trigger tg
  JOIN pg_catalog.pg_class cl ON cl.oid = tg.tgrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
  WHERE tg.tgname IN (
    'forum_migration_legacy_evidence_append_only_tg',
    'forum_migration_field_decisions_append_only_tg'
  ) AND ns.nspname <> 'public';
  IF n <> 0 THEN RAISE EXCEPTION 'decoy trigger residue: %', n; END IF;
  RAISE NOTICE 'DECOY_RESIDUE=NONE';
  RAISE NOTICE 'WRONG_SCHEMA_DECOY_TEST=PASS';
  RAISE NOTICE 'WRONG_TARGET_DECOY_TEST=PASS';
  RAISE NOTICE 'WRONG_FUNCTION_BINDING_DECOY_TEST=PASS';
  RAISE NOTICE 'DECOY_CANNOT_SUBSTITUTE_FOR_REAL_OBJECT=PASS';
END $$;

SELECT pg_temp.expect_catalog_pass('final pre-rollback exact catalog binding');

ROLLBACK;

-- Verification data was transactional; the migrated database ends empty and
-- no trigger is left disabled.
DO $$
DECLARE total bigint; n integer;
BEGIN
  SELECT sum(row_count) INTO total
  FROM (
    SELECT count(*) AS row_count FROM forum_migration_runs
    UNION ALL SELECT count(*) FROM forum_migration_legacy_evidence
    UNION ALL SELECT count(*) FROM forum_migration_field_decisions
    UNION ALL SELECT count(*) FROM forum_migration_quarantines
    UNION ALL SELECT count(*) FROM forum_migration_validation_results
  ) counts;
  IF total <> 0 THEN RAISE EXCEPTION 'foundation tables not empty after rollback: %', total; END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_trigger tg
  JOIN pg_catalog.pg_class cl ON cl.oid = tg.tgrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
  WHERE ns.nspname = 'public'
    AND tg.tgname IN (
      'forum_migration_legacy_evidence_append_only_tg',
      'forum_migration_field_decisions_append_only_tg',
      'forum_migration_validation_results_append_only_tg',
      'forum_migration_runs_sealed_guard_tg'
    )
    AND (tg.tgenabled <> 'O' OR tg.tgisinternal);
  IF n <> 0 THEN RAISE EXCEPTION 'foundation triggers left disabled or missing: %', n; END IF;

  IF pg_catalog.to_regnamespace('af_decoy') IS NOT NULL THEN
    RAISE EXCEPTION 'decoy schema survived rollback';
  END IF;

  RAISE NOTICE 'NEW_TABLE_EMPTY_ASSERTION=PASS';
  RAISE NOTICE 'TRIGGERS_ENABLED_AFTER_ROLLBACK=PASS';
  RAISE NOTICE 'FIELD_DECISION_CHECK_TRUTH_TABLE=PASS';
  RAISE NOTICE 'MIGRATION_RUN_STATE_MACHINE=PASS';
  RAISE NOTICE 'FOREIGN_KEY_REVIEW=PASS';
  RAISE NOTICE 'SIX_FK_DELETE_ACTIONS=RESTRICT';
  RAISE NOTICE 'SIX_FK_UPDATE_ACTIONS=RESTRICT';
  RAISE NOTICE 'SIX_FK_COLUMN_BINDINGS=PASS';
  RAISE NOTICE 'SIX_FK_PARENT_BINDINGS=PASS';
  RAISE NOTICE 'PUBLIC_SCHEMA_BINDING=PASS';
  RAISE NOTICE 'CHECK_CONSTRAINT_EXACT_BINDING=PASS';
  RAISE NOTICE 'FUNCTION_EXACT_BINDING=PASS';
  RAISE NOTICE 'TRIGGER_EXACT_BINDING=PASS';
  RAISE NOTICE 'CATALOG_EXACT_BINDING_REVIEW=PASS';
  RAISE NOTICE 'SQL_001_TO_014_COMPLETE=PASS';
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
