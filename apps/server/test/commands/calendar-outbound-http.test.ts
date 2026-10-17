import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import type { request } from "node:https";
import { createCalendarHttpSender, isPublicCalendarAddress } from "../../src/services/calendar-outbound-http.js";
import { calendarEndpointSchema } from "@tabdo/shared";
const input = { endpoint: "https://receiver.example.test/path", body: "{}", headers: { "Content-Type": "application/json" } };

test("public address policy rejects private, metadata, loopback, reserved, mapped IPv6 and transition ranges", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.1.1.1", "255.255.255.255", "::1", "::", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1", "2001::1", "3fff::1", "bad"]) assert.equal(isPublicCalendarAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicCalendarAddress(address), true, address);
  for (const endpoint of ["http://example.com", "https://user:pass@example.com", "https://example.com/#x", "https://example.com:8443"]) assert(!calendarEndpointSchema.safeParse(endpoint).success);
});

test("production sender never opens a socket to literal/local hosts or any mixed public/private DNS result", async () => {
  let connections = 0;
  const requestSocket = (() => { connections++; throw new Error("must not connect"); }) as typeof request;
  for (const endpoint of ["http://example.com", "https://localhost", "https://metadata.internal", "https://127.1", "https://2130706433", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://public.example.test:8443"]) {
    const sender = createCalendarHttpSender({ request: requestSocket, resolve: (async () => { throw new Error("DNS must not run"); }) as never });
    assert.equal((await sender({ ...input, endpoint })).error, "destination_rejected", endpoint);
  }
  for (const addresses of [[{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], [{ address: "fe80::1", family: 6 }], []]) {
    const sender = createCalendarHttpSender({ request: requestSocket, resolve: (async () => addresses) as never });
    assert.equal((await sender(input)).error, "destination_rejected");
  }
  assert.equal(connections, 0);
});

function fixture(status: number, chunks: string[], options: { hang?: boolean; hangAfterHeaders?: boolean; timeoutMs?: number; responseLimit?: number } = {}) {
  let resolutions = 0, connections = 0, destroyed = false;
  const sender = createCalendarHttpSender({ timeoutMs: options.timeoutMs ?? 100, responseLimit: options.responseLimit ?? 64,
    resolve: (async () => { resolutions++; return [{ address: "93.184.216.34", family: 4 }]; }) as never,
    request: ((_url: URL, opts: Record<string, any>, callback: (res: EventEmitter & { statusCode: number; destroy(): void }) => void) => {
      connections++;
      assert.equal(opts.agent, false); assert.equal(opts.family, 4); assert.equal(opts.method, "POST");
      // A hypothetical second DNS resolution would return a private address; connect sees only the pinned IP.
      opts.lookup("receiver.example.test", {}, (error: null, address: string, family: number) => { assert.equal(error, null); assert.equal(address, "93.184.216.34"); assert.equal(family, 4); });
      const req = new EventEmitter() as EventEmitter & { end(body: string): void; destroy(): void };
      req.destroy = () => { destroyed = true; };
      req.end = body => {
        assert.equal(body, "{}"); if (options.hang) return;
        queueMicrotask(() => {
          const response = new EventEmitter() as EventEmitter & { statusCode: number; destroy(): void };
          response.statusCode = status; response.destroy = () => {};
          callback(response); if (options.hangAfterHeaders) return; for (const chunk of chunks) response.emit("data", Buffer.from(chunk)); response.emit("end");
        });
      };
      return req;
    }) as never,
  });
  return { sender, state: () => ({ resolutions, connections, destroyed }) };
}
test("DNS is pinned, redirects are terminal, HTTP errors classified, bodies bounded and timeout enforced", async () => {
  const good = fixture(204, []); assert.equal((await good.sender(input)).error, null); assert.deepEqual(good.state(), { resolutions: 1, connections: 1, destroyed: false });
  const redirect = fixture(302, []); const refused = await redirect.sender(input); assert.equal(refused.error, "http_error"); assert(refused.permanent); assert.equal(redirect.state().connections, 1);
  for (const status of [408, 429, 503]) assert.equal((await fixture(status, []).sender(input)).permanent, false);
  const large = fixture(200, ["secret".repeat(100)]); assert.equal((await large.sender(input)).error, "response_too_large"); assert(large.state().destroyed);
  const slow = fixture(200, [], { hang: true, timeoutMs: 10 }); assert.equal((await slow.sender(input)).error, "timeout"); assert(slow.state().destroyed);
  const stalledBody = await fixture(503, [], { hangAfterHeaders: true, timeoutMs: 10 }).sender(input); assert.equal(stalledBody.httpStatus, 503); assert.equal(stalledBody.error, "timeout");
  const dns = createCalendarHttpSender({ timeoutMs: 10, resolve: (() => new Promise(() => {})) as never }); assert.equal((await dns(input)).error, "timeout");
});
