import { getCircleByHandle } from "@/lib/data/circle";
import CrewModule from "@/components/modules/crew/crew";
import { notFound } from "next/navigation";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function CrewPage({ params }: PageProps) {
    const p = await params;
    const circle = await getCircleByHandle(p.handle);

    if (!circle || !circle._id) {
        notFound();
    }

    return <CrewModule circle={circle} />;
}
