"use client";

import { ChangeEvent, useState } from "react";
import Image from "next/image";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { MultiImageUploader, ImageItem } from "@/components/forms/controls/multi-image-uploader";
import { Media } from "@/models/models";
import { savePilotPictureAction } from "@/app/onboarding/pilot/actions";

type PhotoStepProps = {
    circleId: string;
    initialPictureUrl?: string;
    initialImages?: Media[];
    reassurance?: string;
    onSaved?: (picture?: { url: string }, images?: Media[]) => void;
    onContinue: () => void;
    onSkip: () => void;
};

const ABOUT_IMAGE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export function PhotoStep({
    circleId,
    initialPictureUrl,
    initialImages,
    reassurance,
    onSaved,
    onContinue,
    onSkip,
}: PhotoStepProps) {
    const { toast } = useToast();
    const [pictureFile, setPictureFile] = useState<File | null>(null);
    const [picturePreview, setPicturePreview] = useState(initialPictureUrl);
    const [images, setImages] = useState<ImageItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const handlePictureChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setPictureFile(file);
        setPicturePreview(URL.createObjectURL(file));
    };

    const hasChanges = Boolean(pictureFile) || images.some((item) => item.file);

    const handleContinue = async () => {
        if (!hasChanges) {
            onContinue();
            return;
        }

        setIsSaving(true);
        try {
            const result = await savePilotPictureAction(circleId, pictureFile, images);
            if (!result.success) {
                toast({ title: "Couldn't save your photo", description: result.message, variant: "destructive" });
                return;
            }
            onSaved?.(pictureFile ? { url: picturePreview || "" } : undefined);
            onContinue();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border bg-muted">
                    {picturePreview ? (
                        <Image src={picturePreview} alt="Avatar preview" fill sizes="80px" className="object-cover" />
                    ) : null}
                </div>
                <div className="space-y-1.5">
                    <Label
                        htmlFor="onboarding-avatar-upload"
                        className="inline-flex cursor-pointer items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                    >
                        <Camera className="h-4 w-4" />
                        Upload photo
                    </Label>
                    <input
                        id="onboarding-avatar-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePictureChange}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Cover image</Label>
                <MultiImageUploader
                    initialImages={initialImages || []}
                    onChange={setImages}
                    maxImages={1}
                    previewMode="large"
                    enableReordering={false}
                    maxFileSize={ABOUT_IMAGE_UPLOAD_MAX_BYTES}
                    maxFileSizeLabel="8 MB"
                    onValidationError={(message) =>
                        toast({ title: "Image too large", description: message, variant: "destructive" })
                    }
                    dropzoneClassName="h-32"
                />
            </div>

            {reassurance ? <p className="text-xs text-muted-foreground">{reassurance}</p> : null}

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <Button type="button" variant="outline" className="sm:flex-1" onClick={onSkip} disabled={isSaving}>
                    Skip for now
                </Button>
                <Button type="button" className="sm:flex-1" onClick={handleContinue} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Continue
                </Button>
            </div>
        </div>
    );
}
