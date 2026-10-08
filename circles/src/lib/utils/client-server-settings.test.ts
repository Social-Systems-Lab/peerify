import assert from "node:assert/strict";
import { toClientServerSettings } from "./client-server-settings";

// Run: bun src/lib/utils/client-server-settings.test.ts — pure, no database.

const JWT = "jwt-secret-value-that-must-never-leave-the-server";
const OPENAI = "sk-openai-value-that-must-never-leave-the-server";
const MATRIX = "matrix-admin-token-that-must-never-leave-the-server";

// A settings document as it could look in the database, secrets included.
const stored = {
    _id: "665f00000000000000000000",
    name: "Peerify",
    description: "desc",
    url: "https://example.org",
    registryUrl: "https://registry.example.org",
    did: "did:key:z6Mk",
    defaultCircleId: "665f00000000000000000001",
    mapboxKey: "pk.public-token",
    serverVersion: "1.2.3",
    activeRegistryInfo: { registryUrl: "https://registry.example.org", registeredAt: new Date(0) },
    jwtSecret: JWT,
    openaiKey: OPENAI,
    matrixAdminAccessToken: MATRIX,
    questionnaire: "q",
    serverInfo: { registryUrl: "x", registeredAt: new Date(0) },
};
const env = { CIRCLES_JWT_SECRET: JWT, OPENAI_API_KEY: OPENAI };

const result = toClientServerSettings(stored as never, env);
const serialized = JSON.stringify(result);

for (const secret of [JWT, OPENAI, MATRIX]) {
    assert.equal(serialized.includes(secret), false, "a secret value reached the client settings");
}
for (const key of ["jwtSecret", "openaiKey", "matrixAdminAccessToken", "_id", "questionnaire", "serverInfo"]) {
    assert.equal(key in result, false, `${key} must not be in the client settings`);
}
assert.deepEqual(result.secrets, { jwtSecret: "set", openaiKey: "set" });
assert.equal(result.name, "Peerify");
assert.equal(result.mapboxKey, "pk.public-token");
assert.equal(result.did, "did:key:z6Mk");
assert.deepEqual(result.activeRegistryInfo, { registryUrl: "https://registry.example.org", registeredAt: new Date(0) });

// Status follows the environment the app actually reads, not the stored copy.
assert.deepEqual(toClientServerSettings(stored as never, {}).secrets, { jwtSecret: "not set", openaiKey: "not set" });
assert.deepEqual(toClientServerSettings({}, { JWT_SECRET: JWT }).secrets, { jwtSecret: "set", openaiKey: "not set" });

// Missing settings document.
assert.deepEqual(toClientServerSettings(null, {}), { secrets: { jwtSecret: "not set", openaiKey: "not set" } });

console.log("client-server-settings: all tests passed");
