// Run: IS_BUILD=true bun test "src/app/circles/[handle]/home/about-admins.test.ts"
// P1 (Tim, 2026-11-07): the old "Admins" card on "other" circles listed up to 6 admins with the label
// "Admin", for everyone, logged out too, unless the circle switched "Show admins publicly" off (on
// by default). It's gone: the About page names an admin only if they opted in to the Team card.
// The test walks everything the page hands to the client (AboutPage's props). The database is
// in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CLUB_ID = "64fa00000000000000000001"; // an "other" circle
const OPTED_IN = "did:test:opted-in-admin";
const QUIET = "did:test:quiet-admin";
const QUIET_NAME = "CANARY QUIET ADMIN";
const OPTED_IN_NAME = "Visible Admin";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realCircle = await import("@/lib/data/circle");
mock.module("@/lib/data/circle", () => ({
    ...realCircle,
    getCircleByHandle: async (handle: string) => fakeDb.col("Circles").docs.find((c) => c.handle === handle) ?? null,
}));
// The client component isn't under test: a stub that only carries its props.
mock.module("@/components/modules/home/AboutPage", () => ({
    default: Object.assign(() => null, { displayName: "AboutPage" }),
}));

const { default: CircleHomePage } = await import("./page");

const person = (did: string, name: string) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name,
    circleType: "user",
});

const seed = (club: Record<string, unknown> = {}) => {
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(CLUB_ID), did: "did:test:club", handle: "club", name: "Club", circleType: "circle", isPublic: true, ...club },
            person(OPTED_IN, OPTED_IN_NAME),
            person(QUIET, QUIET_NAME),
        ],
        Members: [
            { userDid: OPTED_IN, circleId: CLUB_ID, userGroups: ["admins", "members"], teamCardVisible: true },
            { userDid: QUIET, circleId: CLUB_ID, userGroups: ["admins", "members"] },
        ],
    });
    // What getMembers' aggregate would return (the old Admins card read it).
    fakeDb.setAggregateResult("Members", [
        { _id: "m1", userDid: OPTED_IN, circleId: CLUB_ID, userGroups: ["admins", "members"], name: OPTED_IN_NAME, handle: "opted-in-admin" },
        { _id: "m2", userDid: QUIET, circleId: CLUB_ID, userGroups: ["admins", "members"], name: QUIET_NAME, handle: "quiet-admin" },
    ]);
};

beforeEach(() => {
    sessionDid = undefined;
    seed(); // showAdminsPublicly not set: the old card's default was on
});

const aboutProps = async () => {
    const element = (await CircleHomePage({ params: Promise.resolve({ handle: "club" }) })) as any;
    expect(element.type.displayName).toBe("AboutPage");
    return element.props;
};

describe("About page of an 'other' circle: admins named only if they opted in", () => {
    test("a logged-out visitor and a signed-in stranger: the opted-in admin only, no other admin", async () => {
        for (const viewer of [undefined, "did:test:stranger"]) {
            sessionDid = viewer;
            const props = await aboutProps();
            const text = JSON.stringify(props);
            expect(text).not.toContain(QUIET_NAME);
            expect(text).not.toContain(QUIET);
            expect(props.teamCard.members.map((m: { name: string }) => m.name)).toEqual([OPTED_IN_NAME]);
            expect(Object.keys(props)).not.toContain("adminLeaders");
        }
    });

    test("also with 'Show admins publicly' stored as on", async () => {
        seed({ showAdminsPublicly: true });
        expect(JSON.stringify(await aboutProps())).not.toContain(QUIET_NAME);
    });

    test("nobody opted in: no admin name at all", async () => {
        fakeDb.col("Members").docs.forEach((row) => delete row.teamCardVisible);
        const text = JSON.stringify(await aboutProps());
        expect(text).not.toContain(QUIET_NAME);
        expect(text).not.toContain(OPTED_IN_NAME);
    });
});
