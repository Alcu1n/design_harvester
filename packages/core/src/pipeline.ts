import { modelProvider } from "./provider.ts";
import { clearTiles } from "./storage.ts";
import { pool, sql } from "./db.ts";
import { capture, visualInputs } from "./browser.ts";
import { type DesignModelProvider } from "./model.ts";
import {
  AnalysisSchema,
  IOSSchema,
  CriticSchema,
  eligible,
  HarvestError,
  type Evidence,
  type Critic,
  type Analysis,
  type IOSAnalysis,
} from "./contracts.ts";
import { getJSON, putJSON, put, exists, manifest, files } from "./storage.ts";
import {
  renderDesign,
  renderIOS,
  lintDesign,
  validateAnalysis,
} from "./render.ts";
export async function processTask(
  id: string,
  provider?: DesignModelProvider,
) {
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
      task.cancel_requested
    )
      return;
    await sql(
      "UPDATE tasks SET status='RUNNING',heartbeat_at=now() WHERE id=$1",
      [id],
    );
    timer = setInterval(() => {
      void sql(
        "UPDATE tasks SET heartbeat_at=now() WHERE id=$1 RETURNING cancel_requested",
        [id],
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
        "UPDATE tasks SET stage=$2,events=events||$3::jsonb WHERE id=$1 RETURNING cancel_requested",
        [id, s, JSON.stringify([{ stage: s, time: new Date().toISOString() }])],
      );
      if (!state || state.cancel_requested)
        throw new HarvestError("CANCELED", "任务已取消。");
    };
    const snapshot = `${task.design_id}/snapshots/${task.snapshot_id}`,
      version = `${task.design_id}/versions/${task.version_id}`;
    try {
      const [generation] = await sql("SELECT metadata FROM versions WHERE id=$1", [task.version_id]);
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
      const cache = async <T>(
        name: string,
        fn: () => Promise<T>,
      ): Promise<T> => {
        if (await exists(version + "/" + name))
          return getJSON<T>(version + "/" + name);
        const value = await fn();
        await putJSON(version + "/" + name, value);
        return value;
      };
      let critic: Critic | undefined;
      let lint: ReturnType<typeof lintDesign> | undefined;
      let analysis: Analysis | undefined;
      let ios: IOSAnalysis | undefined;
      for (let revision = 0; revision < 2; revision++) {
        const folder = revision ? "revision-1/" : "revision-0/";
        await stage("ANALYZING_DESIGN");
        analysis = await cache(folder + "analysis.json", () =>
          activeProvider.generate(
            AnalysisSchema,
            "从浏览器证据和截图抽象设计语言，所有 signatureTraits 引用真实 element id。不要发明字体或数值；至少三条特征、三条 Do 和三条 Don’t。响应式仅描述三个实测视口之间的差异。",
            { evidence, revisionIssues: critic?.issues },
            images,
            controller.signal,
          ),
        );
        if (!validateAnalysis(evidence, analysis))
          throw new HarvestError(
            "MODEL_SCHEMA_INVALID",
            "分析引用了不存在的浏览器证据。",
          );
        await stage("GENERATING_DESIGN_MD");
        const markdown = renderDesign(evidence, analysis);
        lint = lintDesign(markdown);
        await put(version + "/" + folder + "DESIGN.md", markdown);
        await putJSON(version + "/" + folder + "lint.json", lint);
        await put(version + "/DESIGN.md", markdown);
        await putJSON(version + "/analysis.json", analysis);
        await sql("UPDATE versions SET analysis=$2 WHERE id=$1", [
          task.version_id,
          JSON.stringify(analysis),
        ]);
        if (!lint.valid)
          throw new HarvestError(
            "DESIGN_MD_INVALID",
            "设计文档未通过官方规范校验，原始证据已保留。",
          );
        await stage("ADAPTING_IOS");
        ios = await cache(folder + "ios-analysis.json", () =>
          activeProvider.generate(
            IOSSchema,
            "将设计意图适配到 iOS 17+ 的 SwiftUI 原生语言。覆盖全部章节。Dynamic Type、Safe Area、系统 Material、SF Symbols、无障碍和 Reduce Motion。Haptics 与暗色方案明确标注为建议，不是观察事实。未实测的对比度不得给出数值；颜色只能引用证据中的确定值，其余明确标为适配建议；链接用传入 URL 参数不硬编码证据外地址。示例标注 API 系统版本；禁止 CSS blur 机械映射为 SwiftUI blur。",
            { analysis, evidence, revisionIssues: critic?.issues },
            [],
            controller.signal,
          ),
        );
        await put(version + "/" + folder + "IOS_design.md", renderIOS(ios));
        await stage("QUALITY_REVIEW");
        critic = await cache(folder + "critic.json", () =>
          activeProvider.generate(
            CriticSchema,
            "独立审核字体和颜色是否忠于证据、至少三条独特设计特征、响应式描述、iOS 原生适配。字体 CSS 声明与实际渲染字体应区分，不能声称知道未观察交互。Web token 是代码保存的桌面视口实测值，保留小数或视口相关值本身不是错误，不得要求模型修改这些观察值。检查相对布局是否在正文说明。iOS 新数值若明确标为适配建议则不是观察事实。发现伪装为实测的臆造数值或 iOS 机械 CSS 翻译时 severity=error。",
            { evidence, analysis, ios, design: markdown, lint },
            images,
            controller.signal,
          ),
        );
        if (critic.score < 70 || critic.score >= 85 || revision === 1) break;
      }
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
        quality,
      });
      await stage("PUBLISHING");
      await connection.query("BEGIN");
      const current = (
        await connection.query(
          "SELECT cancel_requested FROM tasks WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!current || current.cancel_requested)
        throw new HarvestError("CANCELED", "任务已取消。");
      await connection.query(
        "UPDATE versions SET score=$2,quality=$3,analysis=$4 WHERE id=$1",
        [task.version_id, critic!.score, quality, JSON.stringify(analysis)],
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
      const transient =
        [
          "MODEL_TIMEOUT",
          "MODEL_SCHEMA_INVALID",
          "MODEL_FAILED",
          "PIPELINE_FAILED",
        ].includes(e.code) && task.attempts < 2;
      await sql(
        "UPDATE tasks SET status=$2,error=$3,retry_at=$4,attempts=attempts+1,dispatched_at=NULL,finished_at=now() WHERE id=$1",
        [
          id,
          transient ? "QUEUED" : status,
          JSON.stringify({ code: e.code, message: e.message }),
          transient
            ? new Date(Date.now() + 30000 * 2 ** task.attempts)
            : e.retryAt || null,
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
