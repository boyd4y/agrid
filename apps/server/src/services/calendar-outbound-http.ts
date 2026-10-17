import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { calendarEndpointSchema } from "@tabdo/shared";
import type { CalendarOutbound, CalendarSendResult } from "../business/calendar/outbound.js";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList(); globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) blocked.addSubnet(address, prefix, "ipv6");
export function isPublicCalendarAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
/** DNS is resolved once per attempt. All answers must be public; the connection uses only the pinned answer.
 * TLS still verifies the original hostname. No proxy, redirect, pooled socket or second DNS resolution.
 */
export function createCalendarHttpSender(options: {
  resolve?: typeof lookup;
  request?: typeof request;
  timeoutMs?: number;
  responseLimit?: number;
} = {}): CalendarOutbound["send"] {
  const resolve = options.resolve ?? lookup, connect = options.request ?? request;
  const timeoutMs = options.timeoutMs ?? 10_000, responseLimit = options.responseLimit ?? 64 * 1024;
  return input => new Promise<CalendarSendResult>(resolveResult => {
    let settled = false, responseStatus: number | null = null, abort: (() => void) | undefined;
    const finish = (result: CalendarSendResult) => { if (settled) return; settled = true; clearTimeout(timer); resolveResult(result); };
    const timer = setTimeout(() => { finish({ httpStatus: responseStatus, error: "timeout" }); abort?.(); }, timeoutMs);
    void (async () => {
      if (!calendarEndpointSchema.safeParse(input.endpoint).success) { finish({ httpStatus: null, error: "destination_rejected", permanent: true }); return; }
      const url = new URL(input.endpoint), hostname = url.hostname;
      if (isIP(hostname) || hostname.includes(":") || !hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|home|lan|invalid)$/.test(hostname)) { finish({ httpStatus: null, error: "destination_rejected", permanent: true }); return; }
      const addresses = await resolve(hostname, { all: true, verbatim: true });
      if (settled) return;
      if (!addresses.length || addresses.some(record => !isPublicCalendarAddress(record.address))) { finish({ httpStatus: null, error: "destination_rejected", permanent: true }); return; }
      const pinned = addresses[0];
      const req = connect(url, { method: "POST", agent: false, family: pinned.family, lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: { ...input.headers, "Content-Length": Buffer.byteLength(input.body) } }, response => {
        const status = response.statusCode ?? 0; responseStatus = status || null;
        let received = 0;
        response.on("data", (chunk: Buffer) => { received += chunk.length; if (received > responseLimit) { finish({ httpStatus: status || null, error: "response_too_large" }); response.destroy(); req.destroy(); } });
        response.on("end", () => finish({ httpStatus: status || null, error: status >= 200 && status < 300 ? null : "http_error", permanent: status >= 300 && status < 500 && status !== 408 && status !== 429 }));
        response.on("error", () => finish({ httpStatus: status || null, error: "network_error" }));
      });
      abort = () => req.destroy();
      req.on("error", () => finish({ httpStatus: null, error: "network_error" }));
      req.end(input.body);
    })().catch(() => finish({ httpStatus: null, error: "network_error" }));
  });
}
export function calendarOutboundCapabilities(): CalendarOutbound {
  return { encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY ?? "", send: createCalendarHttpSender() };
}
