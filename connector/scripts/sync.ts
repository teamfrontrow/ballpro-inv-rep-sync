import { enqueueSync } from "../src/lib/jobs/queue";

const dryRun = process.argv.includes("--dry-run");
const scheduled = process.argv.includes("--scheduled");
const kind = scheduled ? "scheduled" : "one_time";

enqueueSync({ kind, dryRun }, scheduled ? "cron" : "cli")
  .then((runId) => console.log(`Queued ${kind} sync run ${runId}${dryRun ? " (dry run)" : ""}`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
