// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/profile-events-tab.test.ts"
// A personal profile's Events tab (Tim, 2026-11-15). It listed, for the owner, every event they
// created anywhere (a venue's events too) and every event they RSVP'd "going" to. Now it lists only
// open, public events the person created on their own profile, for everyone; the owner also sees
// their own drafts there. The owner's own toolbox (created/participating, asked for explicitly) is
// unchanged. The database is in-memory fakes; the session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, _circleId: string, feature: unknown) => {
        if (feature === features.events.view) return !!did;
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { getEventsAction } = await import("./actions");
const { default: EventsModule } = await import("@/components/modules/events/Events");

const OWNER = "did:test:owner";
const OTHER = "did:test:other";
const PROFILE_ID = "64b000000000000000000001";
const VENUE_ID = "64b000000000000000000002";
const BAND_ID = "64b000000000000000000003";

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
let n = 0;
const event = (title: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(`64b0000000000000000000${String(++n).padStart(2, "0")}`),
    circleId: PROFILE_ID,
    createdBy: OWNER,
    title,
    stage: "open",
    visibility: "public",
    userGroups: ["everyone"],
    startAt: future(5),
    endAt: future(5),
    author: { did: OWNER, handle: "owner", name: "Owner" },
    ...extra,
});

let goingEventId = "";
const allEvents = () => {
    n = 0;
    const going = event("Band gig I'm going to", { circleId: BAND_ID, createdBy: "did:test:band" });
    goingEventId = String(going._id);
    return [
        event("My open public gig"),
        event("My draft", { stage: "draft" }),
        event("My members-only evening", { userGroups: ["members"] }),
        event("My private dinner", { visibility: "private" }),
        event("My cancelled gig", { stage: "cancelled" }),
        event("Venue show I made", { circleId: VENUE_ID }),
        event("Someone else's event on my profile", { createdBy: OTHER }),
        going,
    ];
};

beforeEach(() => {
    sessionDid = undefined;
    const events = allEvents();
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(PROFILE_ID),
                did: OWNER,
                handle: "owner",
                name: "Owner",
                circleType: "user",
                enabledModules: ["home", "events"],
            },
            { _id: new ObjectId(), did: OTHER, handle: "other", name: "Other", circleType: "user" },
            {
                _id: new ObjectId(VENUE_ID),
                did: "did:test:venue",
                handle: "venue",
                name: "Venue",
                circleType: "circle",
            },
        ],
        EventRsvps: [
            { userDid: OWNER, eventId: goingEventId, status: "going" },
            { userDid: OWNER, eventId: String(events[0]._id), status: "interested" },
        ],
    });
    fakeDb.setAggregateResult("Events", events, { applyLeadingMatch: true });
});

const titles = (events: { title: string }[]) => events.map((e) => e.title).sort();
const tabTitles = async () => {
    const element = (await EventsModule({
        circle: { _id: PROFILE_ID, did: OWNER, handle: "owner", circleType: "user" } as never,
    })) as {
        props: { children: { props: { events: { title: string }[] } } };
    };
    return titles(element.props.children.props.events);
};

describe("a personal profile's Events tab", () => {
    test("another signed-in user: only the open, public events the person created on the profile", async () => {
        sessionDid = OTHER;
        expect(await tabTitles()).toEqual(["My open public gig"]);
        expect(titles((await getEventsAction("owner")).events)).toEqual(["My open public gig"]);
    });

    test("another user can't get the attending list by asking for it", async () => {
        sessionDid = OTHER;
        expect(titles((await getEventsAction("owner", undefined, true, true)).events)).toEqual(["My open public gig"]);
    });

    test("the owner: no events they attend, and none they made under a venue", async () => {
        sessionDid = OWNER;
        const listed = await tabTitles();
        expect(listed).not.toContain("Band gig I'm going to");
        expect(listed).not.toContain("Venue show I made");
        expect(listed).not.toContain("Someone else's event on my profile");
        expect(listed).toContain("My open public gig");
        // Their own not-yet-public events on the profile stay visible to them.
        expect(listed).toContain("My draft");
    });
});

describe("unchanged", () => {
    test("the owner's toolbox still gets their created and going events", async () => {
        sessionDid = OWNER;
        const listed = titles((await getEventsAction("owner", undefined, true, true)).events);
        expect(listed).toContain("Band gig I'm going to");
        expect(listed).toContain("Venue show I made");
    });
});
