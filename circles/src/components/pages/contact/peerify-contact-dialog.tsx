"use client";

import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { submitContactFormAction } from "./actions";
import { CONTACT_REASON_VALUES, CONTACT_REASONS } from "./constants";

const contactFormSchema = z.object({
    name: z.string().trim().min(1, "Please enter your name"),
    email: z.string().trim().email("Enter a valid email address"),
    reason: z.enum(CONTACT_REASON_VALUES, { errorMap: () => ({ message: "Please choose a reason" }) }),
    message: z.string().trim().min(1, "Please enter a message"),
    company: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

const INK = "#181512";
const INK_MUTED = "#6b6153";
const MUSTARD = "#e8720c";

const bodyFont = { fontFamily: "'Raleway', sans-serif" };
const headingFont = { fontFamily: "'Playfair Display', serif" };

interface PeerifyContactDialogProps {
    trigger: ReactNode;
}

export default function PeerifyContactDialog({ trigger }: PeerifyContactDialogProps) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<ContactFormData>({
        resolver: zodResolver(contactFormSchema),
        defaultValues: { name: "", email: "", reason: undefined, message: "", company: "" },
    });

    const onSubmit = async (data: ContactFormData) => {
        setIsSubmitting(true);
        setErrorMessage("");
        try {
            const result = await submitContactFormAction(data);
            if (result.success) {
                setStatus("success");
            } else {
                setStatus("error");
                setErrorMessage(result.message);
            }
        } catch (error) {
            setStatus("error");
            setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            // Wait out the close animation before resetting so the form/success state
            // doesn't visibly flash back to blank while the dialog is fading out.
            setTimeout(() => {
                form.reset();
                setStatus("idle");
                setErrorMessage("");
            }, 200);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent
                className="rounded-[15px] border-[#e3d8ca] bg-[#fcfbf8] p-8 sm:max-w-[480px]"
                style={bodyFont}
            >
                {status === "success" ? (
                    <div className="py-4 text-center">
                        <DialogTitle className="text-2xl font-bold" style={{ ...headingFont, color: INK }}>
                            Message sent
                        </DialogTitle>
                        <p className="mt-3 text-sm" style={{ color: INK_MUTED }}>
                            Thanks — we&apos;ll get back to you soon.
                        </p>
                    </div>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-bold" style={{ ...headingFont, color: INK }}>
                                Get in touch
                            </DialogTitle>
                            <DialogDescription className="text-sm" style={{ color: INK_MUTED }}>
                                Tell us a bit about yourself and what you&apos;re after — we read every message.
                            </DialogDescription>
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="mt-2 space-y-4">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel
                                                className="text-xs font-bold uppercase tracking-wide"
                                                style={{ color: INK_MUTED }}
                                            >
                                                Name
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="Your name"
                                                    autoComplete="name"
                                                    className="border-[#e3d8ca] bg-white focus-visible:ring-[#e8720c]"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel
                                                className="text-xs font-bold uppercase tracking-wide"
                                                style={{ color: INK_MUTED }}
                                            >
                                                Email
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="email"
                                                    placeholder="you@example.com"
                                                    autoComplete="email"
                                                    className="border-[#e3d8ca] bg-white focus-visible:ring-[#e8720c]"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="reason"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel
                                                className="text-xs font-bold uppercase tracking-wide"
                                                style={{ color: INK_MUTED }}
                                            >
                                                Reason
                                            </FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="border-[#e3d8ca] bg-white focus:ring-[#e8720c]">
                                                        <SelectValue placeholder="Choose one" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {CONTACT_REASONS.map((option) => (
                                                        <SelectItem key={option.value} value={option.value}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="message"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel
                                                className="text-xs font-bold uppercase tracking-wide"
                                                style={{ color: INK_MUTED }}
                                            >
                                                Message
                                            </FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    placeholder="What's on your mind?"
                                                    rows={4}
                                                    className="border-[#e3d8ca] bg-white focus-visible:ring-[#e8720c]"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {/* Honeypot: left visually and semantically hidden for real users; bots that
                                    fill every field in the raw form will trip it. */}
                                <div
                                    className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden opacity-0"
                                    aria-hidden="true"
                                >
                                    <label htmlFor="contact-company">Company</label>
                                    <input
                                        id="contact-company"
                                        type="text"
                                        tabIndex={-1}
                                        autoComplete="off"
                                        {...form.register("company")}
                                    />
                                </div>
                                {status === "error" && <p className="text-sm text-red-600">{errorMessage}</p>}
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full rounded-md px-6 py-3 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                    style={{ backgroundColor: MUSTARD }}
                                    onMouseEnter={(e) => {
                                        if (!isSubmitting) e.currentTarget.style.backgroundColor = "#ff8c2a";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = MUSTARD;
                                    }}
                                >
                                    {isSubmitting ? "Sending..." : "Send message"}
                                </button>
                            </form>
                        </Form>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
