import {cleanupImports} from "../../../packages/core/src/image-import.ts";
import { getModelConfig } from "../../../packages/core/src/model-settings.ts";
import {
  providerAuthReady,
} from "../../../packages/core/src/provider.ts";
import { putJSON } from "../../../packages/core/src/storage.ts";
import { PgBoss } from "pg-boss";
import { sql, pool } from "../../../packages/core/src/db.ts";
import { processTask } from "../../../packages/core/src/pipeline.ts";
import { flushDeletions } from "../../../packages/core/src/service.ts";
const boss = new PgBoss(
  process.env.DATABASE_URL ||
    "postgresql://harvester:harvester@127.0.0.1:5432/harvester",
);
boss.on("error", (e) => console.error("queue_error", e.message));
await boss.start();
await boss.createQueue("harvest");
await boss.work<{ id: string }>(
  "harvest",
  { batchSize: 1, localConcurrency: 1 },
  async (jobs) => {
    for (const job of jobs) await processTask(job.data.id);
  },
);
let busy = false;
async function dispatch() {
  if (busy) return;
  busy = true;
  try {
    await sql(
      "UPDATE tasks SET status='QUEUED',dispatched_at=NULL WHERE status='RUNNING' AND heartbeat_at<now()-interval '2 minutes'",
    );
    await sql(
      "UPDATE tasks SET status='QUEUED',dispatched_at=NULL WHERE status='WAITING_QUOTA' AND retry_at IS NOT NULL AND retry_at<=now()",
    );
    const tasks = await sql(
      "SELECT id FROM tasks WHERE status='QUEUED' AND cancel_requested=false AND (retry_at IS NULL OR retry_at<=now()) AND (dispatched_at IS NULL OR dispatched_at<now()-interval '1 minute') ORDER BY created_at LIMIT 20",
    );
    for (const task of tasks) {
      const id = await boss.send(
        "harvest",
        { id: task.id },
        {
          singletonKey: task.id,
          expireInSeconds: 3600,
          retryLimit: 2,
          retryDelay: 30,
        },
      );
      if (id)
        await sql("UPDATE tasks SET dispatched_at=now() WHERE id=$1", [
          task.id,
        ]);
    }
    await flushDeletions();
    await cleanupImports();
    const config = await getModelConfig();
    await putJSON(".system/auth.json", {
      cached: await providerAuthReady(config),
      connections: { gemini: await providerAuthReady({ provider: "antigravity-cli", model: "default" }), deepseek: await providerAuthReady({ provider: "deepseek", model: "deepseek-flash" }) },
      ...config,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error(
      "dispatcher_error",
      e instanceof Error ? e.message : "unknown",
    );
  } finally {
    busy = false;
  }
}
await dispatch();
const timer = setInterval(() => void dispatch(), 3000);
console.log("Design worker ready");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(timer);
    void boss
      .stop({ graceful: true, timeout: 20000 })
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
