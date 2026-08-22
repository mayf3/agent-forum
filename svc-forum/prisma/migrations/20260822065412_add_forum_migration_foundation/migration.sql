-- CreateTable
CREATE TABLE "forum_migration_runs" (
    "id" UUID NOT NULL,
    "source_commit" TEXT NOT NULL,
    "source_schema_revision" TEXT NOT NULL,
    "target_commit" TEXT NOT NULL,
    "target_schema_revision" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "snapshot_at" TIMESTAMPTZ(3) NOT NULL,
    "policy_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "run_identity_key" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "rollback_reference" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_migration_legacy_evidence" (
    "id" UUID NOT NULL,
    "migration_run_id" UUID NOT NULL,
    "source_table" TEXT NOT NULL,
    "source_row_reference" TEXT NOT NULL,
    "source_row_hash" BYTEA NOT NULL,
    "source_namespace" TEXT,
    "candidate_principal_id" UUID,
    "classification" TEXT NOT NULL,
    "safe_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_migration_legacy_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_migration_field_decisions" (
    "id" UUID NOT NULL,
    "legacy_evidence_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "source_values_safe" JSONB NOT NULL,
    "selected_value_safe" JSONB,
    "reason_code" TEXT NOT NULL,
    "decided_by_policy" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_migration_field_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_migration_quarantines" (
    "id" UUID NOT NULL,
    "legacy_evidence_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "authority_effect" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reclassification_requirement" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_principal_id" UUID,

    CONSTRAINT "forum_migration_quarantines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_migration_validation_results" (
    "id" UUID NOT NULL,
    "migration_run_id" UUID NOT NULL,
    "check_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "required" BOOLEAN NOT NULL,
    "expected" JSONB NOT NULL,
    "actual" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "evidence_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_migration_validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_migration_runs_run_identity_key_attempt_key" ON "forum_migration_runs"("run_identity_key", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "forum_migration_legacy_evidence_migration_run_id_source_tab_key" ON "forum_migration_legacy_evidence"("migration_run_id", "source_table", "source_row_reference");

-- CreateIndex
CREATE UNIQUE INDEX "forum_migration_field_decisions_legacy_evidence_id_field_na_key" ON "forum_migration_field_decisions"("legacy_evidence_id", "field_name");

-- CreateIndex
CREATE UNIQUE INDEX "forum_migration_quarantines_legacy_evidence_id_key" ON "forum_migration_quarantines"("legacy_evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_migration_validation_results_migration_run_id_check_i_key" ON "forum_migration_validation_results"("migration_run_id", "check_id");

-- AddForeignKey
ALTER TABLE "forum_migration_legacy_evidence" ADD CONSTRAINT "forum_migration_legacy_evidence_migration_run_id_fkey" FOREIGN KEY ("migration_run_id") REFERENCES "forum_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_migration_legacy_evidence" ADD CONSTRAINT "forum_migration_legacy_evidence_candidate_principal_id_fkey" FOREIGN KEY ("candidate_principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_migration_field_decisions" ADD CONSTRAINT "forum_migration_field_decisions_legacy_evidence_id_fkey" FOREIGN KEY ("legacy_evidence_id") REFERENCES "forum_migration_legacy_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_migration_quarantines" ADD CONSTRAINT "forum_migration_quarantines_legacy_evidence_id_fkey" FOREIGN KEY ("legacy_evidence_id") REFERENCES "forum_migration_legacy_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_migration_quarantines" ADD CONSTRAINT "forum_migration_quarantines_resolved_by_principal_id_fkey" FOREIGN KEY ("resolved_by_principal_id") REFERENCES "forum_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_migration_validation_results" ADD CONSTRAINT "forum_migration_validation_results_migration_run_id_fkey" FOREIGN KEY ("migration_run_id") REFERENCES "forum_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-001..SQL-008: migration foundation closed-set and shape constraints
ALTER TABLE "forum_migration_runs"
  ADD CONSTRAINT "forum_migration_runs_status_ck" CHECK (
    "status" IN ('planned', 'running', 'validated', 'failed', 'rolled_back', 'sealed')
  ),
  ADD CONSTRAINT "forum_migration_runs_attempt_pos_ck" CHECK ("attempt" > 0);

ALTER TABLE "forum_migration_legacy_evidence"
  ADD CONSTRAINT "forum_migration_legacy_evidence_classification_ck" CHECK (
    "classification" IN ('deterministic', 'ambiguous', 'unprovable')
  );

ALTER TABLE "forum_migration_field_decisions"
  ADD CONSTRAINT "forum_migration_field_decisions_classification_ck" CHECK (
    "classification" IN ('deterministic', 'ambiguous', 'unprovable')
  ),
  ADD CONSTRAINT "forum_migration_field_decisions_selected_ck" CHECK (
    "classification" = 'deterministic'
    OR "selected_value_safe" IS NULL
  );

ALTER TABLE "forum_migration_quarantines"
  ADD CONSTRAINT "forum_migration_quarantines_category_ck" CHECK (
    "category" IN (
      'participant_collision',
      'unresolved_participant',
      'archived_lifecycle_unknown',
      'other'
    )
  ),
  ADD CONSTRAINT "forum_migration_quarantines_status_ck" CHECK (
    "status" IN ('open', 'resolved')
  );

ALTER TABLE "forum_migration_validation_results"
  ADD CONSTRAINT "forum_migration_validation_results_result_ck" CHECK (
    "result" IN ('pass', 'fail', 'inconclusive')
  );

-- SQL-009: shared append-only rejection function
CREATE FUNCTION "forum_forbid_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$$;

-- SQL-010..SQL-012: append-only evidence triggers
CREATE TRIGGER "forum_migration_legacy_evidence_append_only_tg"
BEFORE UPDATE OR DELETE ON "forum_migration_legacy_evidence"
FOR EACH ROW EXECUTE FUNCTION "forum_forbid_mutation"();

CREATE TRIGGER "forum_migration_field_decisions_append_only_tg"
BEFORE UPDATE OR DELETE ON "forum_migration_field_decisions"
FOR EACH ROW EXECUTE FUNCTION "forum_forbid_mutation"();

CREATE TRIGGER "forum_migration_validation_results_append_only_tg"
BEFORE UPDATE OR DELETE ON "forum_migration_validation_results"
FOR EACH ROW EXECUTE FUNCTION "forum_forbid_mutation"();

-- SQL-013: MigrationRun transition, terminal-state, and identity guard
CREATE FUNCTION "forum_migration_runs_sealed_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('sealed', 'failed', 'rolled_back') THEN
    RAISE EXCEPTION 'terminal migration run cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('sealed', 'failed', 'rolled_back') THEN
    RAISE EXCEPTION 'terminal migration run cannot be updated'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      (OLD.status = 'planned'   AND NEW.status IN ('running', 'failed')) OR
      (OLD.status = 'running'   AND NEW.status IN ('validated', 'failed')) OR
      (OLD.status = 'validated' AND NEW.status IN ('sealed', 'rolled_back', 'failed'))
    ) THEN
      RAISE EXCEPTION 'illegal migration run status transition % -> %',
        OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.id <> OLD.id
       OR NEW.source_commit <> OLD.source_commit
       OR NEW.source_schema_revision <> OLD.source_schema_revision
       OR NEW.target_commit <> OLD.target_commit
       OR NEW.target_schema_revision <> OLD.target_schema_revision
       OR NEW.environment <> OLD.environment
       OR NEW.dataset_id <> OLD.dataset_id
       OR NEW.snapshot_at <> OLD.snapshot_at
       OR NEW.policy_id <> OLD.policy_id
       OR NEW.phase <> OLD.phase
       OR NEW.run_identity_key <> OLD.run_identity_key
       OR NEW.attempt <> OLD.attempt
       OR NEW.started_at <> OLD.started_at
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'migration run identity fields are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- SQL-014: bind the MigrationRun guard
CREATE TRIGGER "forum_migration_runs_sealed_guard_tg"
BEFORE UPDATE OR DELETE ON "forum_migration_runs"
FOR EACH ROW EXECUTE FUNCTION "forum_migration_runs_sealed_guard"();
