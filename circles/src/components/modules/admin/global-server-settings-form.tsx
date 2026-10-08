"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea"; // Assuming Textarea component exists
import { useToast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import type { ClientServerSettings, SecretStatus } from "@/lib/utils/client-server-settings";
import { GlobalServerSettingsFormData, globalServerSettingsValidationSchema } from "./global-server-settings-schema";
import { saveGlobalServerSettings } from "./actions";

interface GlobalServerSettingsFormProps {
    serverSettings: ClientServerSettings; // Allow-listed: never contains secret values
    maxWidth?: string; // Optional prop for styling
}

// Secrets are only ever shown as set / not set: the app reads them from the server environment,
// so they're changed in .env.local, not here.
function SecretStatusItem({ label, status }: { label: string; status: SecretStatus }) {
    return (
        <div className="space-y-2">
            <div className="text-sm font-medium">{label}</div>
            <p className="text-sm text-muted-foreground">
                {status === "set" ? "Set" : "Not set"} in the server environment (.env.local). Change it there and
                restart the app.
            </p>
        </div>
    );
}

export function GlobalServerSettingsForm({
    serverSettings,
    maxWidth = "100%",
}: GlobalServerSettingsFormProps): React.ReactElement {
    const { toast } = useToast();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<GlobalServerSettingsFormData>({
        resolver: zodResolver(globalServerSettingsValidationSchema),
        defaultValues: {
            name: serverSettings?.name || "",
            description: serverSettings?.description || "",
            url: serverSettings?.url || "",
            registryUrl: serverSettings?.registryUrl || "",
            mapboxKey: serverSettings?.mapboxKey || "",
        },
    });

    const onSubmit = async (data: GlobalServerSettingsFormData) => {
        setIsSubmitting(true);
        try {
            const result = await saveGlobalServerSettings(data);
            if (result.success) {
                toast({
                    title: "Success",
                    description: result.message || "Global server settings updated successfully",
                });
                router.refresh(); // Refresh page to reflect changes
            } else {
                toast({
                    title: "Error",
                    description: result.message || "Failed to update global server settings",
                    variant: "destructive",
                });
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "An unexpected error occurred",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="formatted space-y-6" style={{ maxWidth }}>
                {/* Server Info Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Server Information</CardTitle>
                        <CardDescription>Basic details about this Circles instance.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Server Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Circles Instance Name" {...field} />
                                    </FormControl>
                                    <FormDescription>The public name of this server.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                        <Textarea placeholder="A brief description of this server" {...field} />
                                    </FormControl>
                                    <FormDescription>Optional description.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="url"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Server URL</FormLabel>
                                    <FormControl>
                                        <Input placeholder="https://your-circles-domain.com" {...field} />
                                    </FormControl>
                                    <FormDescription>
                                        The main public URL where this server is accessible.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="registryUrl"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Circles Registry URL</FormLabel>
                                    <FormControl>
                                        <Input placeholder="https://circles-registry.com (optional)" {...field} />
                                    </FormControl>
                                    <FormDescription>URL of the central registry service, if used.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        {/* Display DID read-only */}
                        {serverSettings?.did && (
                            <FormItem>
                                <FormLabel>Server DID</FormLabel>
                                <FormControl>
                                    <Input readOnly value={serverSettings.did} className="bg-muted" />
                                </FormControl>
                                <FormDescription>
                                    The unique Decentralized Identifier for this server (read-only).
                                </FormDescription>
                            </FormItem>
                        )}
                    </CardContent>
                </Card>

                {/* API Keys Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>API Keys & Secrets</CardTitle>
                        <CardDescription>Confidential keys for authentication and external services.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <SecretStatusItem label="JWT Secret" status={serverSettings.secrets.jwtSecret} />
                        <SecretStatusItem label="OpenAI API Key" status={serverSettings.secrets.openaiKey} />
                        <FormField
                            control={form.control}
                            name="mapboxKey"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Mapbox API Key</FormLabel>
                                    <FormControl>
                                        <Input type="password" placeholder="pk.eyJ..." {...field} />
                                    </FormControl>
                                    <FormDescription>API key for using Mapbox map services.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>

                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save Global Settings"}
                </Button>
            </form>
        </Form>
    );
}
