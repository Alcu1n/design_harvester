import { createImageRun } from "@harvester/core/image-import";
import { queuePresentation } from "@harvester/core/presentation-job";
import {
  getModelConfig,
  saveModelConfig,
  hasSavedDeepSeekKey,
} from "@harvester/core/model-settings";
import { NextRequest } from "next/server";
import {
  CreateSchema,
  UpdateSchema,
  HarvestError,
} from "@harvester/core/contracts";
import {
  createRun,
  listDesigns,
  detail,
  resume,
  cancel,
  deleteDesign,
  updateDesign,
  setTaskStatus,
} from "@harvester/core/service";
import { sql } from "@harvester/core/db";
import { sameOrigin } from "@harvester/core/security";
import {
  get,
  getJSON,
  exists,
  files,
  root,
  diskUsage,
} from "@harvester/core/storage";
import { tokenDiff } from "@harvester/core/render";
import { ZipFile } from "yazl";
import { PassThrough } from "node:stream";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (x: unknown, status = 200) =>
  Response.json(x, { status, headers: { "Cache-Control": "no-store" } });
let uploading = false;
async function handler(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: p } = await context.params;
    const method = req.method;
    if (method !== "GET") sameOrigin(req);
    for (const segment of p)
      if (segment === ".." || segment.includes("\\") || segment.includes("/"))
        throw new HarvestError("NOT_FOUND", "路径不存在。");
    if (
      p[0] === "designs" &&
      p[1] === "images" &&
      p.length === 2 &&
      method === "POST"
    ) {
      if (uploading)
        throw new HarvestError("CONFLICT", "正在处理另一批图片，请稍后再试。");
      uploading = true;
      try {
        const reader = req.body?.getReader();
        if (!reader) throw new HarvestError("UPLOAD_INVALID", "请选择图片。");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 52 * 1024 * 1024) {
              await reader.cancel();
              throw new HarvestError(
                "UPLOAD_INVALID",
                "上传内容超过大小限制。",
              );
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const form = await new Response(Buffer.concat(chunks), {
          headers: { "Content-Type": req.headers.get("content-type") || "" },
        }).formData();
        const images = form.getAll("images");
        if (images.some((x) => typeof x === "string"))
          throw new HarvestError("UPLOAD_INVALID", "图片格式无效。");
        return json(
          await createImageRun(
            images as File[],
            String(form.get("title") || ""),
            String(form.get("context") || ""),
          ),
          202,
        );
      } finally {
        uploading = false;
      }
    }
    if (p[1] && ["designs", "harvest-runs"].includes(p[0]) && !uuid.test(p[1]))
      throw new HarvestError("NOT_FOUND", "标识无效。");
    if (p[0] === "designs" && p.length === 1) {
      if (method === "GET")
        return json(await listDesigns(req.nextUrl.searchParams));
      if (method === "POST") {
        const body = CreateSchema.parse(await req.json());
        return json(await createRun(body.url), 202);
      }
    }
    if (p[0] === "designs" && p[1]) {
      const d = await detail(p[1]);
      if (p.length === 2) {
        if (method === "GET") return json(d);
        if (method === "PATCH") {
          const b = UpdateSchema.parse(await req.json());
          await updateDesign(p[1], b);
          return json({ ok: true });
        }
        if (method === "DELETE") {
          await deleteDesign(p[1]);
          return json({ ok: true }, 202);
        }
      }
      if (p[2] === "harvest" && method === "POST")
        return json(await createRun(d.canonical_url, d.id), 202);
      if (
        p[2] === "versions" &&
        uuid.test(p[3] || "") &&
        p[4] === "presentation" &&
        p.length === 5 &&
        method === "POST"
      )
        return json(await queuePresentation(d.id, p[3]), 202);
      if (p[2] === "versions" && method === "GET") return json(d.versions);
      if (p[2] === "compare" && method === "GET") {
        const a = d.versions.find(
            (v: any) => v.id === req.nextUrl.searchParams.get("a"),
          ),
          b = d.versions.find(
            (v: any) => v.id === req.nextUrl.searchParams.get("b"),
          );
        if (!a || !b) throw new HarvestError("NOT_FOUND", "请选择两个版本。");
        return json(
          tokenDiff(
            await getJSON(`${d.id}/snapshots/${a.snapshot_id}/evidence.json`),
            await getJSON(`${d.id}/snapshots/${b.snapshot_id}/evidence.json`),
          ),
        );
      }
      if (p[2] === "export" && method === "GET") {
        const version = d.versions.find(
          (v: any) =>
            v.id ===
            (req.nextUrl.searchParams.get("version") ||
              d.default_version_id ||
              d.versions[0]?.id),
        );
        if (!version) throw new HarvestError("NOT_FOUND", "暂无可导出的版本。");
        const prefixes = [
          `${d.id}/snapshots/${version.snapshot_id}`,
          `${d.id}/versions/${version.id}`,
        ];
        const zip = new ZipFile();
        const stream = new ReadableStream({
          start(controller) {
            zip.outputStream.on("data", (b) => controller.enqueue(b));
            zip.outputStream.on("end", () => controller.close());
            zip.outputStream.on("error", (e) => controller.error(e));
          },
          cancel() {
            (zip.outputStream as PassThrough).destroy();
          },
        });
        void (async () => {
          try {
            for (const prefix of prefixes)
              for (const f of await files(prefix)) {
                if (f.includes("/tiles/")) continue;
                zip.addBuffer(await get(f), f.slice(d.id.length + 1));
              }
            zip.addBuffer(
              Buffer.from(
                JSON.stringify(
                  {
                    id: d.id,
                    url: d.canonical_url,
                    sourceKind: d.source_kind,
                    title: d.title,
                    notes: d.notes,
                    tags: d.tags,
                    version,
                  },
                  null,
                  2,
                ),
              ),
              "design.json",
            );
            zip.end();
          } catch (e) {
            (zip.outputStream as PassThrough).destroy(e as Error);
          }
        })();
        return new Response(stream, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="design-${d.id}.zip"`,
            "Cache-Control": "no-store",
          },
        });
      }
    }
    if (p[0] === "harvest-runs" && p[1]) {
      const [t] = await sql("SELECT * FROM tasks WHERE id=$1", [p[1]]);
      if (!t) throw new HarvestError("NOT_FOUND", "任务不存在。");
      if (p.length === 2 && method === "GET") return json(t);
      if (method === "POST") {
        if (p[2] === "status") {
          const body = await req.json();
          if (!["READY", "FAILED"].includes(body?.status))
            throw new HarvestError("CONFLICT", "请选择已完成或失败。");
          await setTaskStatus(t.id, body.status);
          return json({ ok: true });
        }
        if (p[2] === "resume") {
          await resume(t.id);
          return json({ ok: true }, 202);
        }
        if (p[2] === "cancel") {
          await cancel(t.id);
          return json({ ok: true }, 202);
        }
        if (p[2] === "regenerate") {
          const [d] = await sql("SELECT * FROM designs WHERE id=$1", [
            t.design_id,
          ]);
          return json(
            await createRun(d.canonical_url, d.id, t.snapshot_id),
            202,
          );
        }
      }
    }
    if (p[0] === "assets" && method === "GET") {
      if (!uuid.test(p[1] || ""))
        throw new HarvestError("NOT_FOUND", "资产不存在。");
      const design = await detail(p[1]);
      const key = p.slice(1).join("/");
      const allowed = /\.(png|jpg|jpeg|webp|json|md)$/i.test(key);
      const score =
        p.length === 5 && p[2] === "versions" && p[4] === "quality-score.json"
          ? design.versions.find((v: any) => v.id === p[3])?.metadata
              ?.scoringResult
          : undefined;
      if (!allowed || (!score && !(await exists(key))))
        throw new HarvestError("NOT_FOUND", "资产尚未生成。");
      const b = score
        ? Buffer.from(JSON.stringify(score, null, 2))
        : await get(key);
      const ext = key.split(".").pop();
      const mime =
        ext === "png"
          ? "image/png"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "webp"
              ? "image/webp"
              : ext === "json"
                ? "application/json; charset=utf-8"
                : "text/plain; charset=utf-8";
      return new Response(new Uint8Array(b), {
        headers: {
          "Content-Type": mime,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=60",
          ...(req.nextUrl.searchParams.has("download")
            ? { "Content-Disposition": `attachment; filename="${p.at(-1)}"` }
            : {}),
        },
      });
    }
    if (p[0] === "settings" && p.length === 1) {
      if (method === "PATCH")
        return json(await saveModelConfig(await req.json()));
      if (method === "GET") {
        const config = await getModelConfig();
        const auth = (await exists(".system/auth.json"))
          ? await getJSON(".system/auth.json")
          : {};
        const savedKey = await hasSavedDeepSeekKey();
        const connections = {
          ...auth.connections,
          deepseek: savedKey || Boolean(auth.connections?.deepseek),
        };
        return json({
          ...config,
          connections,
          authCached:
            config.provider === "deepseek"
              ? connections.deepseek
              : config.provider === auth.provider
                ? Boolean(auth.cached)
                : Boolean(connections.gemini),
          storage: root,
          bytes: await diskUsage(),
          paidFallback: false,
        });
      }
    }
    return json({ error: "接口不存在" }, 404);
  } catch (e: any) {
    if (e instanceof HarvestError)
      return json(
        { error: e.message, code: e.code },
        e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400,
      );
    if (e.name === "ZodError")
      return json({ error: "输入格式不正确，请检查后重试。" }, 400);
    console.error("api_error", e?.message);
    return json({ error: "服务暂不可用，请检查数据库和后台服务。" }, 503);
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
