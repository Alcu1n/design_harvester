import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  HarvestError,
  ImageEvidenceSchema,
  type Evidence,
} from "./contracts.ts";
import { getJSON, put, putJSON, exists } from "./storage.ts";
import { sql, transaction } from "./db.ts";
import { getModelConfig } from "./model-settings.ts";
import { versionsMetadata } from "./service.ts";
export const importRoot = path.resolve(
  process.env.IMPORT_PATH || path.resolve(process.cwd(), "../../.data/imports"),
);
export const imageLimits = {
  count: 10,
  file: 10 * 1024 * 1024,
  total: 50 * 1024 * 1024,
  pixels: 40_000_000,
};
const uuid = /^[0-9a-f-]{36}$/;
function importPath(id: string) {
  if (!uuid.test(id)) throw new Error("Invalid import ID");
  return path.join(importRoot, id);
}
export async function validateImage(bytes: Buffer) {
  if (bytes.length > imageLimits.file)
    throw new HarvestError("UPLOAD_INVALID", "每张图片不能超过 10 MiB。");
  let m: sharp.Metadata;
  try {
    m = await sharp(bytes, {
      limitInputPixels: imageLimits.pixels,
      failOn: "error",
    }).metadata();
  } catch {
    throw new HarvestError(
      "UPLOAD_INVALID",
      "图片损坏、格式不支持或像素超过限制。",
    );
  }
  if (
    !["png", "jpeg", "webp"].includes(m.format || "") ||
    (m.pages || 1) > 1 ||
    !m.width ||
    !m.height ||
    m.width * m.height > imageLimits.pixels
  )
    throw new HarvestError(
      "UPLOAD_INVALID",
      "仅支持静态 PNG、JPEG、WebP，最多 4000 万像素。",
    );
  return {
    width: m.width,
    height: m.height,
    ext: m.format === "jpeg" ? "jpg" : m.format!,
  };
}
export async function createImageRun(files: File[], title = "", context = "") {
  if (!files.length || files.length > imageLimits.count)
    throw new HarvestError("UPLOAD_INVALID", "请选择 1–10 张图片。");
  if (files.reduce((n, f) => n + f.size, 0) > imageLimits.total)
    throw new HarvestError("UPLOAD_INVALID", "图片总大小不能超过 50 MiB。");
  if (title.length > 120 || context.length > 2000)
    throw new HarvestError(
      "UPLOAD_INVALID",
      "名称最多 120 字，背景说明最多 2000 字。",
    );
  const importId = randomUUID(),
    did = randomUUID(),
    sid = randomUUID(),
    vid = randomUUID(),
    rid = randomUUID();
  const dir = importPath(importId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const images = [];
  try {
    for (let i = 0; i < files.length; i++) {
      if (files[i].size > imageLimits.file)
        throw new HarvestError("UPLOAD_INVALID", "每张图片不能超过 10 MiB。");
      const bytes = Buffer.from(await files[i].arrayBuffer()),
        m = await validateImage(bytes);
      const original = `original-${i + 1}.${m.ext}`,
        preview = `preview-${i + 1}.webp`,
        model = `model-${i + 1}.png`;
      await writeFile(path.join(dir, original), bytes, { mode: 0o600 });
      await sharp(bytes, { limitInputPixels: imageLimits.pixels })
        .rotate()
        .resize({
          width: 1800,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 88 })
        .toFile(path.join(dir, preview));
      await sharp(bytes, { limitInputPixels: imageLimits.pixels })
        .rotate()
        .resize({
          width: 1536,
          height: 2048,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toFile(path.join(dir, model));
      images.push({
        id: `image-${i + 1}`,
        name: files[i].name.slice(0, 255),
        path: original,
        preview,
        modelPath: model,
        width: m.width,
        height: m.height,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const data = ImageEvidenceSchema.parse({
      schemaVersion: "1.0",
      kind: "images",
      source: { url: "", finalUrl: "", capturedAt: new Date().toISOString() },
      context,
      viewports: [],
      images,
      warnings: [],
    });
    await writeFile(path.join(dir, "evidence.json"), JSON.stringify(data), {
      mode: 0o600,
    });
    const config = await getModelConfig();
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO designs(id,canonical_url,source_kind,title) VALUES($1,NULL,'images',$2)",
        [did, title.trim() || null],
      );
      await c.query(
        "INSERT INTO snapshots(id,design_id,import_id,source_metadata) VALUES($1,$2,$3,$4)",
        [
          sid,
          did,
          importId,
          JSON.stringify({ kind: "images", count: images.length }),
        ],
      );
      await c.query(
        "INSERT INTO versions(id,design_id,snapshot_id,metadata) VALUES($1,$2,$3,$4)",
        [vid, did, sid, JSON.stringify(versionsMetadata(config))],
      );
      await c.query(
        "INSERT INTO tasks(id,design_id,snapshot_id,version_id,kind) VALUES($1,$2,$3,$4,'IMAGE_IMPORT')",
        [rid, did, sid, vid],
      );
    });
    return { designId: did, runId: rid, status: "QUEUED" };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}
export async function archiveImages(
  snapshot: string,
  snapshotId: string,
): Promise<Evidence> {
  if (await exists(snapshot + "/evidence.json"))
    return getJSON(snapshot + "/evidence.json");
  const [row] = await sql("SELECT import_id FROM snapshots WHERE id=$1", [
    snapshotId,
  ]);
  if (!row?.import_id)
    throw new HarvestError("EVIDENCE_FAILED", "上传图片尚未归档，请重新上传。");
  const dir = importPath(row.import_id);
  const e = ImageEvidenceSchema.parse(
    JSON.parse(
      await readFile(path.join(dir, "evidence.json"), "utf8").catch(() => {
        throw new HarvestError(
          "EVIDENCE_FAILED",
          "上传暂存已清理，请重新上传图片。",
        );
      }),
    ),
  );
  for (const image of e.images) {
    for (const key of ["path", "preview", "modelPath"] as const) {
      const filename = image[key];
      if (path.basename(filename) !== filename)
        throw new HarvestError("EVIDENCE_FAILED", "上传记录路径无效。");
      const target = `images/${filename}`;
      await put(
        snapshot + "/" + target,
        await readFile(path.join(dir, filename)),
      );
      image[key] = target;
    }
  }
  await putJSON(snapshot + "/evidence.json", e); // Commit marker written only after every image is durable.
  await sql("UPDATE snapshots SET import_id=NULL WHERE id=$1", [snapshotId]);
  await rm(dir, { recursive: true, force: true });
  return e;
}
let lastCleanup = 0;
export async function cleanupImports() {
  if (Date.now() - lastCleanup < 60_000) return;
  lastCleanup = Date.now();
  for (const name of await readdir(importRoot).catch(() => [])) {
    if (!uuid.test(name)) continue;
    const [reference] = await sql(
      "SELECT s.id FROM snapshots s JOIN tasks t ON t.snapshot_id=s.id WHERE s.import_id=$1 AND t.status IN ('QUEUED','RUNNING','WAITING_AUTH','WAITING_QUOTA','WAITING_CONFIG') LIMIT 1",
      [name],
    );
    if (reference) continue;
    const [linked] = await sql("SELECT id FROM snapshots WHERE import_id=$1", [
      name,
    ]);
    const age = Date.now() - (await stat(importPath(name))).mtimeMs;
    if (linked || age > 24 * 60 * 60 * 1000)
      await rm(importPath(name), { recursive: true, force: true });
  }
}
