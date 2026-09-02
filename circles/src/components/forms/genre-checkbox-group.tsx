"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export const CheckboxGroup = ({
    label,
    labelClassName,
    description,
    options,
    values,
    onChange,
    maxSelections,
}: {
    label: string;
    labelClassName?: string;
    description?: React.ReactNode;
    options: readonly string[];
    values: string[];
    onChange: (values: string[]) => void;
    maxSelections?: number;
}) => {
    const limitReached = typeof maxSelections === "number" && values.length >= maxSelections;

    return (
        <div className="space-y-3">
            <div>
                <Label className={labelClassName}>{label}</Label>
                {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {options.map((option) => {
                    const checked = values.includes(option);
                    const disabled = !checked && limitReached;
                    return (
                        <label
                            key={option}
                            className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                                disabled ? "opacity-50" : ""
                            }`}
                        >
                            <Checkbox
                                checked={checked}
                                disabled={disabled}
                                onCheckedChange={(nextChecked) => {
                                    if (nextChecked) {
                                        onChange([...values, option]);
                                        return;
                                    }
                                    onChange(values.filter((value) => value !== option));
                                }}
                            />
                            <span>{option}</span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};
