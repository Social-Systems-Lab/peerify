import { notFound } from "next/navigation";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getCircleByHandle } from "@/lib/data/circle";
import { listSpacesForOwner } from "@/lib/data/space";
import { SpacesSettings } from "@/components/spaces/spaces-settings";

type PageProps = {
    params: Promise<{ handle: string }>;
};

// Only on your own personal profile: spaces belong to a person, not to a circle, and nobody else
// (platform admins included; they have /admin/spaces) sees another person's list here. Anyone else
// gets a 404, without hinting whether the person has spaces. The list itself is read by the
// signed-in DID, never by the profile in the URL.
export default async function SpacesSettingsPage(props: PageProps) {
    const { handle } = await props.params;
    const circle = await getCircleByHandle(handle);
    let userDid: string | undefined;
    try {
        userDid = await getAuthenticatedUserDid();
    } catch {
        userDid = undefined;
    }

    if (!circle?._id || circle.circleType !== "user" || !userDid || circle.did !== userDid) {
        notFound();
    }

    const spaces = await listSpacesForOwner(userDid);

    return (
        <div className="container py-6">
            <h1 className="mb-2 text-2xl font-bold">Spaces</h1>
            <p className="mb-6 text-muted-foreground">
                Pop-up and home spaces you could host shows in. Spaces you add to the map show as a pin near your place.
                Your name and address are never shown.
            </p>
            <SpacesSettings initialSpaces={spaces} />
        </div>
    );
}
