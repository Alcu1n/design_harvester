import { writeFile, mkdtemp, copyFile, chmod, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const releases = {
  arm64: {
    url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.2.2-6061403484848128/linux-arm/cli_linux_arm64.tar.gz",
    sha512:
      "a1645a30f36b767c7534c2f6a53e99a9bfade993267efcca715f7a45d797d47d6561df787e9d4a51a3bdfc9be855d49d23fa3f4b91b2c661fd17314050836048",
  },
  x64: {
    url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.2.2-6061403484848128/linux-x64/cli_linux_x64.tar.gz",
    sha512:
      "74342cf2a78b344392e573b638a648a6ad1f8e877f494b96e20f9c2b79158d5c423c40b2dcf788703362bb0a9150f09c707fde599d7557ce01c12208802a63cb",
  },
};
const release = releases[process.arch];
if (!release) throw new Error("Unsupported architecture");
const response = await fetch(release.url);
if (!response.ok) throw new Error("CLI download failed");
const data = Buffer.from(await response.arrayBuffer());
if (createHash("sha512").update(data).digest("hex") !== release.sha512)
  throw new Error("CLI checksum mismatch");
const tmp = await mkdtemp(path.join(tmpdir(), "install-agy-"));
try {
  const archive = path.join(tmp, "cli.tar.gz");
  await writeFile(archive, data);
  execFileSync("tar", ["-xzf", archive, "-C", tmp]);
  await copyFile(path.join(tmp, "antigravity"), "/usr/local/bin/agy");
  await chmod("/usr/local/bin/agy", 0o755);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
