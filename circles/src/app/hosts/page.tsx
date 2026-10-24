// \app\hosts\page.tsx - public host pilot page (no login); text lives in src/content/hosts.md
import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import RichText from "@/components/modules/feeds/RichText";

export const metadata: Metadata = { title: "Host a show" };

// Read at request time from the traced file (outputFileTracingIncludes in next.config.mjs keeps it in
// the standalone build). Markdown rendering is the same RichText the app uses for posts.
export default function HostsPage() {
    const content = fs.readFileSync(path.join(process.cwd(), "src/content/hosts.md"), "utf8");

    return (
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-8 md:pt-12">
            <div className="formatted break-words">
                <RichText content={content} />
            </div>
        </div>
    );
}
