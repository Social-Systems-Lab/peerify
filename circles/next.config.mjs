/** @type {import('next').NextConfig} */

import fs from "fs";
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
    allowedDevOrigins,
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
