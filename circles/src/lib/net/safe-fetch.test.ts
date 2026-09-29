import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { checkUrlShape, isPublicAddress, resolvePublicAddress, safeFetchHtml } from "./safe-fetch";

// --- isPublicAddress ---

const blocked = [
    // IPv4 loopback / private / link-local / CGNAT / unspecified / multicast / reserved
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "0.1.2.3",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.18.0.1",
    // IPv6 loopback / unspecified / link-local / ULA / multicast / docs
    "::1",
    "::",
    "fe80::1",
    "febf::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "2001:db8::1",
    // IPv4-mapped / NAT64 / 6to4 forms of blocked IPv4
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:0.0.0.0",
    "64:ff9b::127.0.0.1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2002:c0a8:101::1",
    // not an IP at all
    "localhost",
    "",
    "fe80::1%eth0",
];

const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.255.255", // just below 172.16/12
    "172.32.0.1", // just above
    "100.63.255.255", // just below 100.64/10
    "100.128.0.1", // just above
    "169.253.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001:82a::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::1",
];

for (const ip of blocked) assert.equal(isPublicAddress(ip), false, `expected ${ip} to be blocked`);
for (const ip of allowed) assert.equal(isPublicAddress(ip), true, `expected ${ip} to be allowed`);

// --- checkUrlShape ---

assert.ok(checkUrlShape("https://example.com/a?b=c"));
assert.ok(checkUrlShape("http://example.com:80/"));
assert.ok(checkUrlShape("https://example.com:443/"));
assert.equal(checkUrlShape("https://example.com:8443/"), null);
assert.equal(checkUrlShape("http://example.com:3001/"), null);
assert.equal(checkUrlShape("ftp://example.com/"), null);
assert.equal(checkUrlShape("file:///etc/passwd"), null);
assert.equal(checkUrlShape("javascript:alert(1)"), null);
assert.equal(checkUrlShape("https://user:pass@example.com/"), null);
assert.equal(checkUrlShape("not a url"), null);
// relative redirect targets resolve against the current hop
assert.equal(checkUrlShape("/next", "https://example.com/a")?.toString(), "https://example.com/next");
// WHATWG URL normalises numeric host forms, so they reach the classifier as dotted quads
assert.equal(checkUrlShape("http://2130706433/")?.hostname, "127.0.0.1");
assert.equal(checkUrlShape("http://0x7f.1/")?.hostname, "127.0.0.1");

// --- resolvePublicAddress / safeFetchHtml ---

const main = async () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "[::ffff:127.0.0.1]", "169.254.169.254", "10.1.2.3"]) {
        assert.equal(await resolvePublicAddress(host), null, `expected ${host} to be rejected`);
    }
    assert.deepEqual(await resolvePublicAddress("8.8.8.8"), { address: "8.8.8.8", family: 4 });
    assert.deepEqual(await resolvePublicAddress("[2606:4700:4700::1111]"), {
        address: "2606:4700:4700::1111",
        family: 6,
    });

    for (const url of [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://[::1]/",
        "http://2130706433/",
        "http://127.0.0.1:3001/",
        "http://169.254.169.254/latest/meta-data/",
        "gopher://example.com/",
    ]) {
        assert.equal(await safeFetchHtml(url), null, `expected ${url} to be rejected`);
    }

    // Opt-in live checks (need outbound internet): SAFE_FETCH_NETWORK=1 bun src/lib/net/safe-fetch.test.ts
    if (process.env.SAFE_FETCH_NETWORK === "1") {
        const page = await safeFetchHtml("https://example.com/");
        assert.ok(page && /<title>/i.test(page.body), "example.com should fetch");
        // localtest.me resolves to loopback (127.0.0.1 and/or ::1)
        const lookedUp = await dns.lookup("localtest.me", { all: true });
        assert.ok(
            lookedUp.length > 0 && lookedUp.every((a) => !isPublicAddress(a.address)),
            "control: localtest.me resolves to loopback",
        );
        assert.equal(await safeFetchHtml("http://localtest.me/"), null, "hostname resolving to loopback");
        // controls: a public redirect is followed, and an html page from the same service fetches
        const redirected = await safeFetchHtml("https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F");
        assert.equal(redirected?.url, "https://example.com/", "control: public redirect followed");
        assert.ok(await safeFetchHtml("https://httpbin.org/html"), "control: httpbin html fetches");
        assert.equal(
            await safeFetchHtml("https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F", { maxRedirects: 0 }),
            null,
            "redirect limit enforced",
        );
        // httpbin redirect-to an internal address must be refused on the redirect hop
        assert.equal(
            await safeFetchHtml("https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A3001%2F"),
            null,
            "redirect to loopback",
        );
        // not text/html
        assert.equal(await safeFetchHtml("https://httpbin.org/json"), null, "non-html content type");
        // over the size cap
        assert.equal(await safeFetchHtml("https://example.com/", { maxBytes: 100 }), null, "over maxBytes");
        console.log("safe-fetch network checks passed");
    }

    console.log("safe-fetch tests passed");
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
