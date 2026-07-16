import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { claimJob, failExhaustedJobs, finishJob, heartbeatJob } from "../src/lib/jobs/queue";
import { runSync } from "../src/lib/sync/engine";

const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main(): Promise<void> {
  console.log(`Worker ${workerId} started`);
  while (!stopping) {
    await failExhaustedJobs();
    const job = await claimJob(workerId);
    if (!job) {
      await delay(2_000);
      continue;
    }
    const heartbeat = setInterval(() => {
      heartbeatJob(job.id, workerId).catch((error) => console.error("Job heartbeat failed", error));
    }, 30_000);
    try {
      await runSync(job.payload, job.syncRunId);
      await finishJob(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishJob(job.id, message);
      console.error(`Sync job ${job.id} failed`, error);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
