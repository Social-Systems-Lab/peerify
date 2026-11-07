// Run: IS_BUILD=true bun test src/components/modules/home/team-card.test.tsx
// The Team card on a circle's About page (Tim's decision 2026-11-07):
// - it shows only the circle's admins and moderators who opted in (per person, per circle, off by
//   default), with name, picture, handle and role only: never email, phone, location or DID;
// - one short plain-text note at the top (max 280 characters, with date and author) that only the
//   circle's admins can post, replace or remove; moderators and everyone else can't;
// - with no one opted in and no note the card isn't shown, except to the circle's admins and
//   moderators (they need it to opt in).
// The database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

const BAND_ID = "64f900000000000000000001";
const PERSON_ID = "64f900000000000000000002";
const ADMIN = "did:test:admin"; // opted in
const QUIET_ADMIN = "did:test:quiet-admin"; // not opted in
const MODERATOR = "did:test:moderator"; // opted in
const CREW = "did:test:crew"; // teamCardVisible set, but not a manager
const FAN = "did:test:fan";

const CONTACT = {
    email: "canary@example.invalid",
    phone: "+46 70 000 00 00",
    location: { precision: 4, city: "Canaryville", street: "Canary Street 1", lngLat: { lng: 18.1, lat: 59.3 } },
};

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({ ...realAuth, getAuthenticatedUserDid: async () => sessionDid }));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
    ...realNavigation,
    useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { getTeamCard } = await import("@/lib/data/team-card");
const { saveTeamNoteAction, removeTeamNoteAction, setTeamCardVisibilityAction } = await import("./team-card-actions");
const { default: TeamCard, shouldShowTeamCard } = await import("./team-card");
const { TEAM_NOTE_EDITOR_HINT, TEAM_NOTE_MAX_LENGTH } = await import("@/lib/peerify/team-card");

const profile = (did: string) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: `Name of ${did.split(":").pop()}`,
    circleType: "user",
    picture: { url: `/pictures/${did.split(":").pop()}.jpg` },
    ...CONTACT,
});

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [
            { _id: new ObjectId(BAND_ID), did: "did:test:band", handle: "band", name: "Band", circleType: "circle" },
            { _id: new ObjectId(PERSON_ID), did: FAN, handle: "fan", name: "Fan", circleType: "user" },
            ...[ADMIN, QUIET_ADMIN, MODERATOR, CREW].map(profile),
        ],
        Members: [
            { userDid: ADMIN, circleId: BAND_ID, userGroups: ["admins", "members"], teamCardVisible: true },
            { userDid: QUIET_ADMIN, circleId: BAND_ID, userGroups: ["admins", "members"] },
            { userDid: MODERATOR, circleId: BAND_ID, userGroups: ["moderators", "members"], teamCardVisible: true },
            { userDid: CREW, circleId: BAND_ID, userGroups: ["members", "crew"], teamCardVisible: true },
            { userDid: FAN, circleId: BAND_ID, userGroups: ["members"] },
            { userDid: FAN, circleId: PERSON_ID, userGroups: ["admins", "members"], teamCardVisible: true },
        ],
    });
});

describe("who appears", () => {
    test("only admins and moderators who opted in, with their role", async () => {
        const { members } = await getTeamCard(BAND_ID);
        expect(members.map((m) => [m.handle, m.role])).toEqual([
            ["admin", "Admin"],
            ["moderator", "Moderator"],
        ]);
    });

    test("name, picture, handle and role only: no email, phone, location or DID", async () => {
        sessionDid = ADMIN;
        await saveTeamNoteAction(BAND_ID, "Rehearsals on Thursdays.");
        const card = await getTeamCard(BAND_ID);
        for (const member of card.members) {
            expect(Object.keys(member).sort()).toEqual(["handle", "name", "pictureUrl", "role"]);
        }
        const text = JSON.stringify(card);
        for (const secret of [CONTACT.email, CONTACT.phone, "Canaryville", "Canary Street", "18.1", "did:test"]) {
            expect(text).not.toContain(secret);
        }
    });

    test("opting in is off by default and per circle; a follower or Crew member can't opt in", async () => {
        sessionDid = QUIET_ADMIN;
        expect((await setTeamCardVisibilityAction(BAND_ID, true)).success).toBe(true);
        expect((await getTeamCard(BAND_ID)).members.map((m) => m.handle)).toContain("quiet-admin");
        expect((await setTeamCardVisibilityAction(BAND_ID, false)).success).toBe(true);
        expect((await getTeamCard(BAND_ID)).members.map((m) => m.handle)).not.toContain("quiet-admin");

        for (const did of [FAN, CREW, undefined]) {
            sessionDid = did;
            expect((await setTeamCardVisibilityAction(BAND_ID, true)).success).toBe(false);
        }
    });

    test("personal profiles have no Team card", async () => {
        expect(await getTeamCard(PERSON_ID)).toEqual({ members: [], note: null });
    });
});

describe("the team note: admins only", () => {
    test("an admin posts it, with author and date; a new note replaces the old one", async () => {
        sessionDid = ADMIN;
        expect((await saveTeamNoteAction(BAND_ID, "  First note  ")).success).toBe(true);
        expect((await getTeamCard(BAND_ID)).note?.text).toBe("First note");
        sessionDid = QUIET_ADMIN; // any admin, opted in or not
        expect((await saveTeamNoteAction(BAND_ID, "Second note")).success).toBe(true);
        const { note } = await getTeamCard(BAND_ID);
        expect(note?.text).toBe("Second note");
        expect(note?.authorName).toBe("Name of quiet-admin");
        expect(Number.isNaN(Date.parse(note!.updatedAt))).toBe(false);
    });

    test("a moderator, a follower, a Crew member and a logged-out visitor can't post or remove it", async () => {
        sessionDid = ADMIN;
        await saveTeamNoteAction(BAND_ID, "Admins' note");
        for (const did of [MODERATOR, FAN, CREW, undefined]) {
            sessionDid = did;
            expect((await saveTeamNoteAction(BAND_ID, "Hijacked")).success).toBe(false);
            expect((await removeTeamNoteAction(BAND_ID)).success).toBe(false);
        }
        expect((await getTeamCard(BAND_ID)).note?.text).toBe("Admins' note");
    });

    test("max 280 characters, not empty", async () => {
        sessionDid = ADMIN;
        expect((await saveTeamNoteAction(BAND_ID, "x".repeat(TEAM_NOTE_MAX_LENGTH + 1))).success).toBe(false);
        expect((await saveTeamNoteAction(BAND_ID, "   ")).success).toBe(false);
        expect((await saveTeamNoteAction(BAND_ID, "x".repeat(TEAM_NOTE_MAX_LENGTH))).success).toBe(true);
    });

    test("an admin removes it", async () => {
        sessionDid = ADMIN;
        await saveTeamNoteAction(BAND_ID, "Soon gone");
        expect((await removeTeamNoteAction(BAND_ID)).success).toBe(true);
        expect((await getTeamCard(BAND_ID)).note).toBeNull();
    });
});

describe("the card", () => {
    const empty = { members: [], note: null };
    const withNote = {
        members: [],
        note: { text: "Hello", updatedAt: "2026-11-07T10:00:00.000Z", authorName: "Admin" },
    };
    const render = (data: any, viewerRole: "Admin" | "Moderator" | null) =>
        renderToStaticMarkup(
            <TeamCard circleId={BAND_ID} data={data} viewerRole={viewerRole} viewerOnCard={false} />,
        );

    test("nobody opted in and no note: not shown to visitors, shown to admins and moderators", () => {
        expect(shouldShowTeamCard(empty, null)).toBe(false);
        expect(render(empty, null)).toBe("");
        expect(shouldShowTeamCard(empty, "Moderator")).toBe(true);
        expect(shouldShowTeamCard(withNote, null)).toBe(true);
    });

    test("the note editor and its hint are for admins only", () => {
        const hint = TEAM_NOTE_EDITOR_HINT.replace("'", "&#x27;");
        expect(TEAM_NOTE_EDITOR_HINT).toBe(
            "Visible to everyone, also logged out. Don't share addresses or phone numbers here.",
        );
        expect(render(empty, "Admin")).toContain(hint);
        expect(render(withNote, "Admin")).toContain("Edit note");
        for (const role of ["Moderator", null] as const) {
            const html = render(withNote, role);
            expect(html).toContain("Hello");
            expect(html).not.toContain(hint);
            expect(html).not.toContain("Edit note");
            expect(html).not.toContain("<textarea");
        }
    });
});
