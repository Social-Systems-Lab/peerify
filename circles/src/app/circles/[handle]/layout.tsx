import type { Metadata } from "next";
import {
    getCircleByHandle,
    getDefaultCircle,
    getCircleById,
    isCirclePublished,
    hasAutoProvisionedArtistCircle,
    isPilotArtistCircleReadyToPublish,
} from "@/lib/data/circle";
import { redirect } from "next/navigation";
import HomeCover from "@/components/modules/home/home-cover";
import HomeContent from "@/components/modules/home/home-content";
import { getAuthenticatedUserDid, isAuthorized } from "@/lib/auth/auth";
import { features } from "@/lib/data/constants";
import { CircleTabs } from "@/components/layout/circle-tabs";
import { getHumanityVerificationSummary } from "@/lib/data/proof-of-humanity";
import { appConfig } from "@/config/app";
import { getPeerifyMetadata } from "@/lib/peerify/artist-profile";

type Props = { params: Promise<{ handle: string }>; children: React.ReactNode };

export default async function RootLayout(props: Props) {
    const params = await props.params;

    const { children } = props;

    if (process.env.IS_BUILD === "true") {
        return null;
    }

    let circle = await getCircleByHandle(params.handle);
    if (!circle) {
        // redirect to not-found
        redirect("/not-found");
    }

    let authorizedToEdit = false;
    let userDid = await getAuthenticatedUserDid();
    authorizedToEdit = await isAuthorized(userDid, circle._id ?? "", features.settings.edit_about);
    const canViewCircle = isCirclePublished(circle) || authorizedToEdit || circle.createdBy === userDid;
    if (!canViewCircle) {
        redirect("/not-found");
    }
    const parentCircle = circle.parentCircleId ? await getCircleById(circle.parentCircleId) : undefined;
    const proofOfHumanitySummary =
        circle.circleType === "user" && circle.did
            ? await getHumanityVerificationSummary(circle.did, userDid)
            : null;
    const plainCircle = JSON.parse(JSON.stringify(circle));
    const plainParentCircle = parentCircle ? JSON.parse(JSON.stringify(parentCircle)) : undefined;
    const plainProofOfHumanitySummary = proofOfHumanitySummary ? JSON.parse(JSON.stringify(proofOfHumanitySummary)) : null;

    // Artist-path pilot signups now land directly on their new artist circle's home page
    // (see verifyEmailAction in src/app/(auth)/verify-email/actions.ts), so the welcome
    // dialog's own-profile branching needs to recognize that circle too, not just the
    // viewer's personal ("user"-type) circle.
    const isOwnAutoProvisionedArtistCircle =
        circle.circleType !== "user" &&
        Boolean(userDid) &&
        circle.createdBy === userDid &&
        getPeerifyMetadata(circle).autoProvisionedFromSignup === true;
    const viewerHasAutoProvisionedArtistCircle =
        circle.circleType === "user" && userDid && circle.did === userDid
            ? await hasAutoProvisionedArtistCircle(userDid)
            : false;

    // Gates the manual "Publish profile" button in HomeContent's draft banner — a pilot-
    // signup-provisioned artist circle must meet the same completion bar as
    // maybeAutoPublishPilotArtistCircle (picture, About text, creator's Community Guidelines
    // signature) before it can be published manually, or that button defeats the whole point
    // of gating auto-publish on it. Manually-created (CircleWizard) managed identities were
    // never gated here and stay that way.
    const isDraftAutoProvisionedArtistCircle =
        circle.circleType !== "user" &&
        (circle.publishStatus ?? "published") === "draft" &&
        getPeerifyMetadata(circle).autoProvisionedFromSignup === true;
    const pilotArtistCirclePublishReady = isDraftAutoProvisionedArtistCircle
        ? await isPilotArtistCircleReadyToPublish(circle)
        : true;

    return (
        <>
            <>
                <HomeCover circle={plainCircle} />
                <HomeContent
                    circle={plainCircle}
                    authorizedToEdit={authorizedToEdit}
                    viewerDid={userDid}
                    parentCircle={plainParentCircle}
                    proofOfHumanitySummary={plainProofOfHumanitySummary}
                    isOwnAutoProvisionedArtistCircle={isOwnAutoProvisionedArtistCircle}
                    hasAutoProvisionedArtistCircle={viewerHasAutoProvisionedArtistCircle}
                    pilotArtistCirclePublishReady={pilotArtistCirclePublishReady}
                />
            </>
            <CircleTabs circle={plainCircle} />

            {children}
        </>
    );
}

export async function generateMetadata(props: Props): Promise<Metadata> {
    const params = await props.params;
    let handle = params.handle;

    // get circle from database
    let circle = await getCircleByHandle(handle);
    if (!circle) {
        circle = await getDefaultCircle();
    }

    const title = circle.name;
    const description = circle.description ?? circle.mission;

    return {
        title,
        description,
        icons: {
            icon: [
                { url: "/peerify/favicon.ico", sizes: "any" },
                { url: "/peerify/favicon.png", type: "image/png" },
            ],
            shortcut: "/peerify/favicon.ico",
            apple: "/peerify/favicon.png",
        },
        openGraph: {
            title,
            description: description ?? appConfig.description,
            siteName: appConfig.name,
            type: "profile",
        },
    };
}
