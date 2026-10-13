import assert from "node:assert/strict";
import { buildPublicUrl, getPublicOrigin, isAllowedPublicHost } from "./public-origin";

// Run: bun src/lib/utils/public-origin.test.ts — pure, no database.
// Behind nginx the request URL is the app's own listen address; redirects and ICS links must use
// the visitor's Host + X-Forwarded-Proto instead.

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });
const appUrl = "https://localhost:3001/circles/x/home";

assert.equal(
    getPublicOrigin(headers({ host: "cleura-staging.peerify.one", "x-forwarded-proto": "https" }), appUrl),
    "https://cleura-staging.peerify.one",
);
assert.equal(
    getPublicOrigin(headers({ host: "peerify.one", "x-forwarded-proto": "https, http" }), appUrl),
    "https://peerify.one",
);
// Direct hit without a proxy (local dev): the request's own scheme.
assert.equal(getPublicOrigin(headers({ host: "localhost:3000" }), "http://localhost:3000/x"), "http://localhost:3000");
// Allowlist: peerify.one and its subdomains, plus localhost / 127.0.0.1, optionally with a port.
for (const host of [
    "peerify.one",
    "staging.peerify.one",
    "cleura-staging.peerify.one",
    "Staging.Peerify.One",
    "peerify.one:443",
    "127.0.0.1:3000",
]) {
    assert.equal(isAllowedPublicHost(host), true, host);
}
for (const host of [
    "evil.example",
    "peerify.one.evil.example",
    "evilpeerify.one",
    "peerify.one/path",
    "staging.peerify.one/x",
    "peerify .one",
    "peerify.one evil.example",
    "",
    "peerify.one:99999x",
]) {
    assert.equal(isAllowedPublicHost(host), false, host);
}
assert.equal(
    getPublicOrigin(headers({ host: "staging.peerify.one", "x-forwarded-proto": "https" }), appUrl),
    "https://staging.peerify.one",
);

// Anything off the allowlist falls back to CIRCLES_URL, then to the request's own origin.
process.env.CIRCLES_URL = "https://staging.peerify.one/";
assert.equal(
    getPublicOrigin(headers({ host: "evil.example", "x-forwarded-proto": "https" }), appUrl),
    "https://staging.peerify.one",
);
assert.equal(
    getPublicOrigin(headers({ host: "peerify.one.evil.example", "x-forwarded-proto": "https" }), appUrl),
    "https://staging.peerify.one",
);
assert.equal(getPublicOrigin(headers({ host: "peerify.one/path" }), appUrl), "https://staging.peerify.one");
assert.equal(getPublicOrigin(headers({ host: "peerify one" }), appUrl), "https://staging.peerify.one");
delete process.env.CIRCLES_URL;
assert.equal(getPublicOrigin(headers({ host: "evil.example" }), appUrl), "https://localhost:3001");
process.env.CIRCLES_URL = "https://staging.peerify.one/";
assert.equal(getPublicOrigin(headers({}), appUrl), "https://staging.peerify.one");

// buildPublicUrl: a request path can never change the host.
const peerify = headers({ host: "peerify.one", "x-forwarded-proto": "https" });
const built = (pathname: string, search?: string) => buildPublicUrl(peerify, appUrl, pathname, search).toString();
assert.equal(built("//evil.example/x"), "https://peerify.one/evil.example/x");
assert.equal(built("/\\evil.example/x"), "https://peerify.one/evil.example/x");
assert.equal(built("\\\\evil.example"), "https://peerify.one/evil.example");
assert.equal(built("/circles/a\\b/home").startsWith("https://peerify.one/"), true);
assert.equal(built("/circles/x/home", "?tab=1"), "https://peerify.one/circles/x/home?tab=1");
const notFound = buildPublicUrl(peerify, appUrl, "/not-found");
notFound.searchParams.set("redirectTo", "/circles/x/home");
assert.equal(notFound.toString(), "https://peerify.one/not-found?redirectTo=%2Fcircles%2Fx%2Fhome");

console.log("public-origin: all tests passed");
