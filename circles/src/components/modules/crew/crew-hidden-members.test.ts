// Run: IS_BUILD=true bun test src/components/modules/crew/crew-hidden-members.test.ts
// Leak round 3, M3 (2026-11-07): a Crew member who set crewVisible: false is meant to be hidden
// from Crew peers, but crew.tsx sent every Crew row (name, picture, handle, city, DID) to every
// Crew member and the rail only drew a silhouette over it in the browser. Now a peer receives a
// placeholder; the circle's admins/moderators and the member themself still get the real row.
// The database is in-memory fakes; the session is stubbed and the client components are stubs.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const BAND_ID = "64f100000000000000000001";
const ADMIN = "did:test:admin";
const MODERATOR = "did:test:moderator";
const HIDDEN = "did:test:hidden";
const PEER = "did:test:peer";

const HIDDEN_NAME = "CANARY HIDDEN NAME";
const HIDDEN_HANDLE = "canary-hidden-handle";
const HIDDEN_CITY = "Canaryville";
const HIDDEN_PICTURE = "/storage/canary-hidden.jpg";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));

// Client components aren't under test: stubs that only carry their props.
const stub = (name: string) => ({ default: Object.assign(() => null, { displayName: name }) });
mock.module("./crew-member-rail", () => stub("CrewMemberRail"));
mock.module("./crew-space", () => stub("CrewSpaceModule"));
mock.module("./crew-offers-widget", () => stub("CrewOffersWidget"));
mock.module("./crew-landing", () => stub("CrewLanding"));
mock.module("@/components/utils/content-display-wrapper", () => stub("ContentDisplayWrapper"));

const { default: CrewModule } = await import("./crew");

const crewRow = (userDid: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId().toString(), // getCrewMembers returns the Member document id as a string
    userDid,
    circleId: BAND_ID,
    userGroups: ["members", "crew"],
    joinedAt: new Date("2026-10-01"),
    name: userDid,
    handle: userDid.split(":").pop(),
    ...extra,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [{ _id: new ObjectId(BAND_ID), did: "did:test:band", handle: "band", name: "Band", circleType: "circle" }],
        Members: [
            { userDid: ADMIN, circleId: BAND_ID, userGroups: ["admins", "members"] },
            { userDid: MODERATOR, circleId: BAND_ID, userGroups: ["moderators", "members"] },
            { userDid: HIDDEN, circleId: BAND_ID, userGroups: ["members", "crew"], crewVisible: false },
            { userDid: PEER, circleId: BAND_ID, userGroups: ["members", "crew"] },
        ],
    });
    // getCrewMembers' aggregate output.
    fakeDb.setAggregateResult("Members", [
        crewRow(HIDDEN, {
            crewVisible: false,
            name: HIDDEN_NAME,
            handle: HIDDEN_HANDLE,
            picture: { url: HIDDEN_PICTURE },
            location: { precision: 2, city: HIDDEN_CITY, country: "Sweden" },
        }),
        crewRow(PEER),
    ]);
});

// The members prop handed to the rail, found by walking the rendered element tree.
const railMembers = (node: any, seen = new Set<any>()): any[] | undefined => {
    if (!node || typeof node !== "object" || seen.has(node)) return undefined;
    seen.add(node);
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = railMembers(child, seen);
            if (found) return found;
        }
        return undefined;
    }
    if (node.type?.displayName === "CrewMemberRail") return node.props.members;
    return node.props ? railMembers(Object.values(node.props), seen) : undefined;
};
const render = async () =>
    railMembers(await CrewModule({ circle: { _id: BAND_ID, handle: "band", name: "Band" } as any }));

describe("Crew rail data", () => {
    test("a Crew peer: the hidden member arrives as a placeholder, with nothing identifying", async () => {
        sessionDid = PEER;
        const members = (await render())!;
        expect(members).toHaveLength(2);
        const text = JSON.stringify(members);
        for (const secret of [HIDDEN_NAME, HIDDEN_HANDLE, HIDDEN_CITY, HIDDEN_PICTURE, HIDDEN]) {
            expect(text).not.toContain(secret);
        }
        expect(members.find((m) => m.crewVisible === false)).not.toBeUndefined(); // still drawn as a silhouette
        expect(members.find((m) => m.userDid === PEER)?.name).toBe(PEER); // visible members unchanged
    });

    test("the circle's admin and moderator still get the real row", async () => {
        for (const did of [ADMIN, MODERATOR]) {
            sessionDid = did;
            const hidden = (await render())!.find((m) => m.crewVisible === false);
            expect(hidden?.name).toBe(HIDDEN_NAME);
            expect(hidden?.userDid).toBe(HIDDEN);
        }
    });

    test("the hidden member gets their own row (the visibility toggle lives on it)", async () => {
        sessionDid = HIDDEN;
        const own = (await render())!.find((m) => m.userDid === HIDDEN);
        expect(own?.name).toBe(HIDDEN_NAME);
    });

    test("a non-Crew viewer still gets only the landing state, no roster", async () => {
        sessionDid = "did:test:stranger";
        expect(await render()).toBeUndefined();
    });

    // Tim's decision 2026-11-07: approved Crew members keep seeing each other; nobody else sees
    // Crew membership, followers of the circle included.
    test("a follower who isn't Crew and a logged-out visitor get no roster either", async () => {
        fakeDb.col("Members").docs.push({ userDid: "did:test:fan", circleId: BAND_ID, userGroups: ["members"] });
        for (const did of ["did:test:fan", undefined]) {
            sessionDid = did;
            expect(await render()).toBeUndefined();
        }
    });

    test("Crew peers see each other: the hidden member sees the visible peer by name", async () => {
        sessionDid = HIDDEN;
        expect((await render())!.find((m) => m.userDid === PEER)?.name).toBe(PEER);
    });
});
