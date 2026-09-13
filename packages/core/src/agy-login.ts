import { spawn } from "node:child_process";
import {
  prepareAGY,
  agyHome,
  agyEnvironment,
  agyBinary,
} from "./antigravity.ts";
await prepareAGY();
const child = spawn(agyBinary(), [], {
  cwd: agyHome,
  env: agyEnvironment(),
  stdio: "inherit",
});
child.on("error", () => {
  console.error("无法启动 Antigravity CLI");
  process.exit(1);
});
child.on("exit", (code) => process.exit(code || 0));
