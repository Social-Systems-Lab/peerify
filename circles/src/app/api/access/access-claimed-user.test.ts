// Run: IS_BUILD=true bun test src/app/api/access/access-claimed-user.test.ts
// L2 (draft artist profiles, 2026-11-21): /api/access read the viewer from the request body, and
// the route is reachable from outside. Claiming someone's did answered "may person X see this?":
// whether a draft handle exists (and who runs it), whether X is a hidden admin (settings), whether
// X is a platform admin (another profile's Circles list), whether X follows a circle (a
// members-only module). It now reads the viewer from the session cookie only; middleware forwards
// the visitor's Cookie header. The database is in-memory fakes; nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

const { POST: access } = await import("./route");

const OWNER = "did:test:owner";
const ADMIN = "did:test:admin";
const FAN = "did:test:fan";
const PLATFORM_ADMIN = "did:test:platform-admin";

const circle = (id: string, extra: Record<string, unknown>) => ({
    _id: id,
    did: `did:test:${id}`,
    handle: id,
    name: id,
    circleType: "circle",
    enabledModules: ["home", "feed", "settings", "funding", "communities"],
    accessRules: { settings: { view: ["admins"] }, funding: { view: ["admins", "moderators", "members"] } },
    ...extra,
});

const ask = async (circleHandle: string, moduleHandle: string, claimedDid?: string) => {
    const response = await access(
        new Request("http://localhost/api/access", {
            method: "POST",
            body: JSON.stringify({ userDid: claimedDid, circleHandle, moduleHandle }),
        }),
    );
    return (await response.json()) as { authorized?: boolean; notFound?: boolean; authenticated?: boolean };
};

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            circle("64a000000000000000000e01", { handle: "draft-artist", publishStatus: "draft", createdBy: OWNER }),
            circle("64a000000000000000000e02", { handle: "venue", publishStatus: "published", createdBy: OWNER }),
            {
                _id: "64a000000000000000000e03",
                did: FAN,
                handle: "fan",
                name: "Fan",
                circleType: "user",
                enabledModules: ["home", "communities"],
            },
            { _id: "64a000000000000000000e04", did: PLATFORM_ADMIN, handle: "pa", circleType: "user", isAdmin: true },
        ],
        Members: [
            { userDid: ADMIN, circleId: "64a000000000000000000e02", userGroups: ["admins", "moderators", "members"] },
            { userDid: FAN, circleId: "64a000000000000000000e02", userGroups: ["members"] },
        ],
    });
});

describe("a claimed userDid in the body is ignored", () => {
    test("a draft handle: same answer as a missing handle, whoever is claimed", async () => {
        const missing = await ask("no-such-handle", "feed", OWNER);
        expect(missing.notFound).toBe(true);
        expect(await ask("draft-artist", "feed", OWNER)).toEqual(missing);
    });

    test("settings: claiming an admin doesn't reveal that they are one", async () => {
        expect((await ask("venue", "settings", ADMIN)).authorized === true).toBe(false);
    });

    test("members-only module: claiming a follower doesn't reveal that they follow", async () => {
        expect((await ask("venue", "funding", FAN)).authorized === true).toBe(false);
    });

    test("another profile's Circles list: claiming a platform admin doesn't reveal that they are one", async () => {
        expect((await ask("fan", "communities", PLATFORM_ADMIN)).authorized === true).toBe(false);
    });
});

describe("the session viewer still gets their real answer", () => {
    test("the draft's creator opens it", async () => {
        sessionDid = OWNER;
        expect((await ask("draft-artist", "feed")).authorized).toBe(true);
    });

    test("an admin opens settings; a follower opens funding", async () => {
        sessionDid = ADMIN;
        expect((await ask("venue", "settings")).authorized).toBe(true);
        sessionDid = FAN;
        expect((await ask("venue", "funding")).authorized).toBe(true);
    });

    test("the session wins over a different claimed did", async () => {
        sessionDid = FAN;
        expect((await ask("venue", "settings", ADMIN)).authorized === true).toBe(false);
    });
});

describe("middleware forwards the visitor's cookie and no longer sends userDid", () => {
    const text = readFileSync(path.join(process.cwd(), "src", "middleware.ts"), "utf8");
    test("Cookie header forwarded", () => {
        expect(text).toContain('request.headers.get("cookie")');
        expect(text).toContain("Cookie: cookieHeader");
    });
    test("body has no userDid", () => {
        // circleRoot added 2026-11-22 (bare profile URL); still no userDid in the body.
        expect(text).toContain("{ circleHandle, moduleHandle, circleRoot: urlSegments.length === 2 }");
        expect(text).not.toContain("userDid, circleHandle");
    });
});
