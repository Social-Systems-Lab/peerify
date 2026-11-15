// Run: IS_BUILD=true bun test src/components/modules/chat/venue-contact.test.tsx
// Venues can't be contacted through a private group with their admins (Tim's decision, 2026-11-15,
// option 1). The venue page's Chat button and its About-page contact form called
// contactCircleAdminsAction, which made a group of the person and every venue admin, and every member
// of it got each admin's name, handle, picture and DID: a venue run from a personal account named its
// owner. Any verified signed-in user could call it directly. Now the action refuses venues and the
// button and the form don't show. Other circles are unchanged. The database is in-memory fakes; the
// session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { contactCircleAdminsAction } = await import("./mongo-actions");
const { default: ChatButton } = await import("@/components/modules/home/chat-button");
const { canShowAboutContactForm } = await import("@/lib/peerify/venue-contact");

const OWNER = "did:test:canary-owner";
const VISITOR = "did:test:visitor";
const VENUE_ID = "651000000000000000000001";
const BAND_ID = "651000000000000000000002";

const venue = {
    _id: VENUE_ID,
    did: "did:test:venue",
    handle: "venue",
    name: "The Venue",
    circleType: "circle",
    metadata: { peerify: { managedIdentity: true, identityType: "venue" } },
};
const band = {
    _id: BAND_ID,
    did: "did:test:band",
    handle: "band",
    name: "The Band",
    circleType: "circle",
    metadata: { peerify: { managedIdentity: true, identityType: "band" } },
};
const person = (did: string) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: `Name of ${did.split(":").pop()}`,
    circleType: "user",
    isVerified: true,
    isMember: true,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { ...venue, _id: new ObjectId(VENUE_ID) },
            { ...band, _id: new ObjectId(BAND_ID) },
            person(OWNER),
            person(VISITOR),
        ],
        Members: [
            { userDid: OWNER, circleId: VENUE_ID, userGroups: ["admins", "moderators", "members"] },
            { userDid: VISITOR, circleId: VENUE_ID, userGroups: ["members"] },
            { userDid: OWNER, circleId: BAND_ID, userGroups: ["admins", "moderators", "members"] },
        ],
        ChatConversations: [],
        ChatRoomMembers: [],
        ChatMessages: [],
    });
});

describe("contactCircleAdminsAction, called directly", () => {
    test("a signed-in, verified user can't start a group with a venue's admins", async () => {
        sessionDid = VISITOR;
        for (const type of ["offer_help", "ask_question"] as const) {
            const result = await contactCircleAdminsAction(VENUE_ID, "Hello", [], type);
            expect(result.success).toBe(false);
            expect(result.roomId).toBeUndefined();
        }
        expect(fakeDb.col("ChatConversations").docs).toHaveLength(0);
        expect(fakeDb.col("ChatRoomMembers").docs).toHaveLength(0);
        expect(JSON.stringify(fakeDb.col("ChatMessages").docs)).not.toContain("Hello");
    });

    test("other circles are unchanged: a band's admins can still be contacted", async () => {
        sessionDid = VISITOR;
        const result = await contactCircleAdminsAction(BAND_ID, "Hello band");
        expect(result.success).toBe(true);
        expect(typeof result.roomId).toBe("string");
    });
});

describe("the venue's Chat button", () => {
    test("doesn't show on a venue", () => {
        expect(renderToStaticMarkup(<ChatButton circle={venue as never} />)).toBe("");
    });

    test("still shows on other circles", () => {
        expect(renderToStaticMarkup(<ChatButton circle={band as never} />)).toContain("Message");
    });
});

describe("the About page's contact form", () => {
    const matching = { hasMatchingOfferNeeds: true, isOwner: false };

    test("doesn't show on a venue, even with matching skills", () => {
        expect(canShowAboutContactForm(venue as never, matching)).toBe(false);
    });

    test("still shows on other circles with matching skills, and never for the owner", () => {
        expect(canShowAboutContactForm(band as never, matching)).toBe(true);
        expect(canShowAboutContactForm(band as never, { hasMatchingOfferNeeds: false, isOwner: false })).toBe(false);
        expect(canShowAboutContactForm(band as never, { hasMatchingOfferNeeds: true, isOwner: true })).toBe(false);
    });
});
