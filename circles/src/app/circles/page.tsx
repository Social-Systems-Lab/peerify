// circles/page.tsx - circles list
import CirclesList from "@/components/modules/circles/circles-list";
import CirclesTabs from "@/components/modules/circles/circles-tab";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getCirclesByIds, getCirclesWithMetrics, getMetricsForCircles } from "@/lib/data/circle";
import { getUserPrivate } from "@/lib/data/user";
import { isPeerifyManagedIdentity } from "@/lib/peerify/artist-profile";
import { Circle, SortingOptions, UserPrivate, WithMetric } from "@/models/models";

type CirclesProps = {
    params: Promise<{ handle: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// CirclesList reads the viewer's own circle only for the create-subcircle permission check
// (client isAuthorized: _id, did, accessRules, enabledModules, crewEnabled) and the own-profile
// test (circleType, did). Never the getUserPrivate result itself: its memberships carry every
// joined circle's location, metadata and access rules (Tim, 2026-10-20).
const toListOwnerCircle = (user: UserPrivate | null): Circle =>
    user
        ? ({
              _id: user._id,
              did: user.did,
              handle: user.handle,
              name: user.name,
              circleType: user.circleType,
              accessRules: user.accessRules,
              enabledModules: user.enabledModules,
              crewEnabled: user.crewEnabled,
          } as Circle)
        : ({} as Circle);

export default async function Home(props: CirclesProps) {
    const searchParams = await props.searchParams;
    let activeTab = searchParams?.tab as string;
    let circleType = searchParams?.circleType as "circle" | "project" | undefined;

    // get user handle
    let userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        activeTab = "discover";
    }

    let circles: WithMetric<Circle>[] = [];
    let user = userDid ? await getUserPrivate(userDid) : null;

    // Default to circle type if not specified
    const filterType = circleType || "circle";

    if (userDid) {
        if (activeTab === "following" || !activeTab) {
            const memberIds =
                user?.memberships
                    ?.filter(
                        (m) =>
                            m.circle.circleType === filterType &&
                            m.circle.handle !== "default" &&
                            !isPeerifyManagedIdentity(m.circle),
                    )
                    ?.map((membership) => membership.circle?._id) || [];
            let memberCircles = await getCirclesByIds(memberIds, { viewerDid: userDid });
            circles = await getMetricsForCircles(memberCircles, userDid, searchParams?.sort as SortingOptions);
        } else {
            circles = await getCirclesWithMetrics(userDid, undefined, searchParams?.sort as SortingOptions, filterType);

            // remove circles that are in the users memberships
            const memberIds = user?.memberships?.map((m) => m.circle._id) || [];
            circles = circles.filter((c) => !memberIds.includes(c._id));
        }
    } else {
        circles = await getCirclesWithMetrics(undefined, undefined, searchParams?.sort as SortingOptions, filterType);
    }

    return (
        <div className="mt-14 flex flex-1 flex-col justify-center overflow-hidden">
            <div className="flex flex-1 flex-row justify-center overflow-hidden">
                <div className="ml-4 mr-4 flex max-w-[1100px] flex-1 flex-col">
                    {userDid && <CirclesTabs currentTab={activeTab} circleType={circleType} />}
                </div>
            </div>
            <CirclesList
                circle={toListOwnerCircle(user)}
                circles={circles}
                activeTab={activeTab}
                isProjectsList={circleType === "project"}
            />
            {/* </div> */}
        </div>
    );
}
