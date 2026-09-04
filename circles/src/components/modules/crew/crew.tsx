"use server";

import { getCrewMembers, getMember } from "@/lib/data/member";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import CrewMemberRail from "./crew-member-rail";
import CrewSpaceModule from "./crew-space";
import CrewOffersWidget from "./crew-offers-widget";
import CrewLanding from "./crew-landing";
import ContentDisplayWrapper from "@/components/utils/content-display-wrapper";
import { Circle } from "@/models/models";

type CrewModuleProps = {
    circle: Circle;
};

export default async function CrewModule({ circle }: CrewModuleProps) {
    // The entire page — member rail, feed, Offers — is Crew-only. A viewer who isn't this
    // circle's own admin/moderator or one of its approved Crew members (including a logged-out
    // visitor, or a non-crew follower) gets only the welcome/Join-Crew landing state below, not
    // a suppressed/partial version of the real content. Matches the same "nothing to reveal for
    // an ineligible viewer" treatment the Crew feed itself already had — the member list just
    // hadn't been gated the same way until now.
    const viewerDid = await getAuthenticatedUserDid();
    const viewerMember = viewerDid ? await getMember(viewerDid, circle?._id) : null;
    const isEligible =
        viewerMember?.userGroups?.some((group) => group === "admins" || group === "moderators" || group === "crew") ??
        false;

    // Same content max-width AboutPage.tsx wraps this same grid-cols-1/md:grid-cols-3 shell in
    // (src/components/modules/home/AboutPage.tsx:712) — reused rather than inventing a new
    // value, so the feed+sidebar area doesn't stretch edge-to-edge with dead space between the
    // columns on wide viewports.
    if (!isEligible) {
        return (
            <div className="mx-auto max-w-[1100px] px-0 py-0 md:px-4 md:py-6">
                <CrewLanding circle={circle} />
            </div>
        );
    }

    const members = await getCrewMembers(circle?._id, viewerDid);

    return (
        <div className="mx-auto max-w-[1100px] px-0 py-0 md:px-4 md:py-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="md:col-span-2">
                    <CrewSpaceModule circle={circle} />
                </div>
                {/* self-start + sticky is the standard CSS-grid sticky-sidebar recipe: the grid
                    row still stretches this column's *area* to the feed's full height (that's
                    what gives the sticky element room to travel/stay pinned as the page
                    scrolls), while self-start keeps this element's own box compact instead of
                    visually stretched. No existing sticky-sidebar prior art found elsewhere in
                    the codebase to reuse — checked for a fixed/sticky page header to offset
                    below; this app's global nav is a left rail, not a top bar, so there's none.
                    top-4 is just visual breathing room, not a header-height offset. */}
                <div className="flex flex-col gap-4 md:sticky md:top-4 md:col-span-1 md:self-start">
                    <div className="rounded-[18px] border border-black/5 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
                        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Crew</h2>
                        <ContentDisplayWrapper content={members}>
                            <CrewMemberRail circle={circle} members={members} />
                        </ContentDisplayWrapper>
                    </div>
                    <CrewOffersWidget circle={circle} />
                </div>
            </div>
        </div>
    );
}
