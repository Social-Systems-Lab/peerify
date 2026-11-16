/**
 * READ-ONLY check (2026-11-16): was the cross-circle gap in the task actions used?
 *
 * Until fix/task-actions-circle-check, an admin or moderator of any circle could act on another
 * circle's task or shift by its id (confirm a sign-up, review a claim, assign, change the stage,
 * set attendance, ...). This lists every such action the stored data shows that was made by someone
 * who isn't the author, an admin or moderator of the task's own circle, the owner of a personal
 * circle or a platform admin. The logic and its limits are in src/lib/tasks/cross-circle-audit.ts.
 *
 * It only reads (find with projections). It prints counts and task ids, kinds and dates: no DIDs,
 * names, emails or addresses.
 *
 * Run as peerify on the box, from the app checkout's circles/ dir, with the app env (MONGODB_URI).
 * EXPECT_DB must match the database name:
 *   (set -a; . /srv/peerify/env/app.env; set +a; EXPECT_DB=<db name> bun scripts/check-cross-circle-task-actions.ts)
 */

import { MongoClient } from "mongodb";
import {
    auditTaskActions,
    formatAuditReport,
    type AuditNotification,
    type AuditTask,
    type CircleRoles,
} from "../src/lib/tasks/cross-circle-audit";

const refuse = (message: string): never => {
    console.error(`Refusing to run: ${message}`);
    process.exit(1);
};

if (process.argv.length > 2) refuse("this script takes no arguments.");
const MONGODB_URI = process.env.MONGODB_URI ?? refuse("MONGODB_URI is not set (source the app env).");
const EXPECT_DB = process.env.EXPECT_DB ?? refuse("set EXPECT_DB to the database name the URI points at.");

const TASK_PROJECTION = {
    _id: 1,
    circleId: 1,
    createdBy: 1,
    assignedTo: 1,
    acceptedBy: 1,
    acceptedAt: 1,
    submittedForReviewBy: 1,
    submittedForReviewAt: 1,
    claimApprovedBy: 1,
    claimApprovedAt: 1,
    reviewRequestedChangesBy: 1,
    reviewRequestedChangesAt: 1,
    verifiedBy: 1,
    verifiedAt: 1,
    "participants.verifiedBy": 1,
    "participants.verifiedAt": 1,
    "participants.attendanceVerifiedBy": 1,
    "participants.attendanceVerifiedAt": 1,
    "claims.reviewedBy": 1,
    "claims.reviewedAt": 1,
};

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    try {
        const db = client.db();
        if (db.databaseName !== EXPECT_DB) refuse(`connected to "${db.databaseName}", EXPECT_DB is "${EXPECT_DB}".`);

        const tasks = (await db.collection("tasks").find({}, { projection: TASK_PROJECTION }).toArray()) as AuditTask[];
        const notifications = (await db
            .collection("notifications")
            .find(
                { type: { $in: ["task_assigned", "task_status_changed"] } },
                { projection: { _id: 0, type: 1, createdAt: 1, "content.taskId": 1, "content.user.did": 1 } },
            )
            .toArray()) as unknown as AuditNotification[];

        const circleIds = Array.from(
            new Set(
                tasks
                    .map((task) => task.circleId)
                    .filter(Boolean)
                    .map(String),
            ),
        );
        const members = await db
            .collection("members")
            .find({ circleId: { $in: circleIds } }, { projection: { _id: 0, circleId: 1, userDid: 1, userGroups: 1 } })
            .toArray();
        const circles = await db
            .collection("circles")
            .find(
                { $or: [{ isAdmin: true }, { circleType: "user" }] },
                { projection: { _id: 1, did: 1, isAdmin: 1, circleType: 1 } },
            )
            .toArray();

        const rolesByCircleId = new Map<string, CircleRoles>();
        const rolesFor = (circleId: string) => {
            let roles = rolesByCircleId.get(circleId);
            if (!roles) {
                roles = { managers: new Set(), members: new Set() };
                rolesByCircleId.set(circleId, roles);
            }
            return roles;
        };
        for (const member of members) {
            const roles = rolesFor(String(member.circleId));
            roles.members.add(member.userDid);
            const groups: string[] = Array.isArray(member.userGroups) ? member.userGroups : [];
            if (groups.includes("admins") || groups.includes("moderators")) roles.managers.add(member.userDid);
        }
        const platformAdmins = new Set<string>();
        for (const circle of circles) {
            if (circle.isAdmin === true && typeof circle.did === "string") platformAdmins.add(circle.did);
            if (
                circle.circleType === "user" &&
                typeof circle.did === "string" &&
                circleIds.includes(String(circle._id))
            ) {
                rolesFor(String(circle._id)).ownerDid = circle.did;
            }
        }

        const result = auditTaskActions({ tasks, notifications, rolesByCircleId, platformAdmins });
        console.log(`Database: ${db.databaseName}. Read-only; nothing was written.`);
        console.log(formatAuditReport(result, { tasks: tasks.length, notifications: notifications.length }));
    } finally {
        await client.close();
    }
}

main().catch((error) => {
    console.error("Check failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
