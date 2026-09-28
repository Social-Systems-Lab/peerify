import { Circle } from "@/models/models";
import { isAuthorized } from "@/lib/auth/auth";
import { toPublicCircle, type PublicCircleOptions } from "@/lib/utils/public-circle";
import { resolveViewerIsAdmin } from "./circle";
import { features } from "./constants";

// The circle a /circles/[handle]/* route hands to its client components, shaped for the viewer
// exactly like the layout and home page do: circle managers (the same edit_about check as the
// layout's authorizedToEdit), platform admins and the circle's owner get it back unchanged;
// everyone else gets toPublicCircle's allow-listed copy. Server-side logic should keep reading
// the full circle — shape only what's serialised (see toPublicCircle for why this is post-fetch).
export const getPublicCircleForViewer = async (
    circle: Circle,
    viewerDid: string | undefined,
    options?: PublicCircleOptions,
): Promise<Circle> => {
    const viewerCanManage = circle._id
        ? await isAuthorized(viewerDid, circle._id.toString(), features.settings.edit_about)
        : false;
    return toPublicCircle(
        circle,
        { viewerDid, viewerIsPlatformAdmin: await resolveViewerIsAdmin(viewerDid), viewerCanManage },
        options,
    );
};
