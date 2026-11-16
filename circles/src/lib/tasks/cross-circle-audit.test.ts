// Run: IS_BUILD=true bun test src/lib/tasks/cross-circle-audit.test.ts
// The read-only prod check for the cross-circle gap (scripts/check-cross-circle-task-actions.ts):
// which actions it flags, that it prints no DIDs, and that the script only reads.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditTaskActions, formatAuditReport, type CircleRoles } from "./cross-circle-audit";

const Y = "circle-y";
const AUTHOR = "did:test:author";
const ADMIN_Y = "did:test:admin-y";
const MOD_Y = "did:test:mod-y";
const MEMBER_Y = "did:test:member-y";
const OUTSIDER = "did:test:admin-of-another-circle";
const PLATFORM = "did:test:platform";
const when = new Date("2026-11-10T12:00:00Z");

const roles = new Map<string, CircleRoles>([
    [Y, { managers: new Set([ADMIN_Y, MOD_Y]), members: new Set([ADMIN_Y, MOD_Y, MEMBER_Y, AUTHOR]) }],
]);
const run = (tasks: object[], notifications: object[] = []) =>
    auditTaskActions({
        tasks: tasks as never,
        notifications: notifications as never,
        rolesByCircleId: roles,
        platformAdmins: new Set([PLATFORM]),
    });

describe("what it flags", () => {
    test("the task's own admins, moderators and author are fine; an outsider is flagged", () => {
        const result = run([
            {
                _id: "t1",
                circleId: Y,
                createdBy: AUTHOR,
                participants: [
                    { verifiedBy: ADMIN_Y, verifiedAt: when },
                    { verifiedBy: OUTSIDER, verifiedAt: when, attendanceVerifiedBy: MOD_Y, attendanceVerifiedAt: when },
                ],
                claims: [{ reviewedBy: AUTHOR, reviewedAt: when }],
            },
        ]);
        expect(result.checked.shift_confirmation).toBe(2);
        expect(result.findings).toEqual([{ kind: "shift_confirmation", taskId: "t1", at: when, reason: "not_member" }]);
    });

    test("a member who isn't a manager is flagged separately; a platform admin is counted, not flagged", () => {
        const result = run([
            {
                _id: "t2",
                circleId: Y,
                createdBy: AUTHOR,
                claimApprovedBy: MEMBER_Y,
                claimApprovedAt: when,
                verifiedBy: PLATFORM,
            },
        ]);
        expect(result.findings).toEqual([
            { kind: "claim_approval", taskId: "t2", at: when, reason: "member_not_manager" },
        ]);
        expect(result.byPlatformAdmin.completion_verified).toBe(1);
    });

    test("accept and submit for review by someone other than the assignee", () => {
        const result = run([
            {
                _id: "t3",
                circleId: Y,
                createdBy: AUTHOR,
                assignedTo: MEMBER_Y,
                acceptedBy: MEMBER_Y,
                submittedForReviewBy: OUTSIDER,
            },
        ]);
        expect(result.findings.map((f) => [f.kind, f.reason])).toEqual([["submitted_not_assignee", "not_assignee"]]);
    });

    test("assignment and stage change from notifications, once per action however many were told", () => {
        const result = run(
            [{ _id: "t4", circleId: Y, createdBy: AUTHOR }],
            [
                { type: "task_assigned", createdAt: when, content: { taskId: "t4", user: { did: OUTSIDER } } },
                { type: "task_status_changed", createdAt: when, content: { taskId: "t4", user: { did: OUTSIDER } } },
                { type: "task_status_changed", createdAt: when, content: { taskId: "t4", user: { did: OUTSIDER } } },
                { type: "task_status_changed", createdAt: when, content: { taskId: "t4", user: { did: ADMIN_Y } } },
                { type: "task_status_changed", createdAt: when, content: { taskId: "gone", user: { did: OUTSIDER } } },
                { type: "task_verified", createdAt: when, content: { taskId: "t4", user: { did: OUTSIDER } } },
            ],
        );
        expect(result.findings.map((f) => f.kind).sort()).toEqual(["assignment", "stage_change"]);
        expect(result.checked.stage_change).toBe(2);
        expect(result.notificationsForUnknownTasks).toBe(1);
    });

    test("the owner of a personal circle counts as its manager", () => {
        const personal = new Map<string, CircleRoles>([
            ["me", { ownerDid: MEMBER_Y, managers: new Set(), members: new Set() }],
        ]);
        const result = auditTaskActions({
            tasks: [{ _id: "t5", circleId: "me", createdBy: AUTHOR, verifiedBy: MEMBER_Y }],
            notifications: [],
            rolesByCircleId: personal,
            platformAdmins: new Set(),
        });
        expect(result.findings).toEqual([]);
    });
});

describe("the report", () => {
    test("counts and task ids only: no DIDs", () => {
        const result = run([
            { _id: "t1", circleId: Y, createdBy: AUTHOR, participants: [{ verifiedBy: OUTSIDER, verifiedAt: when }] },
        ]);
        const report = formatAuditReport(result, { tasks: 1, notifications: 0 });
        expect(report).toContain("FLAGGED: 1");
        expect(report).toContain("task t1  shift_confirmation  not_member  2026-11-10T12:00:00.000Z");
        expect(report).not.toContain("did:");
    });
});

describe("the script only reads", () => {
    test("no write, delete, update, insert, drop or index calls", () => {
        const source = readFileSync(
            new URL("../../../scripts/check-cross-circle-task-actions.ts", import.meta.url),
            "utf8",
        );
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        const writeCall =
            /\.(insert|update|replace|delete|remove|drop|bulkWrite|findOneAnd|createIndex|rename)\w*\s*\(/i;
        expect(writeCall.test(code)).toBe(false);
        expect(code).toContain(".find(");
    });
});
