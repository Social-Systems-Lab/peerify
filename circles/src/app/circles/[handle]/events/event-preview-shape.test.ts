// Run: IS_BUILD=true bun test "src/app/circles/[handle]/events/event-preview-shape.test.ts"
// Leak round 3, M1 (the part H5 left, 2026-11-07):
// - The preview page (/circles/<h>/events/<id>/preview) redirected a stale link to the event's
//   current host BEFORE checking that the viewer is the author or a moderator, so anyone signed in
//   with the id of a draft learned which circle hosts it (the redirect URL names it).
// - sanitizePeerifyPublicEventDisplay, the shape every non-manager gets, kept the audience
//   (userGroups), whose handles name hidden groups such as Crew.
// Managers (author, host moderators) still get everything. The database is in-memory fakes; the
// session and permission checks are stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";
import { features } from "@/lib/data/constants";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const OLD_HOST_ID = "64e000000000000000000001";
const NEW_HOST_ID = "64e000000000000000000002";
const EVENT_ID = "64e0000000000000000000e1";
const AUTHOR = "did:test:author";
const STRANGER = "did:test:stranger";
const NEW_HOST_MOD = "did:test:new-host-mod";
const CREW_MEMBER = "did:test:crew";
const NEW_HOST_HANDLE = "canary-secret-host";

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async (did: string | undefined, circleId: string, feature: unknown) => {
        if (feature === features.events.view) return true;
        if (feature === features.events.moderate) return did === NEW_HOST_MOD && circleId === NEW_HOST_ID;
        return false;
    },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

class Redirect extends Error {
    constructor(public url: string) {
        super("NEXT_REDIRECT");
    }
}
class NotFound extends Error {}
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    redirect: (url: string) => {
        throw new Redirect(url);
    },
    notFound: () => {
        throw new NotFound("NEXT_NOT_FOUND");
    },
}));
// The page's client component isn't under test; a stub keeps the browser-only UI out of bun.
mock.module("@/components/modules/events/event-detail", () => ({ default: () => null }));

const { default: EventPreviewPage } = await import("./[eventId]/preview/page");
const { shapeEventForViewer, getOpenEventsForList, getOpenEventsForMap } = await import("@/lib/data/event");

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const draftEvent = () => ({
    _id: EVENT_ID,
    circleId: NEW_HOST_ID,
    circle: { _id: NEW_HOST_ID, handle: NEW_HOST_HANDLE, name: "Secret host" },
    title: "Draft gig",
    stage: "draft",
    visibility: "public",
    createdBy: AUTHOR,
    startAt: future(3),
    endAt: future(4),
    userGroups: ["everyone"],
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(OLD_HOST_ID), did: "did:test:old", handle: "old-host", name: "Old", circleType: "circle" },
            { _id: new ObjectId(NEW_HOST_ID), did: "did:test:new", handle: NEW_HOST_HANDLE, name: "New", circleType: "circle" },
        ],
        Members: [{ userDid: CREW_MEMBER, circleId: NEW_HOST_ID, userGroups: ["members", "crew"] }],
    });
    fakeDb.setAggregateResult("Events", [draftEvent()]);
});

// Every string in a rendered element tree (children and props), without following cycles.
const textOf = (node: unknown, seen = new Set<unknown>()): string => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (!node || typeof node !== "object" || seen.has(node)) return "";
    seen.add(node);
    if (Array.isArray(node)) return node.map((n) => textOf(n, seen)).join(" ");
    const props = (node as { props?: Record<string, unknown> }).props;
    return props ? Object.values(props).map((v) => textOf(v, seen)).join(" ") : "";
};

const openPreview = async (handle: string) => {
    try {
        const element = await EventPreviewPage({
            params: Promise.resolve({ handle, eventId: EVENT_ID }),
        } as any);
        return { redirectedTo: undefined, text: textOf(element) };
    } catch (error) {
        if (error instanceof Redirect) return { redirectedTo: error.url, text: "" };
        throw error;
    }
};

describe("preview page", () => {
    test("a signed-in stranger with a stale link: Access Denied, no redirect naming the host", async () => {
        sessionDid = STRANGER;
        const result = await openPreview("old-host");
        expect(result.redirectedTo).toBeUndefined();
        expect(result.text).toContain("Access Denied");
        expect(result.text).not.toContain(NEW_HOST_HANDLE);
    });

    test("the author with a stale link: still sent on to the current host", async () => {
        sessionDid = AUTHOR;
        expect((await openPreview("old-host")).redirectedTo).toBe(`/circles/${NEW_HOST_HANDLE}/events/${EVENT_ID}/preview`);
    });

    test("a moderator of the current host with a stale link: still sent on", async () => {
        sessionDid = NEW_HOST_MOD;
        expect((await openPreview("old-host")).redirectedTo).toBe(`/circles/${NEW_HOST_HANDLE}/events/${EVENT_ID}/preview`);
    });

    test("a moderator of the current host on the right link: the preview renders", async () => {
        sessionDid = NEW_HOST_MOD;
        const result = await openPreview(NEW_HOST_HANDLE);
        expect(result.redirectedTo).toBeUndefined();
        expect(result.text).not.toContain("Access Denied");
    });
});

describe("event shape for non-managers", () => {
    const crewEvent = () =>
        ({ ...draftEvent(), stage: "open", title: "Crew rehearsal", userGroups: ["members", "crew"] }) as any;

    test("a member in the audience gets the event without its audience (userGroups)", async () => {
        const shaped = await shapeEventForViewer(crewEvent(), CREW_MEMBER);
        expect(shaped?.title).toBe("Crew rehearsal");
        expect(Object.keys(shaped ?? {})).not.toContain("userGroups");
    });

    test("the author and a host moderator still get the audience", async () => {
        for (const did of [AUTHOR, NEW_HOST_MOD]) {
            expect((await shapeEventForViewer(crewEvent(), did))?.userGroups).toEqual(["members", "crew"]);
        }
    });

    test("map and list: audience still enforced, and no userGroups in what's sent", async () => {
        fakeDb.setAggregateResult("Events", [crewEvent()]);
        expect(await getOpenEventsForList(STRANGER)).toEqual([]);
        expect(await getOpenEventsForMap(STRANGER)).toEqual([]);
        for (const list of [await getOpenEventsForList(CREW_MEMBER), await getOpenEventsForMap(CREW_MEMBER)]) {
            expect(list.map((e) => e.title)).toEqual(["Crew rehearsal"]);
            expect(Object.keys(list[0])).not.toContain("userGroups");
        }
    });
});
