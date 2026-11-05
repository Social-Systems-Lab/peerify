// Run: IS_BUILD=true bun test src/lib/data/requester-email-leaks.test.ts
// Leak round 3, H7 (2026-11-05): getAllMembershipRequests and getAllCrewApplications projected the
// requester's email ("$userDetails.email") to the circle's managers. Membership-request tables showed
// it, and crew applications sent it in the page payload. For an approval-required personal profile
// the "manager" is a stranger, and rejected requests kept it. Now the row carries name, handle and
// picture only. The aggregate below runs the real pipeline's $match/$lookup/$unwind/$project/$sort
// over in-memory documents, so the test checks what the query would really return.

import { describe, expect, mock, test } from "bun:test";

type Doc = Record<string, any>;

const CANARY_EMAIL = "requester-canary@example.invalid";
const CIRCLE_ID = "64f000000000000000000001";
const users: Doc[] = [
    { did: "did:test:requester", handle: "requester", name: "Requester", email: CANARY_EMAIL, picture: { url: "p" } },
];
const rows: Doc[] = [
    { _id: "r1", userDid: "did:test:requester", circleId: CIRCLE_ID, status: "pending", requestedAt: new Date() },
    { _id: "r2", userDid: "did:test:requester", circleId: CIRCLE_ID, status: "rejected", requestedAt: new Date() },
];

const get = (doc: Doc, path: string) => path.split(".").reduce<any>((v, k) => (v == null ? undefined : v[k]), doc);
const runPipeline = (pipeline: Doc[]) => {
    let docs = rows.map((d) => ({ ...d }));
    for (const stage of pipeline) {
        if (stage.$match) {
            docs = docs.filter((d) => Object.entries(stage.$match).every(([k, v]) => get(d, k) === v));
        } else if (stage.$lookup) {
            const { localField, foreignField, as } = stage.$lookup;
            docs = docs.map((d) => ({ ...d, [as]: users.filter((u) => u[foreignField] === d[localField]) }));
        } else if (stage.$unwind) {
            const field = String(stage.$unwind).slice(1);
            docs = docs.flatMap((d) => (d[field] ?? []).map((v: Doc) => ({ ...d, [field]: v })));
        } else if (stage.$project) {
            docs = docs.map((d) => {
                const out: Doc = {};
                for (const [key, spec] of Object.entries(stage.$project)) {
                    if (spec === 1) out[key] = d[key];
                    else if (typeof spec === "string" && spec.startsWith("$")) out[key] = get(d, spec.slice(1));
                    else if (spec && typeof spec === "object" && "$toString" in spec)
                        out[key] = String(get(d, String(spec.$toString).slice(1)));
                }
                return out;
            });
        }
    }
    return docs;
};
const collection = { aggregate: (pipeline: Doc[]) => ({ toArray: async () => runPipeline(pipeline) }) };
mock.module("@/lib/data/db", () => ({ MembershipRequests: collection, CrewApplications: collection }));

const { getAllMembershipRequests } = await import("./membership-requests");
const { getAllCrewApplications } = await import("./crew-applications");

describe("requester rows for circle managers", () => {
    test("membership requests (pending and rejected): no email; name and handle stay", async () => {
        const { pendingRequests, rejectedRequests } = await getAllMembershipRequests(CIRCLE_ID);
        expect(JSON.stringify([pendingRequests, rejectedRequests])).not.toContain(CANARY_EMAIL);
        expect([pendingRequests[0]?.name, pendingRequests[0]?.handle]).toEqual(["Requester", "requester"]);
        expect([rejectedRequests[0]?.name, rejectedRequests[0]?.handle]).toEqual(["Requester", "requester"]);
    });

    test("crew applications: no email; name and handle stay", async () => {
        const { pendingApplications, rejectedApplications } = await getAllCrewApplications(CIRCLE_ID);
        expect(JSON.stringify([pendingApplications, rejectedApplications])).not.toContain(CANARY_EMAIL);
        expect([pendingApplications[0]?.name, pendingApplications[0]?.handle]).toEqual(["Requester", "requester"]);
    });
});
