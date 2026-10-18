"use client";

import React from "react";
import Image from "next/image"; // Keep Image import if needed elsewhere, or remove if unused after changes
import { Circle, Media } from "@/models/models";
import { useIsMobile } from "@/components/utils/use-is-mobile";
import ImageCarousel from "@/components/ui/image-carousel"; // Import the new carousel component
import { getCircleCoverImages, getDefaultHeroUrl } from "@/lib/default-heroes";

type HomeContentProps = {
    circle: Circle;
};

// Remove authorizedToEdit from props destructuring
export default function HomeCover({ circle }: HomeContentProps) {
    const isMobile = useIsMobile();

    // Uploaded images, or the default hero for this profile type
    const carouselImages: Media[] = getCircleCoverImages(circle);

    return (
        <>
            <div className="relative">
                <div
                    className={
                        isMobile
                            ? // Trimmed from 270px: on mobile, circles with fuller headers (bio,
                              // pledge button, genre badges) push CircleTabs down far enough to sit
                              // partially behind the fixed bottom nav on initial load. This alone
                              // doesn't guarantee clearance for every circle's header content, but
                              // meaningfully reduces the overlap across the board.
                              "relative h-[220px] w-full overflow-hidden"
                            : "relative h-[350px] w-full overflow-hidden"
                    }
                >
                    {/* Replace static image and old trigger with the ImageCarousel */}
                    <ImageCarousel
                        images={carouselImages}
                        options={{ loop: carouselImages.length > 1 }} // Enable loop only if multiple images
                        containerClassName="h-full" // Ensure carousel container fills the height
                        imageClassName="object-cover" // Ensure images cover the slide area
                        fallbackUrl={getDefaultHeroUrl(circle)}
                    />
                </div>
            </div>
        </>
    );
}
