import { PresenceSettingsForm } from "@/components/forms/circle-settings/presence-settings-form";
import { getCircleByHandle } from "@/lib/data/circle";

type PageProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function PresenceSettingsPage(props: PageProps) {
    const params = await props.params;
    const { handle } = params;
    const circle = await getCircleByHandle(handle);

    if (!circle) {
        return <div>Circle not found</div>;
    }

    const isUser = circle.circleType === "user";

    return (
        <div className="container py-6">
            <h1 className="mb-6 text-2xl font-bold">{isUser ? "Tour-Team Offerings" : "Offers and needs"}</h1>
            <p className="mb-6 text-muted-foreground">
                {isUser
                    ? "Let touring artists know what you can offer when they come through your city."
                    : "Describe your opportunities and what support your circle or project needs."}
            </p>
            <PresenceSettingsForm circle={circle} />
        </div>
    );
}
