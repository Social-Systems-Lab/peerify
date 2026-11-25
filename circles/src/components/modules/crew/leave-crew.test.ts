// Run: IS_BUILD=true bun test src/components/modules/crew/leave-crew.test.ts
// Leave Crew (backlog item 2, 2026-11-25): leaving drops only the "crew" group. The membership
// document stays, with every other group, so the person still follows the artist. Not a Crew
// member, or signed out: refused, nothing changes.
// The database is in-memory fakes (testing/fake-db.ts); nothing real is touched.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const CIRCLE = "64a000000000000000000c11";
const CREW_FAN = "did:test:crew-fan";
const CREW_MODERATOR = "did:test:crew-moderator";
const FOLLOWER = "did:test:follower";

let signedIn: string | undefined = CREW_FAN;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => signedIn,
}));

const { leaveCrewAction } = await import("./actions");

const membersOf = (did: string) => fakeDb.col("Members").docs.filter((doc: any) => doc.userDid === did);

beforeEach(() => {
    signedIn = CREW_FAN;
    fakeDb.reset({
        Circles: [{ _id: new ObjectId(CIRCLE), handle: "artist", name: "Artist", circleType: "circle" }],
        Members: [
            { _id: new ObjectId(), userDid: CREW_FAN, circleId: CIRCLE, userGroups: ["members", "crew"] },
            { _id: new ObjectId(), userDid: CREW_MODERATOR, circleId: CIRCLE, userGroups: ["moderators", "members", "crew"] },
            { _id: new ObjectId(), userDid: FOLLOWER, circleId: CIRCLE, userGroups: ["members"] },
        ],
    });
});

describe("leaveCrewAction", () => {
    test("a Crew member leaves: only 'crew' goes, they still follow", async () => {
        const result = await leaveCrewAction(CIRCLE);

        expect(result).toEqual({ success: true });
        const rows = membersOf(CREW_FAN);
        expect(rows).toHaveLength(1); // the membership (following) is kept, not removed
        expect(rows[0].userGroups).toEqual(["members"]);
    });

    test("other groups are kept (a moderator who is also Crew)", async () => {
        signedIn = CREW_MODERATOR;
        const result = await leaveCrewAction(CIRCLE);

        expect(result.success).toBe(true);
        expect(membersOf(CREW_MODERATOR)[0].userGroups).toEqual(["moderators", "members"]);
    });

    test("a follower who isn't Crew: refused, nothing changes", async () => {
        signedIn = FOLLOWER;
        const result = await leaveCrewAction(CIRCLE);

        expect(result).toEqual({ success: false, message: "You're not a Crew member of this circle" });
        expect(membersOf(FOLLOWER)[0].userGroups).toEqual(["members"]);
    });

    test("signed out: refused, nothing changes", async () => {
        signedIn = undefined;
        const result = await leaveCrewAction(CIRCLE);

        expect(result.success).toBe(false);
        expect(result.message).toBe("You need to be logged in to leave Crew");
        expect(membersOf(CREW_FAN)[0].userGroups).toEqual(["members", "crew"]);
    });

    test("leaving twice: the second time is refused, the membership stays", async () => {
        await leaveCrewAction(CIRCLE);
        const again = await leaveCrewAction(CIRCLE);

        expect(again.success).toBe(false);
        expect(membersOf(CREW_FAN)).toHaveLength(1);
    });
});
