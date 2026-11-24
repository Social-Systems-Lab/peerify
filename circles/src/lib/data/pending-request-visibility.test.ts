// Run: IS_BUILD=true bun test src/lib/data/pending-request-visibility.test.ts
// While a connection request is pending, its recipient sees the sender's full profile, the page
// and the preview, so they can decide (Tim, 2026-11-24). One way only: the sender still sees the
// recipient's limited version. It ends when the request is declined or withdrawn. Lists (search,
// followers rows, post authors) keep the accepted-connections rule. Checks what the server sends.
// The database is in-memory fakes; the session is stubbed.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
mock.module("@/lib/data/db", () => fakeDb.module);

let sessionDid: string | undefined;
const realAuth = await import("@/lib/auth/auth");
mock.module("@/lib/auth/auth", () => ({
    ...realAuth,
    getAuthenticatedUserDid: async () => sessionDid,
    isAuthorized: async () => false,
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { canViewFullPersonalProfile, getFullProfileOwnerDids } = await import("./personal-profile-access");
const { default: CircleLayout } = await import("@/app/circles/[handle]/layout");
const { POST: accessPost } = await import("@/app/api/access/route");
const { getPersonalProfilePreviewAction, withdrawConnectRequestAction, declineConnectRequestAction } = await import(
    "@/components/modules/home/actions"
);

const SENDER = "did:test:sender";
const RECIPIENT = "did:test:recipient";
const STRANGER = "did:test:stranger";

const person = (did: string, handle: string) => ({
    _id: new ObjectId(),
    did,
    handle,
    name: handle,
    circleType: "user",
    publishStatus: "published",
    isVerified: true,
    enabledModules: ["home", "feed", "followers", "settings"],
    description: `CANARY about ${handle}`,
});
const edge = (fromDid: string, toDid: string, connectStatus: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(),
    fromDid,
    toDid,
    connectStatus,
    isFollowing: false,
    ...extra,
});

// SENDER asked RECIPIENT to connect: the two edges sendConnectRequestAction writes.
const pendingRequest = () => [edge(SENDER, RECIPIENT, "pending_sent"), edge(RECIPIENT, SENDER, "pending_received")];

beforeEach(() => {
    sessionDid = undefined;
    fakeDb.reset({
        Circles: [person(SENDER, "sender"), person(RECIPIENT, "recipient"), person(STRANGER, "stranger")],
        UserRelationships: pendingRequest(),
        Notifications: [],
    });
});

const personal = (did: string) => ({ circleType: "user" as const, did });
const renderLayout = async (handle: string) => {
    const previous = process.env.IS_BUILD;
    process.env.IS_BUILD = "false";
    try {
        return await CircleLayout({ params: Promise.resolve({ handle }), children: { type: "div", props: {} } as any });
    } finally {
        process.env.IS_BUILD = previous;
    }
};
const isLimitedPage = (tree: any) => tree?.type?.name === "PersonalProfilePlaceholder";
const ask = async (circleHandle: string, moduleHandle: string) =>
    (
        await accessPost(
            new Request("http://test/api/access", {
                method: "POST",
                body: JSON.stringify({ circleHandle, moduleHandle }),
            }),
        )
    ).json();

describe("the rule", () => {
    test("the recipient sees the sender in full; the sender still sees the recipient limited", async () => {
        expect(await canViewFullPersonalProfile(personal(SENDER), RECIPIENT)).toBe(true);
        expect(await canViewFullPersonalProfile(personal(RECIPIENT), SENDER)).toBe(false);
    });

    test("a stranger still sees both limited", async () => {
        expect(await canViewFullPersonalProfile(personal(SENDER), STRANGER)).toBe(false);
        expect(await canViewFullPersonalProfile(personal(RECIPIENT), STRANGER)).toBe(false);
    });

    test("lists keep the accepted-connections rule", async () => {
        expect((await getFullProfileOwnerDids(RECIPIENT, [SENDER])).has(SENDER)).toBe(false);
    });
});

describe("the page and the preview", () => {
    test("the recipient: the sender's full page, tabs open, and the full preview", async () => {
        sessionDid = RECIPIENT;
        const tree = await renderLayout("sender");
        expect(isLimitedPage(tree)).toBe(false);
        expect(JSON.stringify(tree)).toContain("CANARY about sender");
        expect(await ask("sender", "feed")).toEqual({ authenticated: true, authorized: true });
        const preview = await getPersonalProfilePreviewAction(SENDER);
        expect(preview.kind).toBe("full");
        expect(JSON.stringify(preview)).toContain("CANARY about sender");
    });

    test("the sender: the recipient's limited page and preview", async () => {
        sessionDid = SENDER;
        const tree = await renderLayout("recipient");
        expect(isLimitedPage(tree)).toBe(true);
        expect(JSON.stringify(tree)).not.toContain("CANARY");
        expect(await ask("recipient", "feed")).toEqual({ authenticated: true, authorized: false });
        expect((await getPersonalProfilePreviewAction(RECIPIENT)).kind).toBe("limited");
    });
});

describe("it ends when the request is declined or withdrawn", () => {
    test("declined: the recipient sees the sender limited again", async () => {
        sessionDid = RECIPIENT;
        expect((await declineConnectRequestAction(SENDER)).success).toBe(true);
        expect(await canViewFullPersonalProfile(personal(SENDER), RECIPIENT)).toBe(false);
        expect(isLimitedPage(await renderLayout("sender"))).toBe(true);
    });

    test("withdrawn: the recipient sees the sender limited again", async () => {
        sessionDid = SENDER;
        expect((await withdrawConnectRequestAction(RECIPIENT)).success).toBe(true);
        sessionDid = RECIPIENT;
        expect(await canViewFullPersonalProfile(personal(SENDER), RECIPIENT)).toBe(false);
        expect((await getPersonalProfilePreviewAction(SENDER)).kind).toBe("limited");
    });

    test("a resend inside the decline cooldown doesn't reopen it", async () => {
        // After a decline the sender's edge keeps pending_sent with declinedAt; the recipient's
        // edge was reset, and a resend inside the cooldown writes no edge for the recipient.
        fakeDb.reset({
            Circles: [person(SENDER, "sender"), person(RECIPIENT, "recipient")],
            UserRelationships: [
                edge(SENDER, RECIPIENT, "pending_sent", { declinedAt: new Date(Date.now() - 86_400_000) }),
                edge(RECIPIENT, SENDER, "none"),
            ],
        });
        expect(await canViewFullPersonalProfile(personal(SENDER), RECIPIENT)).toBe(false);
    });
});
