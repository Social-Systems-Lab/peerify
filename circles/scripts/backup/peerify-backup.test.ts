// Run: bun test scripts/backup/peerify-backup.test.ts
// Runs the real peerify-backup.sh against a temporary folder, with stand-ins for restic, mongodump,
// mcli and curl on PATH that only record how they were called. Nothing touches MongoDB, silo, the
// network or anything outside the temporary folder. The secrets below are fake.

import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SCRIPT = path.join(__dirname, "peerify-backup.sh");
const FAKE = {
    restic: "FAKE-RESTIC-PASSWORD-for-tests",
    s3Secret: "FAKE-S3-SECRET-for-tests",
    mongo: "FAKE-MONGO-PASSWORD-for-tests",
    postmark: "FAKE-POSTMARK-TOKEN-for-tests",
    ping: "https://hc-ping.example/FAKE-PING-ID",
};

const STUBS: Record<string, string> = {
    restic: `#!/usr/bin/env bash
echo "restic $*" >> "$STUB_DIR/calls.log"
case "$1" in
  cat) if [ -n "$STUB_RESTIC_CAT_FAIL" ]; then exit 1; fi; echo '{}' ;;
  snapshots) if [ -n "$STUB_SNAPSHOTS" ]; then cat "$STUB_SNAPSHOTS"; else echo '[]'; fi ;;
  backup)
    for a in "$@"; do if [ -e "$a" ]; then echo "$a" >> "$STUB_DIR/backup-paths.log"; fi; done
    if [ -n "$STUB_RESTIC_BACKUP_FAIL" ]; then echo "Fatal: stub failure" >&2; exit 1; fi
    echo '{"message_type":"status","percent_done":0.5}'
    echo '{"message_type":"summary","files_new":1,"files_changed":0,"total_files_processed":3,"data_added":1234,"snapshot_id":"abcdef1234567890"}' ;;
  check) if [ -n "$STUB_RESTIC_CHECK_FAIL" ]; then echo "check error" >&2; exit 1; fi ;;
esac
exit 0
`,
    mongodump: `#!/usr/bin/env bash
echo "mongodump $*" >> "$STUB_DIR/calls.log"
if [ -n "$STUB_MONGODUMP_FAIL" ]; then echo "Failed: authentication failed" >&2; exit 1; fi
for a in "$@"; do case "$a" in --archive=*) printf 'ARCHIVE' > "\${a#--archive=}" ;; esac; done
exit 0
`,
    mcli: `#!/usr/bin/env bash
echo "mcli $*" >> "$STUB_DIR/calls.log"
n="\${STUB_BUCKET_COUNT:-3}"
if [[ " $* " == *" ls "* ]]; then
  for i in $(seq 1 "$n"); do echo "{\\"status\\":\\"success\\",\\"type\\":\\"file\\",\\"key\\":\\"private-object-name-$i.jpg\\"}"; done
elif [[ " $* " == *" mirror "* ]]; then
  target="\${@: -1}"
  mkdir -p "$target"; find "$target" -type f -delete
  for i in $(seq 1 "$n"); do echo x > "$target/private-object-name-$i.jpg"; echo "{\\"status\\":\\"success\\",\\"source\\":\\"a/private-object-name-$i.jpg\\"}"; done
elif [[ " $* " == *" --version "* ]]; then
  echo "mcli version stub"
fi
exit 0
`,
    curl: `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_DIR/calls.log"
for a in "$@"; do case "$a" in */api/version) echo '{"gitSha":"0123456789abcdef"}'; exit 0 ;; esac; done
prev=""
for a in "$@"; do if [ "$prev" = "--data-binary" ]; then cp "\${a#@}" "$STUB_DIR/mail.json"; fi; prev="$a"; done
if [ -n "$STUB_CURL_FAIL" ]; then exit 22; fi
exit 0
`,
};

type Setup = { dir: string; conf: string; secrets: string; state: string; logFile: string; lock: string };
const dirs: string[] = [];

function setup(confExtra = ""): Setup {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peerify-backup-test-"));
    dirs.push(dir);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });

    const secrets = path.join(dir, "secrets");
    fs.mkdirSync(path.join(secrets, "mcli"), { recursive: true, mode: 0o700 });
    fs.chmodSync(secrets, 0o700);
    const secret = (name: string, content: string) => fs.writeFileSync(path.join(secrets, name), content, { mode: 0o600 });
    secret("restic.pass", FAKE.restic);
    secret("s3.env", `AWS_ACCESS_KEY_ID=FAKEACCESSKEYID\nAWS_SECRET_ACCESS_KEY=${FAKE.s3Secret}\n`);
    secret("mongo-backup.yaml", `password: ${FAKE.mongo}\n`);
    secret("postmark.header", `X-Postmark-Server-Token: ${FAKE.postmark}\n`);
    secret("ping.url", `${FAKE.ping}\n`);
    secret("mcli/config.json", "{}");

    const data = path.join(dir, "data");
    for (const did of ["did-one", "did-two"]) {
        fs.mkdirSync(path.join(data, "users", did), { recursive: true });
        fs.writeFileSync(path.join(data, "users", did, "publicKey.pem"), "pem");
    }
    fs.mkdirSync(path.join(data, "server"));
    fs.writeFileSync(path.join(dir, "app.env"), "APP_DIR=/srv/peerify/data\n");

    const state = path.join(dir, "state");
    const logFile = path.join(dir, "log", "backup.log");
    const lock = path.join(dir, "run", "lock");
    const conf = path.join(dir, "backup.conf");
    fs.writeFileSync(
        conf,
        `BOX="staging"
APP_PORT="3001"
MONGO_DBS="peerify_staging admin"
MONGO_USER="peerify_backup"
MONGO_AUTH_DB="admin"
BUCKETS="circles-staging peerify-media-staging"
DATA_DIR="${data}"
CONFIG_PATHS_REQUIRED=("${dir}/app.env")
CONFIG_PATHS_OPTIONAL=("${dir}/not-there")
RESTIC_REPOSITORY="s3:https://s3.example/bucket"
ALERT_TO="ops@example.org"
ALERT_FROM="backup@example.org"
SECRETS_DIR="${secrets}"
STATE_DIR="${state}"
LOG_FILE="${logFile}"
LOCK_FILE="${lock}"
RESTIC_CACHE_DIR="${dir}/cache"
DEEP_CHECK_WEEKDAY="${otherWeekday()}"
${confExtra}
`,
        { mode: 0o600 },
    );
    return { dir, conf, secrets, state, logFile, lock };
}

function otherWeekday(): string {
    const today = Number(spawnSync("date", ["+%u"]).stdout.toString().trim());
    return String((today % 7) + 1);
}

function run(s: Setup, args: string[] = [], env: Record<string, string> = {}) {
    const res = spawnSync("bash", [SCRIPT, "--config", s.conf, ...args], {
        env: { PATH: `${path.join(s.dir, "bin")}:${process.env.PATH}`, STUB_DIR: s.dir, ...env },
        encoding: "utf8",
    });
    const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
    const calls = read(path.join(s.dir, "calls.log")).split("\n").filter(Boolean);
    return {
        code: res.status,
        out: `${res.stdout}${res.stderr}`,
        log: read(s.logFile),
        calls,
        backupPaths: read(path.join(s.dir, "backup-paths.log")),
        mail: read(path.join(s.dir, "mail.json")),
    };
}

const resticBackups = (calls: string[]) => calls.filter((c) => c.startsWith("restic backup"));
const pings = (calls: string[]) => calls.filter((c) => c.startsWith("curl") && c.includes(FAKE.ping));
const noSecretsIn = (text: string) => {
    for (const v of [FAKE.restic, FAKE.s3Secret, FAKE.mongo, FAKE.postmark]) expect(text).not.toContain(v);
};

afterAll(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("config and secrets", () => {
    test("--check-config passes with a complete setup and prints no secret", () => {
        const s = setup();
        const r = run(s, ["--check-config"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("config ok");
        noSecretsIn(r.out);
    });

    test("refuses a secret file other users can read", () => {
        const s = setup();
        fs.chmodSync(path.join(s.secrets, "s3.env"), 0o644);
        const r = run(s, ["--check-config"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("s3.env has mode 644");
        noSecretsIn(r.out);
    });

    test("refuses a config file other users can write", () => {
        const s = setup();
        fs.chmodSync(s.conf, 0o666);
        const r = run(s, ["--check-config"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("has mode 666");
    });

    test("refuses KEEP_DAYS over 30", () => {
        const s = setup('KEEP_DAYS="31"');
        const r = run(s, ["--check-config"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("KEEP_DAYS must be a whole number from 1 to 30");
    });

    test("refuses alert addresses still set to CHANGE-ME, pointing to INSTALL step 5b", () => {
        const s = setup('ALERT_TO="CHANGE-ME"\nALERT_FROM="CHANGE-ME"');
        for (const args of [["--check-config"], [], ["--notify-failure"]]) {
            const r = run(s, args);
            expect(r.code).toBe(2);
            expect(r.out).toContain("ALERT_TO ALERT_FROM still CHANGE-ME");
            expect(r.out).toContain("INSTALL.md step 5b");
        }
        expect(run(s).calls).toEqual([]);
    });

    test("the shipped configs are refused until step 5b has been done", () => {
        for (const box of ["prod", "staging"]) {
            const s = setup();
            fs.copyFileSync(path.join(__dirname, `backup.conf.${box}`), s.conf);
            fs.chmodSync(s.conf, 0o600);
            const r = run(s, ["--check-config"]);
            expect(r.code).toBe(2);
            expect(r.out).toContain("ALERT_TO ALERT_FROM still CHANGE-ME");
        }
    });

    test("a CHANGE-ME in a comment is fine", () => {
        const s = setup("# ALERT_TO was CHANGE-ME before step 5b");
        expect(run(s, ["--check-config"]).code).toBe(0);
    });

    test("refuses extra lines in s3.env", () => {
        const s = setup();
        fs.appendFileSync(path.join(s.secrets, "s3.env"), "SOMETHING_ELSE=1\n");
        const r = run(s, ["--check-config"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("may only hold");
    });
});

describe("dry run", () => {
    test("writes, sends and deletes nothing", () => {
        const s = setup();
        const r = run(s, ["--dry-run"]);
        expect(r.code).toBe(0);
        expect(r.calls.some((c) => c.startsWith("mongodump"))).toBe(false);
        expect(r.calls.some((c) => c.includes(" mirror "))).toBe(false);
        expect(r.calls.some((c) => /^restic (forget|prune|check|unlock)/.test(c))).toBe(false);
        expect(pings(r.calls)).toEqual([]);
        expect(r.calls.some((c) => c.includes("postmark"))).toBe(false);
        const backups = resticBackups(r.calls);
        expect(backups.length).toBeGreaterThan(0);
        for (const b of backups) expect(b).toContain("--dry-run");
        expect(r.log).toContain("would dump database 'peerify_staging'");
    });
});

describe("nightly run", () => {
    test("a snapshot per database and per part, retention, check, then the success ping", () => {
        const s = setup();
        const r = run(s);
        expect(r.code).toBe(0);

        const backups = resticBackups(r.calls);
        const tags = backups.map((b) => b.match(/--tag (mongo|data|buckets|config) /)?.[1]);
        expect(tags).toEqual(["mongo", "mongo", "data", "buckets", "config"]);
        for (const b of backups) {
            expect(b).toContain("--host peerify-staging");
            expect(b).toContain("--tag box-staging");
        }

        // Each dump existed while restic backed it up, and is gone afterwards.
        for (const db of ["peerify_staging", "admin"]) {
            const archive = path.join(s.state, "mongo", `${db}.archive`);
            expect(r.backupPaths).toContain(archive);
            expect(fs.existsSync(archive)).toBe(false);
        }
        // The bucket mirror holds the objects for the buckets snapshot.
        expect(fs.readdirSync(path.join(s.state, "buckets", "circles-staging")).length).toBe(3);

        expect(r.calls.some((c) => c === "restic prune --quiet --max-unused 0")).toBe(true);
        expect(r.calls.some((c) => c === "restic check --quiet")).toBe(true);
        expect(pings(r.calls).map((c) => c.split(FAKE.ping)[1] ?? "")).toEqual(["/start", ""]);
        expect(r.log).toContain("=== ok after");
    });

    test("--tag adds the tag to every snapshot", () => {
        const s = setup();
        const r = run(s, ["--tag", "pre-release"]);
        expect(r.code).toBe(0);
        for (const b of resticBackups(r.calls)) expect(b).toContain("--tag pre-release");
    });

    test("the mongo password never goes on a command line", () => {
        const s = setup();
        const r = run(s);
        const dumps = r.calls.filter((c) => c.startsWith("mongodump") && c.includes(" --db "));
        expect(dumps.length).toBe(2);
        for (const dump of dumps) {
            expect(dump).toContain("--config");
            expect(dump).toContain("--username peerify_backup");
            expect(dump).toContain("--authenticationDatabase admin");
        }
        expect(dumps[0]).toContain("--db peerify_staging");
        expect(dumps[1]).toContain("--db admin");
        noSecretsIn(r.calls.join("\n"));
    });

    test("logs hold no secrets and no object names", () => {
        const s = setup();
        const r = run(s);
        noSecretsIn(r.out + r.log);
        expect(r.out + r.log).not.toContain("private-object-name");
        expect(r.out + r.log).not.toContain("FAKE-PING-ID");
    });

    test("deep check on DEEP_CHECK_WEEKDAY", () => {
        const today = spawnSync("date", ["+%u"]).stdout.toString().trim();
        const s = setup(`DEEP_CHECK_WEEKDAY="${today}"`);
        const r = run(s);
        expect(r.calls.some((c) => c === "restic check --quiet --read-data-subset=10%")).toBe(true);
    });
});

describe("retention", () => {
    test("forgets exactly the snapshots older than KEEP_DAYS by calendar date", () => {
        const s = setup();
        const day = 86400_000;
        const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();
        const snapshots = path.join(s.dir, "snapshots.json");
        fs.writeFileSync(
            snapshots,
            JSON.stringify([
                { id: "aaaa0001", time: at(1) },
                { id: "aaaa0028", time: at(28) },
                { id: "aaaa0030", time: at(30) },
                { id: "aaaa0045", time: at(45) },
            ]),
        );
        const r = run(s, [], { STUB_SNAPSHOTS: snapshots });
        expect(r.code).toBe(0);
        expect(r.calls.filter((c) => c.startsWith("restic forget"))).toEqual([
            "restic forget --quiet aaaa0030 aaaa0045",
        ]);
        expect(r.log).toContain("4 snapshots, 2 older than 29 days");
    });

    test("restic's own offset format with nanoseconds is understood", () => {
        const s = setup();
        const snapshots = path.join(s.dir, "snapshots.json");
        fs.writeFileSync(snapshots, JSON.stringify([{ id: "bbbb0001", time: "2020-01-01T03:30:01.123456789+01:00" }]));
        const r = run(s, [], { STUB_SNAPSHOTS: snapshots });
        expect(r.calls).toContain("restic forget --quiet bbbb0001");
    });
});

describe("failures", () => {
    test("a failed mongodump: the other parts and retention still run, exit 1, /fail ping", () => {
        const s = setup();
        const r = run(s, [], { STUB_MONGODUMP_FAIL: "1" });
        expect(r.code).toBe(1);
        const tags = resticBackups(r.calls).map((b) => b.match(/--tag (mongo|data|buckets|config) /)?.[1]);
        expect(tags).toEqual(["data", "buckets", "config"]);
        expect(r.calls.some((c) => c.startsWith("restic prune"))).toBe(true);
        expect(pings(r.calls).at(-1)).toContain(`${FAKE.ping}/fail`);
        expect(r.log).toContain("FAILED after");
        expect(r.log).toContain("mongo");
        expect(r.log).toContain("mongodump: Failed: authentication failed");
    });

    test("an unreachable repository stops before any part, with a /fail ping", () => {
        const s = setup();
        const r = run(s, [], { STUB_RESTIC_CAT_FAIL: "1" });
        expect(r.code).toBe(1);
        expect(resticBackups(r.calls)).toEqual([]);
        expect(r.calls.some((c) => c.startsWith("mongodump"))).toBe(false);
        expect(pings(r.calls).at(-1)).toContain("/fail");
    });

    test("a failed check fails the run", () => {
        const s = setup();
        const r = run(s, [], { STUB_RESTIC_CHECK_FAIL: "1" });
        expect(r.code).toBe(1);
        expect(r.log).toContain("check: FAILED");
    });

    test("a bucket that suddenly looks less than half its size is not mirrored", () => {
        const s = setup();
        const mirror = path.join(s.state, "buckets", "circles-staging");
        fs.mkdirSync(mirror, { recursive: true });
        for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(mirror, `f${i}`), "x");
        const r = run(s);
        expect(r.code).toBe(1);
        expect(r.calls.some((c) => c.includes("mirror") && c.includes("backupro/circles-staging "))).toBe(false);
        expect(fs.readdirSync(mirror).length).toBe(30);
        expect(r.log).toContain("refusing to mirror");
    });

    test("a second run while one is running refuses", async () => {
        const s = setup();
        fs.mkdirSync(path.dirname(s.lock), { recursive: true });
        const holder = spawn("flock", [s.lock, "sleep", "5"]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const r = run(s);
        holder.kill();
        expect(r.code).toBe(2);
        expect(r.out).toContain("another peerify-backup run is in progress");
    });
});

describe("alerts", () => {
    test("--notify-failure emails the log tail through Postmark; the token stays off the command line", () => {
        const s = setup();
        run(s, [], { STUB_MONGODUMP_FAIL: "1" });
        fs.rmSync(path.join(s.dir, "calls.log"));
        const r = run(s, ["--notify-failure"]);
        expect(r.code).toBe(0);
        const mail = JSON.parse(r.mail);
        expect(mail.To).toBe("ops@example.org");
        expect(mail.From).toBe("backup@example.org");
        expect(mail.Subject).toContain("FAILED on staging");
        expect(mail.TextBody).toContain("mongodump of 'peerify_staging' failed");
        expect(mail.MessageStream).toBe("outbound");
        const post = r.calls.find((c) => c.includes("api.postmarkapp.com"))!;
        expect(post).toContain(`-H @${s.secrets}/postmark.header`);
        noSecretsIn(r.calls.join("\n") + r.mail);
    });

    test("--notify-failure exits non-zero when Postmark refuses", () => {
        const s = setup();
        const r = run(s, ["--notify-failure"], { STUB_CURL_FAIL: "1" });
        expect(r.code).not.toBe(0);
        expect(r.log).toContain("could not send the alert email");
    });

    test("--test-alert sends a test email and a /fail ping", () => {
        const s = setup();
        const r = run(s, ["--test-alert"]);
        expect(r.code).toBe(0);
        expect(JSON.parse(r.mail).Subject).toContain("test alert from staging");
        expect(pings(r.calls).at(-1)).toContain("/fail");
    });
});
