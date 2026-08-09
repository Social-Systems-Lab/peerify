import Link from "next/link";

export default function NotFound() {
    const title = "Not found";
    const description =
        "We couldn't find this event in this circle. It may have been removed or you may not have access.";

    return (
        <div className="mx-auto max-w-3xl px-4 py-10">
            <div className="rounded-lg border border-[#e8dfd2] bg-[#f7f2ea] p-6 shadow-sm">
                <h1 className="mb-2 text-2xl font-semibold text-[#181512]">{title}</h1>
                <p className="mt-1 text-[#6b5f52]">{description}</p>

                <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                        href="."
                        className="inline-flex items-center justify-center rounded-full bg-[#e8720c] px-5 py-3 text-sm font-semibold text-[#181512] hover:bg-[#ff8c2a]"
                    >
                        Back to events
                    </Link>
                </div>
            </div>
        </div>
    );
}
