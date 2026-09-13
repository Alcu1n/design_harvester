import { providerInfo, modelMetadata, type ModelConfig } from "./model-config.ts";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { designs } from "./schema.ts";
import { db, sql, transaction } from "./db.ts";
import { validateURL, canonicalize } from "./security.ts";
import { HarvestError } from "./contracts.ts";
import { files, getJSON, get, removeDesign, manifest } from "./storage.ts";
import { getModelConfig } from "./model-settings.ts";
export const versionsMetadata = (config: ModelConfig = providerInfo()) => ({
  pipeline: "1.0.0",
  extractor: "1.0.1",
  evidenceSchema: "1.0",
  analysis: "1.0",
  iosAdapter: "1.0",
  prompt: "1.0",
  designMdSpec: "alpha",
  designMdLinter: "0.4.0",
  ...modelMetadata(config),
  language: "zh-CN",
});
export async function createRun(
  url: string,
  existingDesign?: string,
  snapshotId?: string,
) {
  const canonical = canonicalize(url);
  const config = await getModelConfig();
  return transaction(async (c) => {
    const proposed = randomUUID();
    const d = (
      await c.query(
        "INSERT INTO designs(id,canonical_url) VALUES($1,$2) ON CONFLICT(canonical_url) DO UPDATE SET canonical_url=EXCLUDED.canonical_url RETURNING *",
        [proposed, canonical],
      )
    ).rows[0];
    if (existingDesign && d.id !== existingDesign)
      throw new Error("Design mismatch");
    if (
      (await c.query("SELECT 1 FROM deletion_queue WHERE design_id=$1", [d.id]))
        .rowCount
    )
      throw new HarvestError("CONFLICT", "条目正在删除，请稍后再收藏。");
    const sid = snapshotId || randomUUID(),
      vid = randomUUID(),
      rid = randomUUID();
    if (snapshotId) {
      if (
        !(
          await c.query(
            "SELECT 1 FROM snapshots WHERE id=$1 AND design_id=$2",
            [sid, d.id],
          )
        ).rowCount
      )
        throw new HarvestError("NOT_FOUND", "采集快照不存在。");
    } else
      await c.query("INSERT INTO snapshots(id,design_id) VALUES($1,$2)", [
        sid,
        d.id,
      ]);
    await c.query(
      "INSERT INTO versions(id,design_id,snapshot_id,metadata) VALUES($1,$2,$3,$4)",
      [vid, d.id, sid, JSON.stringify(versionsMetadata(config))],
    );
    await c.query(
      "INSERT INTO tasks(id,design_id,snapshot_id,version_id,kind) VALUES($1,$2,$3,$4,$5)",
      [rid, d.id, sid, vid, snapshotId ? "REGENERATE" : "HARVEST"],
    );
    return { designId: d.id, runId: rid, status: "QUEUED" };
  });
}
export async function listDesigns(search: URLSearchParams) {
  const query = (search.get("query") || "").slice(0, 200),
    tag = search.get("tag") || "",
    status = search.get("status") || "";
  const sort = search.get("sort"),
    page = Math.max(1, Math.min(100000, Number(search.get("page")) || 1));
  const order =
    sort === "oldest"
      ? "d.created_at ASC"
      : sort === "score"
        ? "v.score DESC NULLS LAST,d.created_at DESC"
        : "d.created_at DESC";
  const filter = `WHERE NOT EXISTS(SELECT 1 FROM deletion_queue q WHERE q.design_id=d.id) AND ($1='' OR concat_ws(' ',d.title,d.canonical_url,d.tags::text,v.analysis->>'name',v.analysis->>'summary') ILIKE '%'||$1||'%') AND ($2='' OR d.tags ? $2 OR (v.analysis->'tags') ? $2) AND ($3='' OR t.status=$3)`;
  const from = `FROM designs d LEFT JOIN LATERAL (SELECT * FROM versions WHERE design_id=d.id ORDER BY (id=d.default_version_id) DESC NULLS LAST,created_at DESC LIMIT 1) v ON true LEFT JOIN LATERAL(SELECT * FROM tasks WHERE design_id=d.id ORDER BY created_at DESC LIMIT 1)t ON true`;
  const items = await sql(
    `SELECT d.*,v.id AS version_id,v.snapshot_id,v.score,v.quality,v.analysis,t.status,t.stage ${from} ${filter} ORDER BY ${order} LIMIT 24 OFFSET $4`,
    [query, tag, status, (page - 1) * 24],
  );
  const [count] = await sql(`SELECT count(*)::int AS total ${from} ${filter}`, [
    query,
    tag,
    status,
  ]);
  return { items, total: count.total, page };
}
export async function detail(id: string) {
  const [d] = await sql<{
    id: string;
    canonical_url: string;
    title: string | null;
    notes: string;
    tags: string[];
    default_version_id: string | null;
    created_at: string;
  }>(
    "SELECT * FROM designs WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM deletion_queue WHERE design_id=$1)",
    [id],
  );
  if (!d) throw new HarvestError("NOT_FOUND", "设计条目不存在。");
  const versions = await sql(
    "SELECT * FROM versions WHERE design_id=$1 ORDER BY created_at DESC",
    [id],
  );
  const tasks = await sql(
    "SELECT * FROM tasks WHERE design_id=$1 ORDER BY created_at DESC",
    [id],
  );
  const assets = await files(id);
  return { ...d, versions, tasks, assets };
}
export async function resume(id: string) {
  const rows = await sql(
    "UPDATE tasks SET status='QUEUED',error=NULL,retry_at=NULL,attempts=0,dispatched_at=NULL,cancel_requested=false WHERE id=$1 AND status IN ('FAILED','PARTIAL','WAITING_AUTH','WAITING_QUOTA','WAITING_CONFIG','CANCELED') RETURNING id",
    [id],
  );
  if (!rows.length) throw new HarvestError("CONFLICT", "当前任务无法恢复。");
}
export async function cancel(id: string) {
  await sql(
    "UPDATE tasks SET cancel_requested=true,status=CASE WHEN status='RUNNING' THEN status ELSE 'CANCELED' END WHERE id=$1 AND status NOT IN ('READY','FAILED','PARTIAL','CANCELED')",
    [id],
  );
}
export async function deleteDesign(id: string) {
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO deletion_queue(design_id) SELECT id FROM designs WHERE id=$1 ON CONFLICT DO NOTHING",
      [id],
    );
    await c.query(
      "UPDATE tasks SET cancel_requested=true,status=CASE WHEN status='RUNNING' THEN status ELSE 'CANCELED' END WHERE design_id=$1",
      [id],
    );
  });
}
export async function flushDeletions() {
  for (const d of await sql("SELECT design_id FROM deletion_queue")) {
    await transaction(async (c) => {
      await c.query("SELECT id FROM designs WHERE id=$1 FOR UPDATE", [
        d.design_id,
      ]);
      const tasks = (
        await c.query("SELECT id FROM tasks WHERE design_id=$1 ORDER BY id", [
          d.design_id,
        ])
      ).rows;
      for (const t of tasks) {
        const lock = (
          await c.query(
            "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked",
            [t.id],
          )
        ).rows[0];
        if (!lock.locked) return;
      }
      await removeDesign(d.design_id);
      await c.query("DELETE FROM tasks WHERE design_id=$1", [d.design_id]);
      await c.query("DELETE FROM versions WHERE design_id=$1", [d.design_id]);
      await c.query("DELETE FROM designs WHERE id=$1", [d.design_id]);
      await c.query("DELETE FROM deletion_queue WHERE design_id=$1", [
        d.design_id,
      ]);
    });
  }
}

export async function updateDesign(
  id: string,
  changes: { title?: string; notes?: string; tags?: string[] },
) {
  await db.update(designs).set(changes).where(eq(designs.id, id));
}
