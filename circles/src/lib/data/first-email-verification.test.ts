// Run: bun test src/lib/data/first-email-verification.test.ts
// circle/member/user data modules are mocked; this checks what runs, in which order, and that a
// failure in one step never blocks the other or the verification that called it.

import { beforeEach, describe, expect, mock, test } from "bun:test";

const calls: string[] = [];
let loungeExists = true;
let alreadyMember = false;
let addMemberThrows = false;

mock.module("./circle", () => ({
    getCircleByHandle: async (handle: string) => {
        calls.push(`getCircleByHandle:${handle}`);
        return loungeExists ? { _id: "lounge-id", handle } : null;
    },
    autoVerifyUserIfReady: async (id: string) => {
        calls.push(`autoVerify:${id}`);
        return {};
    },
}));
mock.module("./member", () => ({
    getMember: async () => (alreadyMember ? { userDid: "did-1", circleId: "lounge-id" } : null),
    addMember: async (did: string, circleId: string, groups: string[]) => {
        if (addMemberThrows) throw new Error("db down");
        calls.push(`addMember:${did}:${circleId}:${groups.join(",")}`);
        return {};
    },
}));
mock.module("./user", () => ({
    pinCircle: async (did: string, circleId: string) => {
        calls.push(`pin:${did}:${circleId}`);
    },
}));

const { completeFirstEmailVerification, BACKSTAGE_LOUNGE_HANDLE } = await import("./first-email-verification");

describe("completeFirstEmailVerification", () => {
    beforeEach(() => {
        calls.length = 0;
        loungeExists = true;
        alreadyMember = false;
        addMemberThrows = false;
    });

    test("follows and pins the Lounge as a plain member, then runs auto-verify", async () => {
        await completeFirstEmailVerification({ _id: "user-oid", did: "did-1" });
        expect(calls).toEqual([
            `getCircleByHandle:${BACKSTAGE_LOUNGE_HANDLE}`,
            "addMember:did-1:lounge-id:members",
            "pin:did-1:lounge-id",
            "autoVerify:user-oid",
        ]);
    });

    test("an existing Lounge membership (pre-change signup) is left alone", async () => {
        alreadyMember = true;
        await completeFirstEmailVerification({ _id: "user-oid", did: "did-1" });
        expect(calls).toEqual([`getCircleByHandle:${BACKSTAGE_LOUNGE_HANDLE}`, "autoVerify:user-oid"]);
    });

    test("no Lounge in this environment: only auto-verify runs", async () => {
        loungeExists = false;
        await completeFirstEmailVerification({ _id: "user-oid", did: "did-1" });
        expect(calls).toEqual([`getCircleByHandle:${BACKSTAGE_LOUNGE_HANDLE}`, "autoVerify:user-oid"]);
    });

    test("an enrolment failure is logged and auto-verify still runs", async () => {
        addMemberThrows = true;
        const errors: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => errors.push(String(args[0]));
        try {
            await completeFirstEmailVerification({ _id: "user-oid", did: "did-1" });
        } finally {
            console.error = original;
        }
        expect(calls.at(-1)).toBe("autoVerify:user-oid");
        expect(errors[0]).toContain("Failed to enroll user did-1");
    });

    test("no did: nothing runs", async () => {
        await completeFirstEmailVerification({ _id: "user-oid", did: null });
        expect(calls).toEqual([]);
    });
});
