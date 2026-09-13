import {
  mkdir,
  readFile,
  writeFile,
  rename,
  stat,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const root = path.resolve(
  /*turbopackIgnore: true*/ process.env.LIBRARY_PATH ||
    path.resolve(process.cwd(), "../../.data/library"),
);
export function safePath(key: string) {
  const p = path.resolve(root, key);
  if (p !== root && !p.startsWith(root + path.sep))
    throw new Error("Invalid asset path");
  return p;
}
export async function put(key: string, body: string | Buffer) {
  const p = safePath(key);
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = p + "." + randomUUID() + ".tmp";
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, p);
}
export const get = (key: string) =>
  readFile(/*turbopackIgnore: true*/ safePath(key));
export async function exists(key: string) {
  try {
    await stat(/*turbopackIgnore: true*/ safePath(key));
    return true;
  } catch {
    return false;
  }
}
export const putJSON = (key: string, x: unknown) =>
  put(key, JSON.stringify(x, null, 2));
export async function getJSON<T = any>(key: string): Promise<T> {
  return JSON.parse((await get(key)).toString());
}
export async function files(prefix: string): Promise<string[]> {
  try {
    const entries = await readdir(/*turbopackIgnore: true*/ safePath(prefix), {
      withFileTypes: true,
    });
    return (
      await Promise.all(
        entries
          .filter((e) => !e.name.endsWith(".tmp"))
          .map((e) =>
            e.isDirectory()
              ? files(prefix + "/" + e.name)
              : [prefix + "/" + e.name],
          ),
      )
    ).flat();
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
export async function manifest(prefix: string, metadata: unknown) {
  const entries = await Promise.all(
    (await files(prefix))
      .filter((f) => !f.endsWith("/manifest.json") && !f.includes("/tiles/"))
      .map(async (f) => {
        const b = await get(f);
        return {
          path: f.slice(prefix.length + 1),
          bytes: b.length,
          sha256: createHash("sha256").update(b).digest("hex"),
        };
      }),
  );
  await putJSON(prefix + "/manifest.json", {
    schemaVersion: "1.0",
    metadata,
    files: entries,
  });
}
export async function removeDesign(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid id");
  await rm(safePath(id), { recursive: true, force: true });
}
export async function diskUsage() {
  let total = 0;
  for (const f of await files("."))
    total += (await stat(/*turbopackIgnore: true*/ safePath(f))).size;
  return total;
}

export async function clearTiles(prefix: string) {
  await rm(safePath(prefix + "/tiles"), { recursive: true, force: true });
}
