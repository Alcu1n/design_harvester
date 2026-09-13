import http from "node:http";
import net from "node:net";
import { resolvePublic } from "./security.ts";
export function createEgressProxy() {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "");
      if (
        u.protocol !== "http:" ||
        u.username ||
        u.password ||
        (u.port && u.port !== "80")
      )
        throw Error("Invalid target");
      const [address] = await resolvePublic(u.hostname);
      const headers: http.OutgoingHttpHeaders = {
        ...req.headers,
        host: u.host,
      };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request(
        {
          host: address.address,
          family: address.family,
          port: 80,
          path: u.pathname + u.search,
          method: req.method,
          headers,
          timeout: 30000,
        },
        (r) => {
          res.writeHead(r.statusCode || 502, r.headers);
          r.pipe(res);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end("Public HTTP(S) destinations only");
    }
  });
  server.on("connect", async (req, client, head) => {
    try {
      const u = new URL("https://" + req.url);
      if ((u.port && u.port !== "443") || u.username || u.password)
        throw Error("Invalid port");
      const [address] = await resolvePublic(u.hostname);
      const upstream = net.connect({
        host: address.address,
        family: address.family,
        port: 443,
      });
      upstream.setTimeout(60000, () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  server.on("upgrade", (_req, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"),
  );
  return server;
}
if (process.argv[1]?.endsWith("/proxy.ts"))
  createEgressProxy().listen(Number(process.env.PORT || 3128), "0.0.0.0");
