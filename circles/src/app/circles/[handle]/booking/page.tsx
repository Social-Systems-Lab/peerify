import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCircleByHandle } from "@/lib/data/circle";
import { getPeerifyVenueProfile, hasPeerifyVenueProfileContent, isPeerifyVenueIdentity } from "@/lib/peerify/artist-profile";
import VenueBookingDetail from "@/components/modules/home/venue-booking-detail";

type PageProps = {
    params: Promise<{ handle: string }>;
};

export default async function VenueBookingPage(props: PageProps) {
    const { handle } = await props.params;
    const circle = await getCircleByHandle(handle);
    if (!circle) {
        notFound();
    }

    // Same public-as-the-About-page's-Booking-terms-section visibility this content already had
    // — no new eligibility/role gating. If there's nothing to show, 404 rather than render an
    // empty page (matches the pattern funding/page.tsx uses for its own "not enabled" case).
    if (!isPeerifyVenueIdentity(circle) || !hasPeerifyVenueProfileContent(getPeerifyVenueProfile(circle))) {
        notFound();
    }

    return (
        <div className="formatted w-full py-6">
            <div className="mx-auto mb-4 flex w-full max-w-5xl items-center px-4">
                <Button asChild variant="ghost">
                    <Link href={`/circles/${circle.handle}/home`}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to {circle.name}
                    </Link>
                </Button>
            </div>
            <div className="mx-auto w-full max-w-5xl px-4">
                <VenueBookingDetail circle={circle} />
            </div>
        </div>
    );
}
