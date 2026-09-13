import { generateDocuments } from "./generation.ts";
import { modelProvider } from "./provider.ts";
import { clearTiles } from "./storage.ts";
import { pool, sql } from "./db.ts";
import { capture, visualInputs } from "./browser.ts";
import { type DesignModelProvider } from "./model.ts";
import { eligible, HarvestError, type Evidence } from "./contracts.ts";
import { getJSON, putJSON, put, exists, manifest } from "./storage.ts";
import { renderDesign, renderIOS } from "./render.ts";
export async function processTask(id: string, provider?: DesignModelProvider) {
  const connection = await pool.connect();
  let timer: ReturnType<typeof setInterval> | undefined;
  const controller = new AbortController();
  try {
    const locked = (
      await connection.query(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
        [id],
      )
    ).rows[0].locked;
    if (!locked) return;
    const [task] = await sql(
      "SELECT t.*,d.canonical_url FROM tasks t JOIN designs d ON d.id=t.design_id WHERE t.id=$1",
      [id],
    );
    if (
      !task ||
      !["QUEUED", "RUNNING"].includes(task.status) ||
      (task.retry_at && new Date(task.retry_at).getTime() > Date.now()) ||
      task.cancel_requested
    )
      return;
    const started = await sql(
      "UPDATE tasks SET status='RUNNING',error=NULL,retry_at=NULL,heartbeat_at=now() WHERE id=$1 AND control_revision=$2 AND manual_status IS NULL AND cancel_requested=false RETURNING id",
      [id, task.control_revision],
    );
    if (!started.length) return;
    timer = setInterval(() => {
      void sql(
        "UPDATE tasks SET heartbeat_at=now() WHERE id=$1 AND control_revision=$2 RETURNING cancel_requested",
        [id, task.control_revision],
      )
        .then((r) => {
          if (!r.length || r[0].cancel_requested) controller.abort();
        })
        .catch(() => controller.abort());
    }, 2000);
    const stage = async (s: string) => {
      if (controller.signal.aborted)
        throw new HarvestError("CANCELED", "任务已取消。");
      const [state] = await sql(
        "UPDATE tasks SET stage=$2,events=events||$3::jsonb WHERE id=$1 AND control_revision=$4 RETURNING cancel_requested",
        [
          id,
          s,
          JSON.stringify([{ stage: s, time: new Date().toISOString() }]),
          task.control_revision,
        ],
      );
      if (!state || state.cancel_requested)
        throw new HarvestError("CANCELED", "任务已取消。");
    };
    const snapshot = `${task.design_id}/snapshots/${task.snapshot_id}`,
      version = `${task.design_id}/versions/${task.version_id}`;
    try {
      const [generation] = await sql(
        "SELECT metadata FROM versions WHERE id=$1",
        [task.version_id],
      );
      const activeProvider = provider ?? modelProvider(generation?.metadata);
      let evidence: Evidence;
      if (await exists(snapshot + "/evidence.json"))
        evidence = await getJSON(snapshot + "/evidence.json");
      else {
        if (task.kind === "REGENERATE")
          throw new HarvestError(
            "EVIDENCE_FAILED",
            "该快照尚无完整证据，请先恢复原采集任务。",
          );
        evidence = await capture(
          task.canonical_url,
          snapshot,
          activeProvider,
          stage,
          controller.signal,
        );
      }
      await manifest(snapshot, { snapshotId: task.snapshot_id });
      const images = await visualInputs(snapshot);
      const { analysis, ios, critic, lint, displayZh, validation } =
        await generateDocuments({
          taskId: id,
          versionId: task.version_id,
          prefix: version,
          evidence,
          provider: activeProvider,
          images,
          signal: controller.signal,
          state: task.repair_state,
          controlRevision: task.control_revision,
          stage,
        });
      await stage("SAVING_ARTIFACTS");
      await putJSON(version + "/analysis.json", analysis);
      await sql("UPDATE versions SET analysis=$2 WHERE id=$1", [
        task.version_id,
        JSON.stringify(analysis),
      ]);
      await putJSON(version + "/ios-analysis.json", ios);
      await putJSON(version + "/critic.json", critic);
      await put(version + "/DESIGN.md", renderDesign(evidence, analysis!));
      await put(version + "/IOS_design.md", renderIOS(ios!));
      const ready = eligible(critic!, lint!.valid, true);
      const quality = ready ? "QUALIFIED" : "LOW_CONFIDENCE";
      const [meta] = await sql("SELECT metadata FROM versions WHERE id=$1", [
        task.version_id,
      ]);
      await manifest(version, {
        ...meta?.metadata,
        snapshotId: task.snapshot_id,
        language: "en",
        presentationLanguage: "zh-CN",
        validation,
        quality,
      });
      await stage("PUBLISHING");
      await connection.query("BEGIN");
      const current = (
        await connection.query(
          "SELECT cancel_requested,control_revision FROM tasks WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (
        !current ||
        current.cancel_requested ||
        current.control_revision !== task.control_revision
      )
        throw new HarvestError("CANCELED", "任务已取消。");
      await connection.query(
        "UPDATE versions SET score=$2,quality=$3,analysis=$4,display_zh=$5,validation=$6,metadata=metadata||$7::jsonb WHERE id=$1",
        [
          task.version_id,
          critic!.score,
          quality,
          JSON.stringify(analysis),
          JSON.stringify(displayZh),
          JSON.stringify(validation),
          JSON.stringify({
            language: "en",
            presentationLanguage: "zh-CN",
            pipeline: "1.1.0",
            prompt: "2.0",
          }),
        ],
      );
      if (ready)
        await connection.query(
          "UPDATE designs SET default_version_id=$2 WHERE id=$1 AND (default_version_id IS NULL OR (SELECT created_at FROM versions WHERE id=default_version_id)<(SELECT created_at FROM versions WHERE id=$2))",
          [task.design_id, task.version_id],
        );
      await connection.query(
        "UPDATE tasks SET status=$2,stage='COMPLETE',finished_at=now(),error=NULL WHERE id=$1",
        [id, ready ? "READY" : "PARTIAL"],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => {});
      const e =
        error instanceof HarvestError
          ? error
          : new HarvestError(
              "PIPELINE_FAILED",
              "处理失败，已完成的资产保留，可重试当前阶段。",
            );
      const status =
        controller.signal.aborted || e.code === "CANCELED"
          ? "CANCELED"
          : e.code === "MODEL_CONFIGURATION_REQUIRED"
            ? "WAITING_CONFIG"
            : e.code === "AUTH_REQUIRED"
              ? "WAITING_AUTH"
              : e.code === "QUOTA_EXHAUSTED"
                ? "WAITING_QUOTA"
                : "FAILED";
      const repairScheduled = e.code === "CONTENT_REPAIR_SCHEDULED";
      const transient =
        [
          "MODEL_TIMEOUT",
          "MODEL_SCHEMA_INVALID",
          "MODEL_FAILED",
          "PIPELINE_FAILED",
        ].includes(e.code) && task.attempts < 2;
      await sql(
        "UPDATE tasks SET status=$2,error=$3,retry_at=$4,attempts=attempts+CASE WHEN $5 THEN 0 ELSE 1 END,dispatched_at=NULL,finished_at=CASE WHEN $2='QUEUED' THEN NULL ELSE now() END WHERE id=$1 AND control_revision=$6 AND manual_status IS NULL",
        [
          id,
          transient || repairScheduled ? "QUEUED" : status,
          JSON.stringify({ code: e.code, message: e.message }),
          transient
            ? new Date(Date.now() + 30000 * 2 ** task.attempts)
            : e.retryAt || null,
          repairScheduled,
          task.control_revision,
        ],
      );
    } finally {
      await clearTiles(snapshot).catch(() => {});
    }
  } finally {
    if (timer) clearInterval(timer);
    await connection
      .query("SELECT pg_advisory_unlock(hashtext($1))", [id])
      .catch(() => {});
    connection.release();
  }
}
