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

-- SQL-001..SQL-014 physical catalog objects.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint WHERE conname IN (
    'forum_migration_runs_status_ck',
    'forum_migration_runs_attempt_pos_ck',
    'forum_migration_legacy_evidence_classification_ck',
    'forum_migration_field_decisions_classification_ck',
    'forum_migration_field_decisions_selected_ck',
    'forum_migration_quarantines_category_ck',
    'forum_migration_quarantines_status_ck',
    'forum_migration_validation_results_result_ck'
  );
  IF n <> 8 THEN RAISE EXCEPTION 'expected 8 named foundation CHECKs, found %', n; END IF;

  SELECT count(*) INTO n FROM pg_proc WHERE proname IN (
    'forum_forbid_mutation', 'forum_migration_runs_sealed_guard'
  );
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 foundation functions, found %', n; END IF;

  SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
    'forum_migration_legacy_evidence_append_only_tg',
    'forum_migration_field_decisions_append_only_tg',
    'forum_migration_validation_results_append_only_tg',
    'forum_migration_runs_sealed_guard_tg'
  );
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 foundation triggers, found %', n; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid IN (
      'forum_migration_runs'::regclass,
      'forum_migration_legacy_evidence'::regclass,
      'forum_migration_field_decisions'::regclass,
      'forum_migration_quarantines'::regclass,
      'forum_migration_validation_results'::regclass
    ) AND pg_get_constraintdef(oid) LIKE '%185%'
  ) THEN
    RAISE EXCEPTION '185 must not be encoded in a foundation constraint';
  END IF;
END $$;

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

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_constraint
  WHERE conname IN (
    'forum_migration_legacy_evidence_migration_run_id_fkey',
    'forum_migration_legacy_evidence_candidate_principal_id_fkey',
    'forum_migration_field_decisions_legacy_evidence_id_fkey',
    'forum_migration_quarantines_legacy_evidence_id_fkey',
    'forum_migration_quarantines_resolved_by_principal_id_fkey',
    'forum_migration_validation_results_migration_run_id_fkey'
  ) AND contype='f' AND confdeltype='r';
  IF n <> 6 THEN RAISE EXCEPTION 'expected six RESTRICT foreign keys, found %', n; END IF;
END $$;

ROLLBACK;

-- Verification data was transactional; the migrated database ends empty.
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
  IF total <> 0 THEN RAISE EXCEPTION 'foundation tables not empty after rollback: %', total; END IF;
  RAISE NOTICE 'NEW_TABLE_EMPTY_ASSERTION=PASS';
  RAISE NOTICE 'FIELD_DECISION_CHECK_TRUTH_TABLE=PASS';
  RAISE NOTICE 'MIGRATION_RUN_STATE_MACHINE=PASS';
  RAISE NOTICE 'FOREIGN_KEY_REVIEW=PASS';
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
