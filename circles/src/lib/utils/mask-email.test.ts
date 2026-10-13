import assert from "node:assert/strict";
import { maskEmail } from "./mask-email";
import { getClientIp } from "./client-ip";

// Run: bun src/lib/utils/mask-email.test.ts

assert.equal(maskEmail("jane.doe@Example.COM"), "j***@example.com");
assert.equal(maskEmail("  a.b.c.d@gmail.com "), "a***@gmail.com");
assert.equal(maskEmail("x@y.se"), "x***@y.se");
assert.equal(maskEmail("not-an-address"), "<redacted>");
assert.equal(maskEmail("@nolocal.test"), "<redacted>");
assert.equal(maskEmail("trailing@"), "<redacted>");
assert.equal(maskEmail(""), "<no email>");
assert.equal(maskEmail(undefined), "<no email>");
assert.equal(maskEmail(null), "<no email>");

const h = (entries: Record<string, string>) => new Headers(entries);
assert.equal(getClientIp(h({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
assert.equal(getClientIp(h({ "x-real-ip": " 2001:db8::1 " })), "2001:db8::1");
// X-Real-IP wins over a client-supplied X-Forwarded-For.
assert.equal(getClientIp(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" })), "203.0.113.7");
// X-Forwarded-For is never used: without our nginx in front a client controls all of it.
assert.equal(getClientIp(h({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" })), null);
assert.equal(getClientIp(h({ "x-real-ip": "  " })), null);
assert.equal(getClientIp(h({})), null);

console.log("mask-email / client-ip: all tests passed");
