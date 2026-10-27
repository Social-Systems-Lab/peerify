"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { Circle, Media } from "@/models/models";
import { useIsMobile } from "@/components/utils/use-is-mobile";
import ImageCarousel from "@/components/ui/image-carousel"; // Import the new carousel component
import { useToast } from "@/components/ui/use-toast";
import { getCircleCoverImages, getDefaultHeroUrl } from "@/lib/default-heroes";
import { getImageUploadRejection } from "@/lib/image-upload-limits";
import { updateCircleCoverAction } from "./cover-actions";

type HomeContentProps = {
    circle: Circle;
    // Shows "Change cover". Display only: updateCircleCoverAction checks edit_about itself.
    authorizedToEdit?: boolean;
};

export default function HomeCover({ circle, authorizedToEdit = false }: HomeContentProps) {
    const isMobile = useIsMobile();
    const router = useRouter();
    const { toast } = useToast();
    const [isUploading, setIsUploading] = useState(false);

    // Uploaded images, or the default hero for this profile type
    const carouselImages: Media[] = getCircleCoverImages(circle);

    const handleCoverChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = ""; // lets the same file be picked again after an error
        if (!file || !circle._id) return;

        const rejection = getImageUploadRejection(file);
        if (rejection) {
            toast({ title: "Error", description: rejection, variant: "destructive" });
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("cover", file);
            const result = await updateCircleCoverAction(circle._id, formData);
            if (result.success) {
                toast({ title: "Success", description: result.message });
                router.refresh();
            } else {
                toast({ title: "Error", description: result.message, variant: "destructive" });
            }
        } catch (error) {
            console.error("Cover upload failed:", error);
            toast({
                title: "Error",
                description: "The cover couldn't be updated. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsUploading(false);
        }
    };

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
                    {/* Keyed on the first image so a changed cover remounts the carousel */}
                    <ImageCarousel
                        key={carouselImages[0]?.fileInfo.url}
                        images={carouselImages}
                        options={{ loop: carouselImages.length > 1 }} // Enable loop only if multiple images
                        containerClassName="h-full" // Ensure carousel container fills the height
                        imageClassName="object-cover" // Ensure images cover the slide area
                        fallbackUrl={getDefaultHeroUrl(circle)}
                    />
                    {authorizedToEdit && circle._id ? (
                        <label
                            htmlFor={`coverUpload-${circle._id}`}
                            aria-disabled={isUploading}
                            // Raised above the carousel's bottom-right dots when there are several covers
                            className={`absolute ${carouselImages.length > 1 ? "bottom-9" : "bottom-3"} right-3 z-20 flex cursor-pointer items-center gap-2 rounded-full bg-[#252525]/80 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#252525] ${
                                isUploading ? "pointer-events-none opacity-70" : ""
                            }`}
                        >
                            {isUploading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Camera className="h-4 w-4" />
                            )}
                            {isUploading ? "Uploading…" : "Change cover"}
                            <input
                                id={`coverUpload-${circle._id}`}
                                type="file"
                                accept="image/*"
                                onChange={handleCoverChange}
                                disabled={isUploading}
                                className="hidden"
                            />
                        </label>
                    ) : null}
                </div>
            </div>
        </>
    );
}
