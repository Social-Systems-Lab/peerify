// restore-counts.mongosh.js: document counts per collection, live database vs. a restored copy
// in a TEMPORARY mongod, printed side by side. For the on-box restore check (RESTORE-RUNBOOK.md section 6).
//
// READ-ONLY: only listDatabases, listCollections, countDocuments and getCmdLineOpts (the last
// one on the temporary mongod only, to prove it is the temporary one). No writes anywhere.
// PRINTS NUMBERS ONLY: collection names and counts. No documents, names, emails, DIDs or ids.
//
// Run as root, so it can read the backup's own Mongo password (the read-only `backup` role):
//
//   sudo env EXPECT_DB=circles mongosh --nodb --norc --quiet --file restore-counts.mongosh.js
//
// Guards (it refuses to run otherwise):
//   - EXPECT_DB must be set, and that database must exist on both servers.
//   - The temporary mongod must be a different port from the live one, and its data folder must
//     be under RESTORED_DBPATH_PREFIX (default /var/tmp/peerify-restore-test/).
//   - The live login is the backup's read-only user `peerify_backup`, never an admin.
//
// Settings (environment; the defaults are prod's and staging's real values):
//   EXPECT_DB               the app database: circles (prod) or peerify_staging (staging)
//   LIVE_PORT               27017
//   RESTORED_PORT           27099
//   RESTORED_DBPATH_PREFIX  /var/tmp/peerify-restore-test/
//   MONGO_USER              peerify_backup
//   PASSWORD_FILE           /etc/peerify-backup/mongo-backup.yaml (the line "password: ...")

const env = typeof process !== "undefined" ? process.env : {};
const refuse = (why) => {
    print(`Refusing to run: ${why}`);
    quit(1);
};

const EXPECT_DB = env.EXPECT_DB;
if (!EXPECT_DB) refuse("set EXPECT_DB to the database name (circles on prod, peerify_staging on staging).");
if (!/^[A-Za-z0-9_]+$/.test(EXPECT_DB)) refuse("EXPECT_DB may only hold letters, digits and _.");

const LIVE_PORT = Number(env.LIVE_PORT || 27017);
const RESTORED_PORT = Number(env.RESTORED_PORT || 27099);
const PREFIX = env.RESTORED_DBPATH_PREFIX || "/var/tmp/peerify-restore-test/";
const MONGO_USER = env.MONGO_USER || "peerify_backup";
const PASSWORD_FILE = env.PASSWORD_FILE || "/etc/peerify-backup/mongo-backup.yaml";

if (!Number.isInteger(LIVE_PORT) || !Number.isInteger(RESTORED_PORT)) refuse("LIVE_PORT and RESTORED_PORT must be numbers.");
if (LIVE_PORT === RESTORED_PORT) refuse(`the temporary mongod can't be on the live port ${LIVE_PORT}.`);
if (!PREFIX.startsWith("/var/tmp/")) refuse("RESTORED_DBPATH_PREFIX must be under /var/tmp/.");

// --- The temporary mongod: no login; prove it's the temporary one before anything else. ------
let restoredClient;
try {
    restoredClient = new Mongo(`mongodb://127.0.0.1:${RESTORED_PORT}/?directConnection=true&serverSelectionTimeoutMS=5000`);
} catch (e) {
    refuse(`no mongod answers on port ${RESTORED_PORT}. Start the temporary one first (runbook 6.3).`);
}
let restoredDbPath = "";
try {
    const opts = restoredClient.getDB("admin").runCommand({ getCmdLineOpts: 1 });
    restoredDbPath = (opts.parsed && opts.parsed.storage && opts.parsed.storage.dbPath) || "";
} catch (e) {
    refuse(`no temporary mongod without a login answers on port ${RESTORED_PORT}. Start it first (runbook 6.3).`);
}
if (!restoredDbPath.startsWith(PREFIX)) {
    refuse(`the mongod on port ${RESTORED_PORT} doesn't keep its data under ${PREFIX}, so it isn't the temporary one.`);
}

// --- The live mongod: the backup's read-only user; the password is read here, never shown. ----
let password = "";
try {
    const text = require("fs").readFileSync(PASSWORD_FILE, "utf8");
    const m = text.match(/^password: (\S+)\s*$/m);
    password = m ? m[1] : "";
} catch (e) {
    refuse(`can't read ${PASSWORD_FILE} (run it with sudo).`);
}
if (!password) refuse(`${PASSWORD_FILE} has no "password: " line.`);

let liveClient;
try {
    liveClient = new Mongo(`mongodb://127.0.0.1:${LIVE_PORT}/?directConnection=true&serverSelectionTimeoutMS=5000`);
    liveClient.getDB("admin").auth(MONGO_USER, password);
} catch (e) {
    refuse(`can't log in to the live mongod on port ${LIVE_PORT} as ${MONGO_USER}.`);
}
password = "";

const dbNames = (client) =>
    client
        .getDB("admin")
        .adminCommand({ listDatabases: 1, nameOnly: true })
        .databases.map((d) => d.name);
if (!dbNames(liveClient).includes(EXPECT_DB)) refuse(`the live mongod has no database "${EXPECT_DB}".`);
if (!dbNames(restoredClient).includes(EXPECT_DB)) refuse(`the temporary mongod has no database "${EXPECT_DB}" (was the archive restored?).`);

const live = liveClient.getDB(EXPECT_DB);
const restored = restoredClient.getDB(EXPECT_DB);

const collections = (d) =>
    d
        .getCollectionInfos({ type: "collection" }, { nameOnly: true })
        .map((c) => c.name)
        .filter((n) => !n.startsWith("system."));
const liveNames = new Set(collections(live));
const restoredNames = new Set(collections(restored));
const all = [...new Set([...liveNames, ...restoredNames])].sort();

const count = (d, names, name) => (names.has(name) ? d.getCollection(name).countDocuments({}) : null);
const fmt = (n) => (n === null ? "-" : String(n));
const w = Math.max(24, ...all.map((n) => n.length)) + 2;
const row = (a, b, c, e, f) => print(a.padEnd(w) + b.padStart(10) + c.padStart(12) + e.padStart(10) + "  " + f);

print(`Database ${EXPECT_DB}: live (port ${LIVE_PORT}) vs. restored (port ${RESTORED_PORT}), ${new Date().toISOString().slice(0, 16)}Z`);
print("Numbers only. diff = live - restored. '-' = no such collection.\n");
row("collection", "live", "restored", "diff", "");
row("-".repeat(w - 2), "-".repeat(8), "-".repeat(10), "-".repeat(8), "");

let totalLive = 0;
let totalRestored = 0;
let same = 0;
let differ = 0;
let onlyLive = 0;
let onlyRestored = 0;
for (const name of all) {
    const l = count(live, liveNames, name);
    const r = count(restored, restoredNames, name);
    totalLive += l || 0;
    totalRestored += r || 0;
    let note = "";
    if (l === null) {
        onlyRestored++;
        note = "only in the backup";
    } else if (r === null) {
        onlyLive++;
        note = "only live (new since the backup?)";
    } else if (l === r) {
        same++;
    } else {
        differ++;
        note = l > r ? "more live" : "MORE IN THE BACKUP";
    }
    const d = l !== null && r !== null ? l - r : null;
    row(name, fmt(l), fmt(r), d === null ? "-" : (d > 0 ? "+" : "") + d, note);
}
row("-".repeat(w - 2), "-".repeat(8), "-".repeat(10), "-".repeat(8), "");
row("TOTAL", String(totalLive), String(totalRestored), (totalLive - totalRestored > 0 ? "+" : "") + (totalLive - totalRestored), "");
print("");
print(`collections: live ${liveNames.size}, restored ${restoredNames.size}`);
print(`same count ${same}, different ${differ}, only live ${onlyLive}, only in the backup ${onlyRestored}`);
