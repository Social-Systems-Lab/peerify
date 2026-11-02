// EditableField.tsx
"use client";

import React, { useState, KeyboardEvent } from "react";
import { FaEdit } from "react-icons/fa";
import { Input } from "@/components/ui/input";
import { updateCircleField } from "./actions";
import { useToast } from "@/components/ui/use-toast";
import { getProfileTextMaxLength, isProfileTextField, validateProfileText } from "@/lib/profile-text-limits";
import { cn } from "@/lib/utils";

type EditableFieldProps = {
    id: string;
    value: string;
    circleId: string;
    multiline?: boolean;
    setCircle?: React.Dispatch<React.SetStateAction<any>>;
    // Shown (muted) to editors when value is empty, so there is something to click
    placeholder?: string;
    // Classes for the displayed text, e.g. line-clamp-1
    textClassName?: string;
};

const EditableField: React.FC<EditableFieldProps> = ({
    id,
    value,
    circleId,
    setCircle,
    multiline = false,
    placeholder,
    textClassName,
}) => {
    const [editValue, setEditValue] = useState(value);
    const [isEditing, setIsEditing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();
    const maxLength = isProfileTextField(id) ? getProfileTextMaxLength(id) : undefined;

    const handleSave = async () => {
        const nextValue = editValue.trim();
        if (nextValue === value) {
            handleCancel();
            return;
        }

        // Same rules as the server (profile-text-limits.ts). Too-long text, e.g. a long mission
        // shown as the subtitle, stays in the editor with the message; it is never cut.
        const validationError = isProfileTextField(id) ? validateProfileText(id, nextValue) : null;
        if (validationError) {
            setError(validationError);
            toast({ title: "Not saved", description: validationError, variant: "destructive" });
            return;
        }

        setError(null);
        setIsEditing(false);
        const formData = new FormData();
        formData.append(id, nextValue);
        const result = await updateCircleField(circleId, formData);
        if (result.success) {
            toast({ title: "Success", description: result.message });

            // Update the circle state
            if (setCircle) {
                setCircle((prevCircle: any) => {
                    return {
                        ...prevCircle,
                        [id]: nextValue,
                    };
                });
            }
        } else {
            toast({ title: "Error", description: result.message, variant: "destructive" });
            setEditValue(value);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
        } else if (!multiline && e.key === "Enter") {
            e.preventDefault();
            handleSave();
        }
    };

    const handleCancel = () => {
        setIsEditing(false);
        setError(null);
        setEditValue(value);
    };

    if (isEditing) {
        const length = editValue.trim().length;
        const isTooLong = maxLength !== undefined && length > maxLength;
        return (
            <div className="w-full">
                {multiline ? (
                    <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        className="w-full rounded border p-2"
                    />
                ) : (
                    <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    />
                )}
                {maxLength !== undefined && (multiline || isTooLong) ? (
                    <p className={cn("mt-1 text-xs", isTooLong ? "text-destructive" : "text-gray-500")}>
                        {length}/{maxLength} characters
                    </p>
                ) : null}
                {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
            </div>
        );
    }

    const isEmpty = value.length === 0;
    return (
        <div className="group inline-flex max-w-full items-center gap-2">
            <span className={cn("min-w-0", isEmpty && "italic text-gray-400", textClassName)}>
                {isEmpty ? placeholder : value}
            </span>
            {/* Always visible (faint), not hover-only, so it can be found on touch screens */}
            <button
                type="button"
                aria-label={`Edit ${id}`}
                className="shrink-0 cursor-pointer opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => setIsEditing(true)}
            >
                <FaEdit className="h-4 w-4" />
            </button>
        </div>
    );
};

export default EditableField;
