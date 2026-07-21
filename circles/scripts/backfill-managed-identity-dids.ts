/**
 * Backfill: did for managed identity circles (idempotent)
 *
 * Managed identity circles (Peerify artist/venue personas, metadata.peerify.managedIdentity
 * === true) were created without a did — only "user" circles got one. resolveActingAuthor
 * (src/lib/data/acting-identity.ts) requires actingCircle.did before it will attribute a
 * post/comment/reaction to a managed identity, so every managed identity has silently fallen
 * back to the underlying account's own did until now. See src/components/circle-wizard/actions.ts
 * for the (now fixed) creation-time did assignment this backfill catches existing rows up to.
 *
 * did format matches generateLocalDidAndPublicKey() in src/lib/auth/vibe-id.ts:
 * sha256 of a freshly generated RSA-2048 public key (PEM). Only the did is persisted — managed
 * identities don't authenticate independently, so (unlike "user" circles) no private key or
 * USERS_DIR keypair directory is needed.
 *
 * Dry-run (default): bun scripts/backfill-managed-identity-dids.ts
 * Apply:             bun scripts/backfill-managed-identity-dids.ts --apply
 */

import crypto from "crypto";
import { MongoClient, ObjectId } from "mongodb";

const MONGODB_URI =
    process.env.MONGODB_URI ||
    `mongodb://${process.env.MONGO_ROOT_USERNAME || "admin"}:${process.env.MONGO_ROOT_PASSWORD || "password"}@${process.env.MONGO_HOST || "127.0.0.1"}:${process.env.MONGO_PORT || "27017"}`;
const dbName = new URL(MONGODB_URI).pathname.replace(/^\//, "") || "circles";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const mode = apply ? "apply" : "dry-run";

function generateDid(): string {
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;
    return crypto.createHash("sha256").update(publicKeyPem).digest("hex");
}

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(dbName);
    const circles = db.collection("circles");

    const targets = await circles
        .find(
            { "metadata.peerify.managedIdentity": true, did: { $in: [null, undefined] } },
            { projection: { _id: 1, name: 1, handle: 1 } },
        )
        .toArray();

    console.log(`Managed identities missing a did (${mode}): ${targets.length}\n`);

    const plans: Array<{ _id: ObjectId; label: string; did: string }> = [];
    const existingDids = new Set((await circles.distinct("did")).filter(Boolean));

    for (const circle of targets) {
        let did = generateDid();
        while (existingDids.has(did)) {
            did = generateDid();
        }
        existingDids.add(did);
        plans.push({ _id: circle._id, label: circle.handle || circle.name || circle._id.toString(), did });
    }

    for (const p of plans) {
        console.log(`  ${p.label} (${p._id}): did -> ${p.did}`);
    }
    console.log();

    if (apply) {
        for (const p of plans) {
            await circles.updateOne({ _id: p._id }, { $set: { did: p.did } });
        }
    }

    console.log(`Summary (${mode}):`);
    console.log(`  circles updated: ${apply ? plans.length : 0} (of ${plans.length} planned)`);

    await client.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
