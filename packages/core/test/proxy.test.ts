import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createEgressProxy } from "../src/proxy.ts";
test("egress denies private HTTP and CONNECT destinations", async () => {
  const server = createEgressProxy();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    for (const url of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: url },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.on("error", reject);
        req.end();
      });
      assert.equal(status, 403, url);
    }
    for (const host of ["127.0.0.1:443", "[::1]:443", "example.com:22"]) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({
          host: "127.0.0.1",
          port,
          path: host,
          method: "CONNECT",
        });
        req.on("connect", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode!);
        });
        req.on("error", reject);
        req.end();
      });
      assert.equal(status, 403, host);
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
