/**
 * One-off: purge reviewed, never-verified bot accounts with everything they created, using
 * purgeUnverifiedAccount's rules (src/lib/data/purge-unverified.ts). Only DIDs listed in LIST_FILE
 * are considered, and each one is re-checked here: anything active, verified, or with activity a
 * person might care about is skipped and reported, never partly deleted.
 *
 * Dry run (default, no writes): prints per account what would be deleted, or why it is skipped.
 *   ENV_FILE=<app env file> EXPECT_DB=<db name> LIST_FILE=<reviewed list> KEEP_FILE=<keep list> bun scripts/purge-unverified-accounts.ts
 * Apply (after a mongodump; BACKUP_DIR must not exist yet):
 *   ENV_FILE=... EXPECT_DB=... LIST_FILE=... KEEP_FILE=... BACKUP_DIR=<new dir> APPLY=1 bun scripts/purge-unverified-accounts.ts
 *
 * ENV_FILE is the env file the running app uses (MONGODB_URI, APP_DIR, VDB settings). EXPECT_DB must
 * equal the database in its MONGODB_URI, so the wrong env file aborts. APP_DIR must be set in it, so
 * the key directories resolve exactly as in the app.
 *
 * LIST_FILE: one DID per line; everything after "#" is a comment, blank lines are ignored.
 * KEEP_FILE: real people who must never be purged, one DID or handle per line (same comment rules).
 * Before anything is written, every listed account is looked up; if any of them is on the keep list
 * (by DID or by handle), the whole run stops.
 *
 * BACKUP_DIR belongs outside ~/cc-reports and the outbox, e.g. /home/tim/backups/purge-<date>; it is
 * created with mode 700. Note a delete-by date (30 days) in the setup plan.
 * With APPLY=1, before deleting anything for an account it writes BACKUP_DIR/<did>.json (every
 * document it is about to delete, as canonical EJSON) and BACKUP_DIR/<did>-keys.tar.gz (the key
 * directory). Prints handles, DIDs and counts only, never email addresses.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { BSON } from "mongodb";

const fail = (message: string): never => {
    console.error(`FAIL purge-unverified-accounts: ${message}`);
    process.exit(2);
};

const { ENV_FILE, EXPECT_DB, LIST_FILE, KEEP_FILE, BACKUP_DIR } = process.env;
const apply = process.env.APPLY === "1";
if (!ENV_FILE || !EXPECT_DB || !LIST_FILE || !KEEP_FILE) fail("set ENV_FILE, EXPECT_DB, LIST_FILE and KEEP_FILE");
if (apply && !BACKUP_DIR) fail("APPLY=1 needs BACKUP_DIR (a new directory for the per-account backups)");

if (!fs.existsSync(ENV_FILE!)) fail(`ENV_FILE ${ENV_FILE} does not exist`);
if (!fs.existsSync(LIST_FILE!)) fail(`LIST_FILE ${LIST_FILE} does not exist`);
if (!fs.existsSync(KEEP_FILE!)) fail(`KEEP_FILE ${KEEP_FILE} does not exist`);

// The env file wins over anything bun loaded from the working directory.
for (const line of fs.readFileSync(ENV_FILE!, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[m[1]] = value;
}
(process.env as Record<string, string>).NODE_ENV = "production";
const uri = process.env.MONGODB_URI;
if (!uri) fail("MONGODB_URI is not set in ENV_FILE");
const dbName = new URL(uri!).pathname.replace(/^\//, "") || "circles";
if (dbName !== EXPECT_DB) fail(`ENV_FILE points at database "${dbName}", not EXPECT_DB "${EXPECT_DB}"`);
if (!process.env.APP_DIR) fail("APP_DIR is not set in ENV_FILE; the key directories would not resolve as in the app");

const readEntries = (file: string): string[] => [
    ...new Set(
        fs
            .readFileSync(file, "utf8")
            .split("\n")
            .map((l) => l.replace(/#.*/, "").trim())
            .filter(Boolean),
    ),
];
const dids = readEntries(LIST_FILE!);
if (dids.length === 0) fail("LIST_FILE lists no DIDs");
const keep = new Set(readEntries(KEEP_FILE!));
const onKeepList = dids.filter((d) => keep.has(d));
if (onKeepList.length) fail(`LIST_FILE contains ${onKeepList.length} DID(s) from KEEP_FILE: ${onKeepList.join(", ")}`);
if (apply && fs.existsSync(BACKUP_DIR!)) fail(`BACKUP_DIR ${BACKUP_DIR} already exists; use a new directory`);

const main = async () => {
    const { planPurgeUnverifiedAccount, applyPurgePlan, PURGE_COLLECTIONS } = await import(
        "../src/lib/data/purge-unverified"
    );
    const { USERS_DIR } = await import("../src/lib/auth/auth");

    console.log(`purge-unverified-accounts mode=${apply ? "APPLY" : "dry-run"} db=${dbName} accounts=${dids.length}`);
    console.log(`USERS_DIR=${USERS_DIR}${fs.existsSync(USERS_DIR) ? "" : "  (does not exist!)"}`);
    console.log("");

    // Read-only first pass: no listed account may be on the keep list by handle either.
    const { Circles } = await import("../src/lib/data/db");
    const keptByHandle: string[] = [];
    for (const did of dids) {
        const u = await Circles.findOne({ did }, { projection: { handle: 1 } });
        if (u?.handle && keep.has(u.handle)) keptByHandle.push(`${u.handle} (${did})`);
    }
    if (keptByHandle.length) fail(`LIST_FILE contains account(s) from KEEP_FILE: ${keptByHandle.join(", ")}`);
    console.log(`keep list: ${keep.size} entries, none listed`);
    if (apply) {
        // Outside ~/cc-reports and the outbox (real people's data); 700 regardless of the umask.
        fs.mkdirSync(BACKUP_DIR!, { recursive: true, mode: 0o700 });
        fs.chmodSync(BACKUP_DIR!, 0o700);
    }

    const totals: Record<string, number> = {};
    const skipped: string[] = [];
    let purged = 0;
    const recounts = new Map<string, { before: number | null; after: number }>();

    for (const did of dids) {
        const plan = await planPurgeUnverifiedAccount(did);
        if (!plan.eligible) {
            skipped.push(did);
            console.log(`SKIP ${plan.handle ?? "-"}  did=${did}  ${plan.skipReasons.join("; ")}`);
            continue;
        }
        const counts = PURGE_COLLECTIONS.map((c) => `${c}=${plan.docs[c].length}`).filter((x) => !x.endsWith("=0"));
        console.log(`${apply ? "PURGE" : "WOULD PURGE"} ${plan.handle}  did=${did}`);
        console.log(`    ${counts.join(" ")}  keyDir=${plan.userDirExists ? "yes" : "no"}`);
        console.log(`    recount circles: ${plan.recountCircleIds.join(", ") || "-"}`);
        if (plan.uploads.length) console.log(`    uploads (not deleted, check by hand): ${plan.uploads.join(" ")}`);
        for (const c of PURGE_COLLECTIONS) totals[c] = (totals[c] || 0) + plan.docs[c].length;

        if (!apply) continue;

        const backupFile = path.join(BACKUP_DIR!, `${did}.json`);
        fs.writeFileSync(
            backupFile,
            BSON.EJSON.stringify({ did, handle: plan.handle, docs: plan.docs }, { relaxed: false }),
            {
                mode: 0o600,
            },
        );
        if (plan.userDirExists) {
            execFileSync("tar", ["-czf", path.join(BACKUP_DIR!, `${did}-keys.tar.gz`), "-C", USERS_DIR, did]);
            fs.chmodSync(path.join(BACKUP_DIR!, `${did}-keys.tar.gz`), 0o600);
        }
        const result = await applyPurgePlan(plan);
        purged++;
        const deleted = Object.entries(result.deleted)
            .filter(([, n]) => n > 0)
            .map(([c, n]) => `${c}=${n}`);
        console.log(`    deleted: ${deleted.join(" ")}  keyDirRemoved=${result.userDirRemoved}`);
        for (const r of result.recounted) {
            const prev = recounts.get(r.circleId);
            recounts.set(r.circleId, { before: prev ? prev.before : r.before, after: r.after });
        }
        if (result.vdbErrors.length) console.log(`    vector DB errors: ${result.vdbErrors.join("; ")}`);
    }

    console.log("");
    console.log("== summary ==");
    console.log(
        `listed=${dids.length}  ${apply ? "purged" : "would purge"}=${apply ? purged : dids.length - skipped.length}  skipped=${skipped.length}`,
    );
    console.log(
        `documents ${apply ? "deleted" : "to delete"}: ${
            Object.entries(totals)
                .filter(([, n]) => n > 0)
                .map(([c, n]) => `${c}=${n}`)
                .join(" ") || "-"
        }`,
    );
    for (const [circleId, r] of recounts)
        console.log(`recounted circle ${circleId}: members ${r.before ?? "-"} -> ${r.after}`);
    if (apply) console.log(`backups in ${BACKUP_DIR}`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("purge-unverified-accounts failed:", error);
        process.exit(1);
    });
