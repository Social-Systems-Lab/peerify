// Run: IS_BUILD=true bun test src/lib/auth/session-token.test.ts
// Round 3, item 7 (2026-10-20; report 2026-10-20 §5b): audio tokens are signed with the session key,
// so verifyUserToken must not accept them (or any token without a userDid, or with an audience) as
// a session, and checkAuth must not look up a user for a payload without a string userDid. A test
// secret is set before import; the user lookup is stubbed. The rejection tests fail on the code
// before this change: an audio token verified as a session and checkAuth returned a user for it.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SignJWT } from "jose";
import { createFakeDb } from "@/lib/testing/fake-db";

process.env.CIRCLES_JWT_SECRET = "test-only-secret-for-session-token-test-0123456789";
const SECRET = new TextEncoder().encode(process.env.CIRCLES_JWT_SECRET);

let cookieToken: string | undefined;
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
const realCookie = await import("@/lib/auth/cookie");
mock.module("@/lib/auth/cookie", () => ({ ...realCookie, readAuthToken: () => cookieToken }));
const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);
const lookups: unknown[] = [];
const realUser = await import("@/lib/data/user");
mock.module("@/lib/data/user", () => ({
    ...realUser,
    getUserPrivate: async (did: unknown) => {
        lookups.push(did);
        // As Circles.findOne({ did: undefined }) can: some document without a did.
        return { did: typeof did === "string" ? did : undefined, name: "Someone", email: "someone@example.test" };
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { verifyUserToken, generateUserToken } = await import("./jwt");
const { signAudioToken } = await import("@/lib/audio/audio-token");
const { checkAuth } = await import("@/components/auth/actions");

const sign = (claims: Record<string, unknown>, audience?: string) => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt(now).setExpirationTime(now + 60);
    if (audience) jwt.setAudience(audience);
    return jwt.sign(SECRET);
};

// true when the promise rejects (the repo's bun matcher types have no .rejects).
const rejects = (promise: Promise<unknown>) => promise.then(
    () => false,
    () => true,
);

beforeEach(() => {
    cookieToken = undefined;
    lookups.length = 0;
});

describe("verifyUserToken", () => {
    test("accepts a session token", async () => {
        const payload = await verifyUserToken(await generateUserToken("did:test:user"));
        expect(payload.userDid).toBe("did:test:user");
    });

    test("rejects an audio token", async () => {
        const audio = await signAudioToken({ trackId: "t1", previewKey: "k1" });
        expect(await rejects(verifyUserToken(audio))).toBe(true);
    });

    test("rejects a token without a non-empty string userDid", async () => {
        expect(await rejects(verifyUserToken(await sign({})))).toBe(true);
        expect(await rejects(verifyUserToken(await sign({ userDid: "" })))).toBe(true);
        expect(await rejects(verifyUserToken(await sign({ userDid: 42 })))).toBe(true);
    });

    test("rejects a token with an audience, even with a userDid", async () => {
        expect(await rejects(verifyUserToken(await sign({ userDid: "did:test:user" }, "peerify-audio")))).toBe(true);
    });
});

describe("checkAuth", () => {
    test("an audio token in the session cookie is not a login and looks up no user", async () => {
        cookieToken = await signAudioToken({ trackId: "t1", previewKey: "k1" });
        const result = await checkAuth();
        expect(result.authenticated).toBe(false);
        expect(result.user).toBeUndefined();
        expect(lookups).toEqual([]);
    });

    test("a session token still logs in", async () => {
        cookieToken = await generateUserToken("did:test:user");
        const result = await checkAuth();
        expect(result.authenticated).toBe(true);
        expect(lookups).toEqual(["did:test:user"]);
    });
});
