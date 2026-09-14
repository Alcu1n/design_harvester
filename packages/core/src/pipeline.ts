import { archiveImages } from "./image-import.ts";
import { processPresentation } from "./presentation-job.ts";
import { safePath } from "./storage.ts";
import { generateDocuments } from "./generation.ts";
import { modelProvider } from "./provider.ts";
import { clearTiles } from "./storage.ts";
import { pool, sql } from "./db.ts";
import { capture, visualInputs } from "./browser.ts";
import { type DesignModelProvider } from "./model.ts";
import {
  CriticSchema,
  HarvestError,
  isImageEvidence,
  type Evidence,
} from "./contracts.ts";
import { getJSON, putJSON, put, exists, manifest, get } from "./storage.ts";
import { fallbackQuality } from "./quality.ts";
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
      if (task.kind === "PRESENTATION") {
        await processPresentation(task, stage, controller.signal, provider);
        return;
      }
      const [design] = await sql(
        "SELECT source_kind FROM designs WHERE id=$1",
        [task.design_id],
      );
      const [generation] = await sql(
        "SELECT metadata FROM versions WHERE id=$1",
        [task.version_id],
      );
      const activeProvider = provider ?? modelProvider(generation?.metadata);
      let evidence: Evidence;
      if (await exists(snapshot + "/evidence.json"))
        evidence = await getJSON(snapshot + "/evidence.json");
      else if (design?.source_kind === "images") {
        await stage("IMPORTING_IMAGES");
        evidence = await archiveImages(snapshot, task.snapshot_id);
      } else {
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
      const images = isImageEvidence(evidence)
        ? evidence.images.map((i) => safePath(snapshot + "/" + i.modelPath))
        : await visualInputs(snapshot);
      const { analysis, ios, critic, displayZh, validation } =
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
      if (ios) await putJSON(version + "/ios-analysis.json", ios);
      await putJSON(version + "/critic.json", critic);
      const quality = "SCORED";
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
        scoringMethod: critic.method,
        officialLint: "disabled",
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
            pipeline: "1.3.0",
            officialLint: "disabled",
            scoringMethod: critic.method,
            prompt: "3.0",
          }),
        ],
      );
      await connection.query(
        "UPDATE designs SET default_version_id=$2 WHERE id=$1 AND (default_version_id IS NULL OR (SELECT created_at FROM versions WHERE id=default_version_id)<(SELECT created_at FROM versions WHERE id=$2))",
        [task.design_id, task.version_id],
      );
      await connection.query(
        "UPDATE tasks SET status=$2,stage='COMPLETE',finished_at=now(),error=NULL WHERE id=$1",
        [id, "READY"],
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
      if (task.kind === "PRESENTATION") {
        const status =
          e.code === "CANCELED"
            ? "CANCELED"
            : e.code === "AUTH_REQUIRED"
              ? "WAITING_AUTH"
              : e.code === "QUOTA_EXHAUSTED"
                ? "WAITING_QUOTA"
                : "FAILED";
        await sql(
          "UPDATE tasks SET status=$2,error=$3,finished_at=now() WHERE id=$1 AND control_revision=$4",
          [
            id,
            status,
            JSON.stringify({ code: e.code, message: e.message }),
            task.control_revision,
          ],
        );
        await sql(
          "UPDATE versions SET presentation_state=$2 WHERE id=$1 AND presentation_state->>'runId'=$3",
          [
            task.version_id,
            JSON.stringify({ status, message: e.message, runId: id }),
            id,
          ],
        );
        return;
      }
      // Scoring is independent of completion, cancellation and provider availability.
      const read = async (name: string) => {
        try {
          return await getJSON(version + "/" + name);
        } catch {
          return undefined;
        }
      };
      const markdown = await get(version + "/DESIGN.md")
        .then((b) => b.toString())
        .catch(() => "");
      const prior = await read("critic.json");
      const score =
        CriticSchema.safeParse(prior).success &&
        prior.method !== "deterministic-completeness-v1"
          ? prior
          : fallbackQuality({
              analysis: await read("analysis.json"),
              ios: await read("ios-analysis.json"),
              evidence: await getJSON<Evidence>(
                snapshot + "/evidence.json",
              ).catch(() => undefined),
              markdown,
              reason: e.message,
            });
      await connection.query("BEGIN");
      const current = (
        await connection.query(
          "SELECT control_revision,manual_status,cancel_requested FROM tasks WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (
        !current ||
        current.control_revision !== task.control_revision ||
        current.manual_status
      ) {
        await connection.query("ROLLBACK");
        return;
      }
      await putJSON(version + "/critic.json", score);
      await connection.query(
        "UPDATE versions SET score=$2,quality='SCORED',metadata=metadata||$3::jsonb WHERE id=$1",
        [
          task.version_id,
          score.score,
          JSON.stringify({
            scoringMethod: score.method,
            officialLint: "disabled",
          }),
        ],
      );
      if (
        markdown.trim() &&
        !current.cancel_requested &&
        !controller.signal.aborted &&
        e.code !== "CANCELED"
      ) {
        const validation = {
          advisory: true,
          valid: false,
          officialLint: "disabled",
          issues: [{ path: "pipeline", message: e.message }],
        };
        await putJSON(version + "/validation.json", validation);
        await connection.query(
          "UPDATE versions SET validation=$2 WHERE id=$1",
          [task.version_id, JSON.stringify(validation)],
        );
        await manifest(version, {
          quality: "SCORED",
          scoringMethod: score.method,
          validation,
        });
        await connection.query(
          "UPDATE tasks SET status='READY',stage='COMPLETE',finished_at=now(),retry_at=NULL,error=NULL,events=events||$2::jsonb WHERE id=$1",
          [
            id,
            JSON.stringify([
              {
                stage: "CONTENT_CHECK_FAILED",
                issues: validation.issues,
                time: new Date().toISOString(),
              },
            ]),
          ],
        );
        await connection.query(
          "UPDATE designs SET default_version_id=$2 WHERE id=$1 AND (default_version_id IS NULL OR (SELECT created_at FROM versions WHERE id=default_version_id)<(SELECT created_at FROM versions WHERE id=$2))",
          [task.design_id, task.version_id],
        );
        await connection.query("COMMIT");
        return;
      }
      await connection.query("COMMIT");
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
