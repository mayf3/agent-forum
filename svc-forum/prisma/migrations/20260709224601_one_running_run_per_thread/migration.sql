-- One running discussion run per thread (partial unique index)
-- Ensures at the database level that at most one DiscussionRun per thread
-- can have status = 'running' at any given time.
-- This is the final guarantee for concurrent start protection.
CREATE UNIQUE INDEX "discussion_runs_one_running_per_thread"
ON "discussion_runs"("threadId")
WHERE "status" = 'running';
