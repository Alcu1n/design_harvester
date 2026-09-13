import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const temporary = mkdtempSync(path.join(tmpdir(), "harvester-integration-"));
const env = {
  ...process.env,
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ||
    "postgresql://harvester:harvester@127.0.0.1:5432/harvester_test",
  LIBRARY_PATH: temporary,
  INTEGRATION: "1",
};
try {
  for (const args of [
    ["--filter", "@harvester/core", "exec", "tsx", "src/migrate.ts"],
    [
      "--filter",
      "@harvester/core",
      "exec",
      "tsx",
      "--test",
      "test/integration.test.ts",
    ],
  ]) {
    const r = spawnSync("pnpm", args, { env, stdio: "inherit" });
    if (r.status !== 0) {
      process.exitCode = 1;
      break;
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
