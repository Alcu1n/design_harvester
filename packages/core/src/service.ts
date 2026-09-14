import { restorePresentation } from "./presentation-job.ts";
import { fallbackQuality, modelQuality } from "./quality.ts";
import {
  providerInfo,
  modelMetadata,
  type ModelConfig,
} from "./model-config.ts";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { designs } from "./schema.ts";
import { db, sql, transaction } from "./db.ts";
import { validateURL, canonicalize } from "./security.ts";
import { CriticSchema, HarvestError } from "./contracts.ts";
import { files, getJSON, get, removeDesign, manifest } from "./storage.ts";
import { getModelConfig } from "./model-settings.ts";
export const versionsMetadata = (config: ModelConfig = providerInfo()) => ({
  pipeline: "1.3.0",
  extractor: "1.0.2",
  evidenceSchema: "1.0",
  analysis: "1.0",
  iosAdapter: "1.0",
  prompt: "3.0",
  designMdSpec: "alpha",
  officialLint: "disabled",
  ...modelMetadata(config),
  language: "en",
  presentationLanguage: "zh-CN",
});
export async function createRun(
  url: string | null,
  existingDesign?: string,
  snapshotId?: string,
) {
  const canonical = url ? canonicalize(url) : null;
  const config = await getModelConfig();
  return transaction(async (c) => {
    const proposed = randomUUID();
    const d = canonical
      ? (
          await c.query(
            "INSERT INTO designs(id,canonical_url) VALUES($1,$2) ON CONFLICT(canonical_url) DO UPDATE SET canonical_url=EXCLUDED.canonical_url RETURNING *",
            [proposed, canonical],
          )
        ).rows[0]
      : (
          await c.query(
            "SELECT * FROM designs WHERE id=$1 AND source_kind='images'",
            [existingDesign],
          )
        ).rows[0];
    if (!d || (!canonical && !snapshotId))
      throw new HarvestError("CONFLICT", "图片设计请使用已有快照重新生成。");
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
  const filter = `WHERE NOT EXISTS(SELECT 1 FROM deletion_queue q WHERE q.design_id=d.id) AND ($1='' OR concat_ws(' ',d.title,d.canonical_url,d.tags::text,v.analysis->>'name',v.analysis->>'summary',v.display_zh->>'name',v.display_zh->>'summary') ILIKE '%'||$1||'%') AND ($2='' OR d.tags ? $2 OR (v.analysis->'tags') ? $2 OR (v.display_zh->'tags') ? $2) AND ($3='' OR t.status=$3)`;
  const from = `FROM designs d LEFT JOIN LATERAL (SELECT * FROM versions WHERE design_id=d.id ORDER BY (id=d.default_version_id) DESC NULLS LAST,created_at DESC LIMIT 1) v ON true LEFT JOIN LATERAL(SELECT * FROM tasks WHERE design_id=d.id AND kind<>'PRESENTATION' ORDER BY created_at DESC LIMIT 1)t ON true`;
  const items = await sql(
    `SELECT d.*,v.id AS version_id,v.snapshot_id,v.score,v.quality,v.analysis,v.display_zh,v.metadata,v.validation,t.status,t.stage,t.manual_status ${from} ${filter} ORDER BY ${order} LIMIT 24 OFFSET $4`,
    [query, tag, status, (page - 1) * 24],
  );
  const [count] = await sql(`SELECT count(*)::int AS total ${from} ${filter}`, [
    query,
    tag,
    status,
  ]);
  return { items, total: count.total, page };
}
async function ensureVersionScore(versionId: string) {
  const [v] = await sql(
    "SELECT v.* FROM versions v JOIN tasks t ON t.version_id=v.id WHERE v.id=$1 AND v.score IS NULL AND t.status NOT IN ('QUEUED','RUNNING')",
    [versionId],
  );
  if (!v) return;
  const prefix = `${v.design_id}/versions/${v.id}`;
  const read = async (key: string) => getJSON(key).catch(() => undefined);
  const evidence = await read(
    `${v.design_id}/snapshots/${v.snapshot_id}/evidence.json`,
  );
  const old = CriticSchema.safeParse(await read(prefix + "/critic.json"));
  const score = old.success
    ? modelQuality(old.data, evidence)
    : fallbackQuality({
        analysis: v.analysis ?? (await read(prefix + "/analysis.json")),
        ios: await read(prefix + "/ios-analysis.json"),
        evidence,
        markdown: await get(prefix + "/DESIGN.md")
          .then((b) => b.toString())
          .catch(() => ""),
        reason: "此版本没有可用的模型评分",
      });
  const report = `${prefix}/quality-score.json`;
  await sql(
    "UPDATE versions SET score=$2,metadata=metadata||$3::jsonb WHERE id=$1 AND score IS NULL",
    [
      versionId,
      score.score,
      JSON.stringify({
        scoringMethod: score.method,
        scoringReport: report,
        scoringResult: score,
      }),
    ],
  );
}
export async function detail(id: string) {
  const [d] = await sql<{
    id: string;
    canonical_url: string | null;
    source_kind: string;
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
  for (const v of await sql(
    "SELECT id FROM versions WHERE design_id=$1 AND score IS NULL",
    [id],
  ))
    await ensureVersionScore(v.id);
  const restore = await sql(
    "SELECT * FROM versions WHERE design_id=$1 AND display_zh IS NULL",
    [id],
  );
  for (const v of restore) await restorePresentation(v);
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
export async function setTaskStatus(id: string, status: "READY" | "FAILED") {
  if (!["READY", "FAILED"].includes(status))
    throw new HarvestError("CONFLICT", "请选择已完成或失败。");
  const rows = await sql(
    `UPDATE tasks SET manual_status=jsonb_build_object('status',$2::text,'previousStatus',status,'time',now()),status=$2,cancel_requested=true,control_revision=control_revision+1,finished_at=now(),retry_at=NULL,dispatched_at=NULL,events=events||jsonb_build_array(jsonb_build_object('stage','MANUAL_STATUS_CHANGED','status',$2::text,'previousStatus',status,'time',now())) WHERE id=$1 RETURNING id,version_id`,
    [id, status],
  );
  if (!rows.length) throw new HarvestError("NOT_FOUND", "任务不存在。");
  await ensureVersionScore(rows[0].version_id);
}
export async function resume(id: string) {
  const [protectedVersion] = await sql(
    "SELECT t.manual_status,t.design_id,t.snapshot_id,d.canonical_url FROM tasks t JOIN versions v ON v.id=t.version_id JOIN designs d ON d.id=t.design_id WHERE t.id=$1 AND (v.quality='QUALIFIED' OR (v.quality='SCORED' AND t.stage='COMPLETE'))",
    [id],
  );
  if (protectedVersion?.manual_status)
    return createRun(
      protectedVersion.canonical_url,
      protectedVersion.design_id,
      protectedVersion.snapshot_id,
    );

  const rows = await sql(
    `UPDATE tasks SET status='QUEUED',manual_status=NULL,control_revision=control_revision+1,error=NULL,retry_at=NULL,attempts=0,finished_at=NULL,repair_state=CASE WHEN status IN ('FAILED','PARTIAL','CANCELED') AND repair_state IS NOT NULL THEN repair_state || '{"repairs":0,"fingerprints":{},"transportRetries":{}}'::jsonb ELSE repair_state END,dispatched_at=NULL,cancel_requested=false WHERE id=$1 AND status IN ('FAILED','PARTIAL','WAITING_AUTH','WAITING_QUOTA','WAITING_CONFIG','CANCELED') RETURNING id`,
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
