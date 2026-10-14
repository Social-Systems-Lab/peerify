/**
 * One-off (admin): send one fresh verification email to each listed account whose email isn't
 * verified yet, under the same limits as the signed-in "Resend email" button (60 s cooldown, 5 per
 * 24 h), through the same code (sendVerificationEmailToSubject). Once the person clicks it, their
 * email is verified and login links work again.
 *
 * Dry run (default, no writes, no mail):
 *   ENV_FILE=<app env file> EXPECT_DB=<db name> HANDLES=jonny-gonzo,dave-knowles bun scripts/resend-verification-emails.ts
 * Send:
 *   ENV_FILE=... EXPECT_DB=... HANDLES=... APPLY=1 bun scripts/resend-verification-emails.ts
 *
 * Correcting a mistyped address first (one account per run, only when all three match):
 *   REPLACE_EMAIL_HANDLE=karin-quinn  the account (must also be in HANDLES)
 *   REPLACE_EMAIL_FROM_DOMAIN=gmil.com  the domain of the address stored now
 *   REPLACE_EMAIL_TO=<correct address>  as confirmed with the person
 * The new address must not belong to another account. The replacement also clears any outstanding
 * login-link and verification tokens, so nothing sent to the old address can be used any more.
 *
 * ENV_FILE is the env file the running app uses; EXPECT_DB must equal the database in its
 * MONGODB_URI. Prints handles, DIDs and masked addresses only.
 */

import fs from "fs";

const fail = (message: string): never => {
    console.error(`FAIL resend-verification-emails: ${message}`);
    process.exit(2);
};

const { ENV_FILE, EXPECT_DB, HANDLES, REPLACE_EMAIL_HANDLE, REPLACE_EMAIL_FROM_DOMAIN, REPLACE_EMAIL_TO } = process.env;
const apply = process.env.APPLY === "1";
if (!ENV_FILE || !EXPECT_DB || !HANDLES) fail("set ENV_FILE, EXPECT_DB and HANDLES");
if (!fs.existsSync(ENV_FILE!)) fail(`ENV_FILE ${ENV_FILE} does not exist`);

const handles = [
    ...new Set(
        HANDLES!
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean),
    ),
];
if (handles.length === 0) fail("HANDLES lists no handles");

const replacing = Boolean(REPLACE_EMAIL_HANDLE || REPLACE_EMAIL_FROM_DOMAIN || REPLACE_EMAIL_TO);
const newEmail = (REPLACE_EMAIL_TO || "").trim().toLowerCase();
if (replacing) {
    if (!REPLACE_EMAIL_HANDLE || !REPLACE_EMAIL_FROM_DOMAIN || !REPLACE_EMAIL_TO) {
        fail(
            "an email replacement needs REPLACE_EMAIL_HANDLE, REPLACE_EMAIL_FROM_DOMAIN and REPLACE_EMAIL_TO together",
        );
    }
    if (!handles.includes(REPLACE_EMAIL_HANDLE!)) fail("REPLACE_EMAIL_HANDLE must also be in HANDLES");
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(newEmail)) fail("REPLACE_EMAIL_TO is not a valid email address");
    if (newEmail.split("@")[1] === REPLACE_EMAIL_FROM_DOMAIN!.trim().toLowerCase()) {
        fail("REPLACE_EMAIL_TO is on the same domain it is meant to replace");
    }
}

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

const main = async () => {
    const { Circles } = await import("../src/lib/data/db");
    const { sendVerificationEmailToSubject, VERIFICATION_SUBJECT_PROJECTION } = await import(
        "../src/lib/auth/send-verification-email"
    );
    const { evaluateVerificationResend } = await import("../src/lib/auth/verification-email");
    const { maskEmail } = await import("../src/lib/utils/mask-email");

    console.log(
        `resend-verification-emails mode=${apply ? "SEND" : "dry-run"} db=${dbName} accounts=${handles.length}`,
    );
    if (apply && !process.env.POSTMARK_API_TOKEN)
        fail("POSTMARK_API_TOKEN is not set in ENV_FILE; nothing could be sent");

    let sent = 0;
    for (const handle of handles) {
        const user = await Circles.findOne(
            { handle, circleType: "user" },
            { projection: { ...VERIFICATION_SUBJECT_PROJECTION, handle: 1, accountStatus: 1 } },
        );
        if (!user) {
            console.log(`SKIP ${handle}: no user account with this handle`);
            continue;
        }
        const label = `${handle} did=${user.did} status=${user.accountStatus ?? "-"}`;
        if (user.isEmailVerified === true) {
            console.log(`SKIP ${label}: email already verified`);
            continue;
        }
        if (!user.email) {
            console.log(`SKIP ${label}: no email address on record`);
            continue;
        }

        let subject = user;
        if (replacing && handle === REPLACE_EMAIL_HANDLE) {
            const currentDomain = user.email.split("@").pop()!.toLowerCase();
            if (currentDomain !== REPLACE_EMAIL_FROM_DOMAIN!.trim().toLowerCase()) {
                console.log(
                    `SKIP ${label}: stored address is on ${currentDomain}, not ${REPLACE_EMAIL_FROM_DOMAIN}; nothing changed`,
                );
                continue;
            }
            const taken = await Circles.findOne(
                { email: newEmail, _id: { $ne: user._id } },
                { collation: { locale: "en", strength: 2 }, projection: { handle: 1 } },
            );
            if (taken) {
                console.log(
                    `SKIP ${label}: ${maskEmail(newEmail)} already belongs to another account (${taken.handle})`,
                );
                continue;
            }
            console.log(
                `${apply ? "REPLACE" : "WOULD REPLACE"} ${label}: ${maskEmail(user.email)} -> ${maskEmail(newEmail)}`,
            );
            if (apply) {
                const res = await Circles.updateOne(
                    { _id: user._id, email: user.email, isEmailVerified: { $ne: true } },
                    {
                        $set: {
                            email: newEmail,
                            emailVerificationToken: null,
                            emailVerificationTokenExpiry: null,
                            loginLinkToken: null,
                            loginLinkTokenExpiry: null,
                        },
                    },
                );
                if (res.modifiedCount !== 1) {
                    console.log(`    replacement did not apply (account changed meanwhile); not sending`);
                    continue;
                }
                subject = { ...user, email: newEmail };
            } else {
                subject = { ...user, email: newEmail };
            }
        }

        const decision = evaluateVerificationResend(subject, new Date());
        if (!apply) {
            console.log(
                `WOULD SEND ${label} to ${maskEmail(subject.email!)}: ` +
                    (decision.allowed
                        ? "allowed"
                        : `refused (${decision.reason}, retry in ${decision.retryAfterSeconds}s)`),
            );
            continue;
        }
        const result = await sendVerificationEmailToSubject(subject);
        if (result.status === "sent") {
            sent++;
            console.log(`SENT ${label} to ${maskEmail(subject.email!)} (MessageID ${result.messageId})`);
        } else {
            console.log(`NOT SENT ${label}: ${JSON.stringify(result)}`);
        }
    }
    console.log(`done: ${apply ? `sent=${sent}` : "dry run, nothing written or sent"}`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("resend-verification-emails failed:", error instanceof Error ? error.message : error);
        process.exit(1);
    });
