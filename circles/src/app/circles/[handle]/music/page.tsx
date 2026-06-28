import { redirect } from "next/navigation";
import { getCircleByHandle } from "@/lib/data/circle";
import MusicModule from "@/components/modules/music/Music";

type MusicPageProps = {
    params: Promise<{ handle: string }>;
};

export default async function MusicPage(props: MusicPageProps) {
    if (process.env.IS_BUILD === "true") {
        return null;
    }

    const { handle } = await props.params;
    const circle = await getCircleByHandle(handle);
    if (!circle) {
        redirect("/not-found");
    }

    return <MusicModule circle={circle} />;
}
