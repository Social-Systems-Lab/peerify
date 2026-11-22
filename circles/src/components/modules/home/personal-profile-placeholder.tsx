import { Lock } from "lucide-react";
import Link from "next/link";
import type { LimitedPersonalProfile } from "@/lib/peerify/personal-profile-access";

// The limited version of a personal profile (Tim, 2026-11-22): name, handle and picture only.
// A server component with plain markup, so only these three values reach the page payload.
export function PersonalProfilePlaceholder({ profile }: { profile: LimitedPersonalProfile }) {
    const signInPath = `/login?redirectTo=${encodeURIComponent(`/circles/${profile.handle}`)}`;
    return (
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
            <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={profile.pictureUrl ?? "/images/default-user-picture.png"}
                    alt=""
                    className="h-28 w-28 rounded-full border-4 border-white object-cover shadow-md"
                />
                <div className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#FE801B] shadow-md">
                    <Lock className="h-4 w-4 text-white" />
                </div>
            </div>
            {profile.name ? <h1 className="mt-5 text-2xl font-semibold">{profile.name}</h1> : null}
            {profile.handle ? <p className="text-sm text-muted-foreground">@{profile.handle}</p> : null}
            <p className="mt-4 text-sm text-gray-600">This profile is only visible to people signed in to Peerify.</p>
            <Link href={signInPath} className="mt-4 text-sm font-medium underline underline-offset-2">
                Sign in
            </Link>
        </div>
    );
}
