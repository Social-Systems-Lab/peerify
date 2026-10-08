import { FormSchema } from "../../../models/models";
import { z } from "zod";

// Zod schema for validation
export const globalServerSettingsValidationSchema = z.object({
    name: z.string().min(1, "Server name is required"),
    description: z.string().optional(),
    url: z.string().url("Invalid URL format").min(1, "Server URL is required"),
    registryUrl: z.string().url("Invalid URL format").optional().or(z.literal("")), // Allow empty string or valid URL
    mapboxKey: z.string().min(1, "Mapbox API Key is required"),
    // No jwtSecret/openaiKey: they live in the server environment and the form only shows whether
    // they're set. No did/defaultCircleId either: both are server-generated, so a submitted value
    // is never saved. zod strips any of these keys if a client still sends them.
});

// Type inferred from Zod schema
export type GlobalServerSettingsFormData = z.infer<typeof globalServerSettingsValidationSchema>;

// FormSchema for DynamicForm (if we were still using it, but good for structure reference)
export const globalServerSettingsFormSchema: FormSchema = {
    id: "global-server-settings-form", // New ID for global context
    title: "Global Server Settings",
    description: "Configure global server settings for this Circles instance",
    button: {
        text: "Save Global Configuration",
    },
    fields: [
        {
            name: "name",
            label: "Server Name",
            type: "text",
            required: true,
            description: "Name of this Circles instance",
        },
        {
            name: "description",
            label: "Description",
            type: "textarea",
            required: false,
            description: "Description of this Circles instance",
        },
        {
            name: "url",
            label: "Server URL",
            type: "text",
            required: true,
            description: "The public URL of this Circles instance",
        },
        {
            name: "registryUrl",
            label: "Circles Registry URL",
            type: "text", // Changed from registry-info as that might be custom field type
            required: false,
            description: "The URL of the Circles Registry service (optional)",
        },
        {
            name: "mapboxKey",
            label: "Mapbox API Key",
            type: "password",
            required: true,
            description: "API key for Mapbox services (e.g., maps)",
        },
    ],
};
