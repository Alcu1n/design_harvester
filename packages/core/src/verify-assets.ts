import { createHash } from "node:crypto";
import { files, getJSON, get } from "./storage.ts";
let checked = 0;
for (const file of await files(".")) {
  if (!file.endsWith("/manifest.json")) continue;
  const manifest = await getJSON(file);
  const prefix = file.slice(0, -"/manifest.json".length);
  for (const entry of manifest.files) {
    const data = await get(prefix + "/" + entry.path);
    if (
      createHash("sha256").update(data).digest("hex") !== entry.sha256 ||
      data.length !== entry.bytes
    )
      throw new Error("Asset mismatch: " + prefix + "/" + entry.path);
    checked++;
  }
}
console.log("Verified assets:", checked);
