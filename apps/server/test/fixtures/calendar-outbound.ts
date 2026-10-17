import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import type { CalendarOutbound } from "../../src/business/calendar/outbound.js";
import { createCalendarHttpSender } from "../../src/services/calendar-outbound-http.js";
// Public, self-signed test material; product composition never loads these fixtures.
export const calendarTestCertificate = readFileSync(new URL("./calendar-webhook-cert.pem", import.meta.url));
export const calendarTestKey = readFileSync(new URL("./calendar-webhook-key.pem", import.meta.url));
/** Explicit test-only injection: no URL/environment exception exists in the production sender. */
export function calendarTestOutbound(port: number, encryptionKey = "11".repeat(32)): CalendarOutbound {
  return { encryptionKey, send: createCalendarHttpSender({
    resolve: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
    request: ((url: URL, options: Parameters<typeof httpsRequest>[1], callback: Parameters<typeof httpsRequest>[2]) => {
      if (url.hostname !== "receiver.example.test") throw new Error("Only the owned receiver is allowed");
      return httpsRequest({ ...options, hostname: "127.0.0.1", path: url.pathname + url.search, port, servername: "receiver.example.test", ca: calendarTestCertificate, lookup: undefined }, callback);
    }) as typeof httpsRequest,
  }) };
}
