/**
 * Migration: account lifecycle fields (idempotent)
 *
 * PRINCIPLE: All fields written here are admin-only operational metadata.
 * They must never be surfaced in user-facing UI. See lib/auth/perks.ts.
 *
 * Fields written per user (sorted by _id = createdAt):
 *
 *   Users without accountStatus:
 *     "active"               → isMember || verificationStatus === "verified" || isVerified
 *     "pending_verification" → otherwise
 *
 *   Active users without verifiedAt:
 *     verifiedAt:  migration run time
 *     verifiedBy:  "system:migration"
 *
 *   Active users without isFoundingMember, while active-founder count < foundingMemberCap:
 *     isFoundingMember:        true
 *     foundingMemberNumber:    sequential among active users in createdAt order
 *     foundingMemberGrantedAt: migration run time
 *
 * platformSettings upserted (only advances, never rewinds):
 *   signupOrderCounter:    highest signupOrder assigned
 *   foundingMemberCounter: highest foundingMemberNumber assigned
 *
 * Dry-run (default): bun scripts/migrate-account-lifecycle.ts
 * Apply:             bun scripts/migrate-account-lifecycle.ts --apply
 *
 * Requires MONGODB_URI (with the database in its path) and EXPECT_DB naming that database,
 * e.g. EXPECT_DB=peerify_staging.
 */

import { MongoClient } from "mongodb";

// The database comes from MONGODB_URI's path, never a default, and must match EXPECT_DB,
// so the script can't run against the wrong environment's data by accident.
const MONGODB_URI = process.env.MONGODB_URI ?? "";
if (!MONGODB_URI) {
    console.error("Refusing to run: MONGODB_URI is not set.");
    process.exit(1);
}
let dbName = "";
try {
    dbName = new URL(MONGODB_URI).pathname.replace(/^\//, "");
} catch {
    // Never print the error: it carries the URI, credentials included.
    console.error("Refusing to run: MONGODB_URI is not a valid URI.");
    process.exit(1);
}
if (!dbName) {
    console.error("Refusing to run: MONGODB_URI names no database.");
    process.exit(1);
}
if (!/^[A-Za-z0-9_-]+$/.test(dbName)) {
    // Not a plain database name, so the URI is malformed and the "path" may hold credentials.
    console.error("Refusing to run: MONGODB_URI is malformed (unexpected characters in the database name).");
    process.exit(1);
}
if (process.env.EXPECT_DB !== dbName) {
    console.error(`Refusing to run: EXPECT_DB must be set to the database in MONGODB_URI ("${dbName}").`);
    process.exit(1);
}

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const mode = apply ? "apply" : "dry-run";

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(dbName);
    const circles = db.collection("circles");
    const platformSettings = db.collection("platformSettings");

    const now = new Date();

    const settings = await platformSettings.findOne({ _id: "singleton" as any });
    const foundingMemberCap = settings?.foundingMemberCap ?? 1000;

    const allUsers = await circles
        .find({ circleType: "user" })
        .project({
            _id: 1,
            name: 1,
            isMember: 1,
            verificationStatus: 1,
            isVerified: 1,
            signupOrder: 1,
            accountStatus: 1,
            isFoundingMember: 1,
            foundingMemberNumber: 1,
            verifiedAt: 1,
        })
        .sort({ _id: 1 })
        .toArray();

    console.log(`Found ${allUsers.length} total users\n`);

    // Idempotency: start counters above any already-assigned values
    let nextSignupOrder = 1;
    let nextFoundingNumber = 0;
    for (const u of allUsers) {
        if (u.signupOrder >= nextSignupOrder) nextSignupOrder = u.signupOrder + 1;
        if (u.foundingMemberNumber > nextFoundingNumber) nextFoundingNumber = u.foundingMemberNumber;
    }

    // Cap check uses active-founder count (same semantic as verifyAccount):
    // decreases on revocation, so revoked slots can be filled up to the cap.
    const existingActiveFounderCount = await circles.countDocuments({
        circleType: "user",
        isFoundingMember: true,
    });
    let activeFoundingCount = existingActiveFounderCount;

    const legacyWithoutSignupOrder = allUsers.filter((u) => !u.signupOrder).length;

    const plans: Array<{ user: any; fields: Record<string, unknown> }> = [];

    for (const user of allUsers) {
        const fields: Record<string, unknown> = {};

        if (!user.accountStatus) {
            const isActive =
                user.isMember === true ||
                user.verificationStatus === "verified" ||
                user.isVerified === true;
            fields.accountStatus = isActive ? "active" : "pending_verification";
        }

        const willBeActive = (fields.accountStatus ?? user.accountStatus) === "active";

        if (willBeActive) {
            if (!user.verifiedAt) {
                fields.verifiedAt = now;
                fields.verifiedBy = "system:migration";
            }

            if (!user.isFoundingMember && !user.foundingMemberNumber) {
                if (activeFoundingCount < foundingMemberCap) {
                    activeFoundingCount++;
                    nextFoundingNumber++;
                    fields.isFoundingMember = true;
                    fields.foundingMemberNumber = nextFoundingNumber;
                    fields.foundingMemberGrantedAt = now;
                }
            }
        }

        if (Object.keys(fields).length > 0) {
            plans.push({ user, fields });
        }
    }

    for (const { user, fields } of plans) {
        console.log(`[${mode}] ${user.name} (${user._id}):`);
        for (const [k, v] of Object.entries(fields)) {
            console.log(`  ${k}: ${v instanceof Date ? v.toISOString() : JSON.stringify(v)}`);
        }
        console.log();
    }

    const counterPatch: Record<string, unknown> = {};
    const highestSignupOrder = nextSignupOrder - 1;
    const highestFoundingNumber = nextFoundingNumber;

    if (highestSignupOrder > (settings?.signupOrderCounter ?? 0)) {
        counterPatch.signupOrderCounter = highestSignupOrder;
    }
    if (highestFoundingNumber > (settings?.foundingMemberCounter ?? 0)) {
        counterPatch.foundingMemberCounter = highestFoundingNumber;
    }

    if (Object.keys(counterPatch).length > 0) {
        console.log(`[${mode}] platformSettings: ${JSON.stringify(counterPatch)}\n`);
    }

    if (apply) {
        for (const { user, fields } of plans) {
            await circles.updateOne({ _id: user._id }, { $set: fields });
        }
        if (Object.keys(counterPatch).length > 0) {
            await platformSettings.updateOne(
                { _id: "singleton" as any },
                {
                    $set: counterPatch,
                    $setOnInsert: { foundingMemberWindowOpen: true, foundingMemberCap: 1000 },
                },
                { upsert: true },
            );
        }
    }

    const activeCount = plans.filter(
        (p) => (p.fields.accountStatus ?? p.user.accountStatus) === "active",
    ).length;
    const pendingCount = plans.filter(
        (p) => (p.fields.accountStatus ?? p.user.accountStatus) === "pending_verification",
    ).length;
    const foundingCount = plans.filter((p) => p.fields.isFoundingMember).length;
    const skipped = allUsers.length - plans.length;

    console.log(`Skipped signupOrder backfill for ${legacyWithoutSignupOrder} legacy users.\n`);

    console.log(`Summary (${mode}):`);
    console.log(`  users updated:         ${plans.length}`);
    console.log(`  → active:              ${activeCount}`);
    console.log(`  → pending:             ${pendingCount}`);
    console.log(`  → founding granted:    ${foundingCount}`);
    console.log(`  already complete:      ${skipped}`);
    console.log(`  signupOrderCounter:    ${highestSignupOrder}`);
    console.log(`  foundingMemberCounter: ${highestFoundingNumber}`);

    await client.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
