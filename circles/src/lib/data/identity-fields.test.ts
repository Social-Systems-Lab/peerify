// Run: IS_BUILD=true bun test src/lib/data/identity-fields.test.ts
// Round 3, item 4 (2026-10-20): issue and goal authors/assignees, funding creators/supporters, the
// chat room's circle and the chat sender fallback carry identity fields only (name, handle,
// picture, plus ids and circleType). Issues and goals are aggregates, which the fake DB doesn't run,
// so their author/assignee $lookup projections are checked directly. Every test fails on the code
// before this change: the full SAFE_CIRCLE_PROJECTION (location, metadata, interests...) went out.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ObjectId } from "mongodb";
import { createFakeDb } from "@/lib/testing/fake-db";

const fakeDb = createFakeDb();
const pipelines: { collection: string; pipeline: any[] }[] = [];
const capturing = (name: "Issues" | "Goals") => ({
    ...(fakeDb.module as any)[name],
    aggregate: (pipeline: any[]) => {
        pipelines.push({ collection: name, pipeline });
        return { toArray: async () => [] };
    },
});
mock.module("@/lib/data/db", () => ({ ...fakeDb.module, Issues: capturing("Issues"), Goals: capturing("Goals") }));

const { getIssuesByCircleId, getIssueById } = await import("./issue");
const { getGoalsByCircleId, getGoalById } = await import("./goal");
const { getFundingAskById } = await import("./funding");
const { mapConversationToChatRoomDisplay } = await import("./mongo-chat");

const IDENTITY_KEYS = new Set([
    "_id",
    "did",
    "handle",
    "name",
    "picture",
    "circleType",
    "isVerified",
    "searchable",
    "mapVisible",
    "metadata.peerify.intent",
    "metadata.peerify.managedIdentity",
    "metadata.peerify.identityType",
]);
const PERSON_LOOKUPS = new Set(["authorDetails", "assigneeDetails"]);

// Every $project inside a $lookup on "circles" that resolves a person (author/assignee).
const personProjections = () =>
    pipelines.flatMap(({ collection, pipeline }) =>
        pipeline
            .filter((stage) => stage.$lookup?.from === "circles" && PERSON_LOOKUPS.has(stage.$lookup.as))
            .map((stage) => ({
                where: `${collection}.${stage.$lookup.as}`,
                keys: Object.keys(stage.$lookup.pipeline.find((s: any) => s.$project)?.$project ?? {}),
            })),
    );

const STREET = "Personvägen 8";
const person = (did: string) => ({
    _id: new ObjectId(),
    did,
    handle: did.split(":").pop(),
    name: "Person",
    circleType: "user",
    picture: { url: "https://img.test/p.png" },
    location: { precision: 4, city: "Gävle", street: STREET, lngLat: { lng: 17.14, lat: 60.67 } },
    interests: ["private-interest"],
    metadata: { peerify: { onboardingFlow: "private-flow" } },
});
const leaks = (output: unknown) => {
    const text = JSON.stringify(output) ?? "";
    return text.includes(STREET) || text.includes("private-interest") || text.includes("private-flow");
};

const CIRCLE_ID = "64e000000000000000000001";
const ASK_ID = "64e0000000000000000000a1";
const CREATOR = "did:test:creator";
const MEMBER = "did:test:member";

beforeEach(() => {
    pipelines.length = 0;
    fakeDb.reset({
        Circles: [
            {
                _id: new ObjectId(CIRCLE_ID),
                did: "did:test:circle",
                handle: "band",
                name: "Band",
                circleType: "circle",
                enabledModules: ["funding"],
                description: "About the band",
                location: { precision: 4, city: "Gävle", street: STREET, lngLat: { lng: 17.14, lat: 60.67 } },
                metadata: { peerify: { onboardingFlow: "private-flow" } },
            },
            person(CREATOR),
            person(MEMBER),
        ],
        Members: [{ userDid: MEMBER, circleId: CIRCLE_ID }],
        FundingAsks: [
            {
                _id: new ObjectId(ASK_ID),
                circleId: CIRCLE_ID,
                createdByDid: CREATOR,
                title: "New amp",
                shortStory: "x",
                status: "open",
                items: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ],
    });
});

describe("issue and goal authors/assignees", () => {
    test("every author/assignee lookup projects identity fields only", async () => {
        const calls = [
            () => getIssuesByCircleId(CIRCLE_ID, MEMBER),
            () => getIssueById("64e0000000000000000000b1", MEMBER),
            () => getGoalsByCircleId(CIRCLE_ID, MEMBER),
            () => getGoalById("64e0000000000000000000c1", MEMBER),
        ];
        for (const call of calls) await (call as () => Promise<unknown>)().catch(() => undefined);
        const projections = personProjections();
        expect(projections.length).toBeGreaterThan(3);
        for (const { where, keys } of projections) {
            expect({ where, extra: keys.filter((k) => !IDENTITY_KEYS.has(k)) }).toEqual({ where, extra: [] });
        }
    });
});

describe("funding creator", () => {
    test("the ask's creator comes back with identity fields only", async () => {
        const circle = (await fakeDb.col("Circles").findOne({ handle: "band" })) as any;
        const ask = await getFundingAskById({ ...circle, _id: CIRCLE_ID }, ASK_ID, MEMBER);
        expect(ask?.creator?.handle).toBe("creator");
        expect(leaks(ask?.creator)).toBe(false);
    });
});

describe("chat room circle", () => {
    test("room.circle is identity only", async () => {
        const room = await mapConversationToChatRoomDisplay(MEMBER, {
            _id: new ObjectId(),
            type: "group",
            circleId: CIRCLE_ID,
            participants: [MEMBER],
            createdAt: new Date(),
            updatedAt: new Date(),
        } as any);
        expect(room?.circle?.handle).toBe("band");
        expect(leaks(room?.circle)).toBe(false);
        expect(JSON.stringify(room?.circle)).not.toContain("About the band");
    });
});
