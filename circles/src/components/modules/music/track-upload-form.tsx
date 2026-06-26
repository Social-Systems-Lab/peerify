"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { uploadTrackAction } from "./actions";

type TrackUploadFormProps = {
    circleId: string;
};

export const TrackUploadForm: React.FC<TrackUploadFormProps> = ({ circleId }) => {
    const { toast } = useToast();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [title, setTitle] = useState("");
    const [rightsConfirmed, setRightsConfirmed] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const file = fileInputRef.current?.files?.[0];
        if (!title.trim()) {
            toast({ title: "Error", description: "Please enter a title.", variant: "destructive" });
            return;
        }
        if (!file) {
            toast({ title: "Error", description: "Please choose an audio file.", variant: "destructive" });
            return;
        }
        if (!rightsConfirmed) {
            toast({
                title: "Rights confirmation required",
                description: "You must confirm you own or control the rights to this audio.",
                variant: "destructive",
            });
            return;
        }

        const formData = new FormData();
        formData.append("title", title.trim());
        formData.append("circleId", circleId);
        formData.append("rightsConfirmed", "true");
        formData.append("audio", file);

        startTransition(async () => {
            const result = await uploadTrackAction(formData);
            if (result.success) {
                toast({ title: "Track uploaded", description: "Your track is ready to play." });
                setTitle("");
                setRightsConfirmed(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
                router.refresh();
            } else {
                toast({
                    title: "Upload failed",
                    description: result.message || "Something went wrong.",
                    variant: "destructive",
                });
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-2 font-semibold">
                <Music className="h-4 w-4" />
                Upload a track
            </div>

            <div className="flex flex-col gap-1.5">
                <Label htmlFor="track-title">Title</Label>
                <Input
                    id="track-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Track title"
                    disabled={isPending}
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <Label htmlFor="track-file">Audio file</Label>
                <Input
                    id="track-file"
                    ref={fileInputRef}
                    type="file"
                    accept=".mp3,.wav,.flac,.m4a,audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/x-m4a"
                    disabled={isPending}
                />
                <span className="text-xs text-gray-500">mp3, wav, flac or m4a (max 100MB)</span>
            </div>

            <div className="flex items-start gap-2">
                <Checkbox
                    id="track-rights"
                    checked={rightsConfirmed}
                    onCheckedChange={(checked) => setRightsConfirmed(checked === true)}
                    disabled={isPending}
                />
                <Label htmlFor="track-rights" className="text-sm font-normal leading-snug">
                    I own or control the rights to this audio and have permission to upload it.
                </Label>
            </div>

            <div>
                <Button type="submit" disabled={isPending}>
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isPending ? "Uploading…" : "Upload track"}
                </Button>
            </div>
        </form>
    );
};

export default TrackUploadForm;
