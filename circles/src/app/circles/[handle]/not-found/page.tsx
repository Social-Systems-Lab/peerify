import Link from "next/link";
import { getCircleByHandle } from "@/lib/data/circle";
import { getCircleDefaultPath } from "@/lib/utils/circle-routes";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CircleNotFoundPage({ params, searchParams }: PageProps) {
    const p = await params;
    const sp = (await searchParams) || {};
    const handle = p.handle;

    // Extract context provided by middleware
    const moduleHandle = (sp.module as string) || undefined;
    // Load circle so the layout renders with proper context
    const circle = await getCircleByHandle(handle);
    const fallbackHref = circle ? getCircleDefaultPath(circle) : `/circles/${handle}/home`;
    const fallbackText = circle?.enabledModules?.includes("home") ? "Go to Home" : "Open Circle";

    const title = "Not found";
    const moduleText = moduleHandle ? `“${moduleHandle}”` : "this page";
    const description = moduleHandle
        ? `The ${moduleText} is not available in this circle. It may be disabled or the item may have been removed.`
        : "The page you are looking for doesn’t exist in this circle.";

    return (
        <div className="mx-auto max-w-3xl px-4 py-10">
            <div className="rounded-lg border border-[#e8dfd2] bg-[#f7f2ea] p-6 shadow-sm">
                <h1 className="mb-2 text-2xl font-semibold text-[#181512]">{title}</h1>
                <p className="text-[#6b5f52]">
                    We couldn&apos;t find {moduleText} in <span className="font-medium text-[#181512]">{circle?.name}</span>.
                </p>
                <p className="mt-1 text-[#6b5f52]">{description}</p>
                <div className="mt-6">
                    <Link
                        href={fallbackHref}
                        className="inline-flex items-center justify-center rounded-full bg-[#e8720c] px-5 py-3 text-sm font-semibold text-[#181512] hover:bg-[#ff8c2a]"
                    >
                        {fallbackText}
                    </Link>
                </div>
            </div>
        </div>
    );
}
