import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { authHome, cliSettings } from "./model.ts";
await mkdir(path.join(authHome, ".gemini"), { recursive: true });
await writeFile(
  path.join(authHome, ".gemini/settings.json"),
  JSON.stringify(cliSettings),
  { mode: 0o600 },
);
const child = spawn(process.env.GEMINI_BIN || "gemini", ["-e", "none"], {
  cwd: authHome,
  env: {
    PATH: process.env.PATH,
    HOME: authHome,
    TERM: process.env.TERM || "xterm-256color",
    ...(process.argv.includes("--browser") ? {} : { NO_BROWSER: "true" }),
    LANG: "en_US.UTF-8",
    HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy,
    HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy,
  },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code || 0));
