/** @type {import('next').NextConfig} */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const version = packageJson.version;
const devSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.PEERIFY_URL || process.env.CIRCLES_URL;
const allowedDevOrigins = [];

if (devSiteUrl) {
    try {
        allowedDevOrigins.push(new URL(devSiteUrl).origin);
    } catch {
        // Ignore invalid local env values; Next will keep its default dev-origin behavior.
    }
}

const nextConfig = {
    output: "standalone",
    // Trace from this app dir, never a parent: otherwise Next picks the outermost lockfile it finds
    // (on the old box a stray /home/tim/package-lock.json), and server.js lands at a path that depends
    // on where the checkout lives. With this, it is always .next/standalone/server.js.
    outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
    allowedDevOrigins,
    // /privacy and /terms read their markdown with fs at request time; make sure standalone ships it.
    outputFileTracingIncludes: {
        "/privacy": ["./src/content/privacy-policy.md"],
        "/terms": ["./src/content/terms.md"],
        "/hosts": ["./src/content/hosts.md"],
    },
    images: {
        remotePatterns: [
            {
                protocol: "http",
                hostname: "**",
            },
            {
                protocol: "https",
                hostname: "**",
            },
        ],
    },
    env: {
        version,
    },
    async redirects() {
        return [
            // /supporter (Kamooni-era ecosystem supporter page) was removed; /donations covers the same
            // option. Permanent so old shared links and search results follow it.
            { source: "/supporter", destination: "/donations", permanent: true },
        ];
    },
    experimental: {
        serverActions: {
            bodySizeLimit: "50mb",
        },
    },
};

export default nextConfig;
