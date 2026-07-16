import { connectorDb, transaction } from "@/lib/db";
import type { RunSyncInput, SyncKind } from "@/lib/domain";

export interface ClaimedJob {
  id: number;
  syncRunId: number;
  payload: RunSyncInput;
}

export async function enqueueSync(
  input: RunSyncInput,
  trigger: string,
): Promise<number> {
  try {
    return await transaction(async (client) => {
    const run = await client.query<{ id: number }>(
      `INSERT INTO sync_runs (kind, trigger, status, dry_run)
       VALUES ($1, $2, 'queued', $3) RETURNING id`,
      [input.kind, trigger, input.dryRun ?? false],
    );
    const syncRunId = run.rows[0].id;
    await client.query(
      "INSERT INTO sync_jobs (sync_run_id, payload) VALUES ($1, $2::jsonb)",
      [syncRunId, JSON.stringify(input)],
    );
      return syncRunId;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("A sync run is already queued or running");
    }
    throw error;
  }
}

export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  return transaction(async (client) => {
    const result = await client.query<{
      id: number;
      sync_run_id: number;
      payload: RunSyncInput;
    }>(
      `SELECT id, sync_run_id, payload
       FROM sync_jobs
       WHERE (status = 'queued' AND available_at <= now())
          OR (status = 'running' AND attempts < 3 AND locked_at < now() - interval '10 minutes')
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const job = result.rows[0];
    if (!job) return null;
    await client.query(
      `UPDATE sync_jobs
       SET status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = $2, updated_at = now()
       WHERE id = $1`,
      [job.id, workerId],
    );
    await client.query(
      "UPDATE sync_runs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1",
      [job.sync_run_id],
    );
    return { id: job.id, syncRunId: job.sync_run_id, payload: job.payload };
  });
}

export async function failExhaustedJobs(): Promise<number> {
  return transaction(async (client) => {
    const result = await client.query<{ sync_run_id: number }>(
      `UPDATE sync_jobs
       SET status = 'failed', last_error = 'Worker lease expired after 3 attempts',
           locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE status = 'running' AND attempts >= 3 AND locked_at < now() - interval '10 minutes'
       RETURNING sync_run_id`,
    );
    if (result.rows.length) {
      await client.query(
        `UPDATE sync_runs SET status = 'failed', completed_at = now(),
           error_summary = 'Worker lease expired after 3 attempts'
         WHERE id = ANY ($1::bigint[])`,
        [result.rows.map((row) => row.sync_run_id)],
      );
    }
    return result.rows.length;
  });
}

export async function finishJob(jobId: number, failedError?: string): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query<{ sync_run_id: number }>(
      `UPDATE sync_jobs
       SET status = $2, last_error = $3, locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE id = $1 RETURNING sync_run_id`,
      [jobId, failedError ? "failed" : "completed", failedError ?? null],
    );
    const runId = result.rows[0]?.sync_run_id;
    if (runId && failedError) {
      await client.query(
        `UPDATE sync_runs
         SET status = 'failed', error_summary = $2, completed_at = now()
         WHERE id = $1`,
        [runId, failedError],
      );
    }
  });
}

export async function heartbeatJob(jobId: number, workerId: string): Promise<void> {
  await connectorDb().query(
    `UPDATE sync_jobs SET locked_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'running' AND locked_by = $2`,
    [jobId, workerId],
  );
}

export async function scheduleEnabledBrands(kind: SyncKind = "scheduled"): Promise<number> {
  return enqueueSync({ kind }, "worker-schedule");
}
