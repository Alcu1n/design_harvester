import { chromium } from "playwright";
const server = await chromium.launchServer({
  host: "0.0.0.0",
  port: 3001,
  wsPath: "harvester",
  headless: true,
  proxy: { server: "http://egress:3128", bypass: "<-loopback>" },
  args: [
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ],
});
console.log("Browser ready");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void server.close().then(() => process.exit(0)));
