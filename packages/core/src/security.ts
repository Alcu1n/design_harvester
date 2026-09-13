import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { HarvestError } from "./contracts.ts";
export function canonicalize(input: string) {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new HarvestError(
      "INVALID_URL",
      "请输入完整的 http 或 https 网站地址。",
    );
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hostname.endsWith(".local") ||
    u.hostname === "localhost"
  )
    throw new HarvestError(
      "INVALID_URL",
      "仅支持无账号信息的公共 HTTP(S) 网站。",
    );
  if (u.port && !["80", "443"].includes(u.port))
    throw new HarvestError("INVALID_URL", "仅支持标准网站端口 80 和 443。");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host) && !publicIP(host))
    throw new HarvestError(
      "PRIVATE_NETWORK_BLOCKED",
      "该地址指向私有或保留网络，已阻止访问。",
    );
  u.hash = "";
  return u.href;
}
export function publicIP(address: string) {
  try {
    let ip = ipaddr.parse(address.replace(/^\[|\]$/g, ""));
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublic(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = ipaddr.isValid(host)
      ? [
          {
            address: host,
            family: ipaddr.parse(host).kind() === "ipv6" ? 6 : 4,
          },
        ]
      : await lookup(host, { all: true });
  } catch {
    throw new HarvestError("DNS_ERROR", "无法解析网站域名。");
  }
  if (!addresses.length || addresses.some((x) => !publicIP(x.address)))
    throw new HarvestError(
      "PRIVATE_NETWORK_BLOCKED",
      "该地址指向私有或保留网络，已阻止访问。",
    );
  return addresses;
}
export async function validateURL(input: string) {
  const url = canonicalize(input);
  await resolvePublic(new URL(url).hostname);
  return url;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (!origin || origin !== expected)
    throw new HarvestError("FORBIDDEN", "请求来源不受信任，请从应用页面操作。");
}
