"use server";

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordSchema } from "@/models/models";
import { getAuthenticatedUserDid, createUserSession } from "./auth";
import {
    ENCRYPTION_ALGORITHM,
    ENCRYPTED_PRIVATE_KEY_FILENAME,
    IV_FILENAME,
    PRIVATE_KEY_FILENAME,
    PUBLIC_KEY_FILENAME,
    SALT_FILENAME,
    USERS_DIR,
} from "./auth";
import { Circles } from "../data/db";
import { getUserPrivate } from "../data/user";

// Schema for the initiatePasswordReset action input
const initiateResetSchema = z.object({
    userId: z.string(), // MongoDB ObjectId string
});

// Type for the return value of initiatePasswordReset
type InitiateResetResult = { success: true; token: string } | { success: false; error: string };

/**
 * Server Action for Admins to initiate the password reset process for a user.
 * Generates a reset token, stores its hash, and returns the unhashed token.
 * @param formData - FormData containing the userId.
 */
export async function initiatePasswordReset(userId: string): Promise<InitiateResetResult> {
    try {
        console.log("userID:", userId);

        // check if user is admin
        let userDid = await getAuthenticatedUserDid();
        if (!userDid) {
            throw new Error("Unauthorized: You do not have permission to access this resource.");
        }
        let currentUser = await getUserPrivate(userDid);
        if (!currentUser.isAdmin) {
            throw new Error("Unauthorized: You do not have permission to access this resource.");
        }

        // Validate input
        const result = initiateResetSchema.safeParse({
            userId: userId,
        });
        if (!result.success) {
            return { success: false, error: "Invalid user ID provided." };
        }

        // Verify the target user exists
        const targetUser = await Circles.findOne({ _id: new ObjectId(userId) });
        if (!targetUser) {
            return { success: false, error: "Target user not found." };
        }

        // Generate token and expiry
        const unhashedToken = crypto.randomBytes(32).toString("hex");
        const expiry = new Date(Date.now() + 3600 * 1000); // 1 hour expiry

        // Hash the token (using SHA-256 for simplicity, consider bcrypt in production)
        const hashedToken = crypto.createHash("sha256").update(unhashedToken).digest("hex");

        // Update the target user's document
        const updateResult = await Circles.updateOne(
            { _id: new ObjectId(userId) },
            {
                $set: {
                    passwordResetToken: hashedToken,
                    passwordResetTokenExpiry: expiry,
                },
            },
        );

        if (updateResult.modifiedCount !== 1) {
            console.error(`Failed to update password reset token for user ${userId}`);
            return {
                success: false,
                error: "Failed to initiate reset. Please try again.",
            };
        }

        // Revalidate admin path if necessary (adjust path as needed)
        revalidatePath("/admin"); // Or specific admin user management path

        // Return the unhashed token
        return { success: true, token: unhashedToken };
    } catch (error) {
        console.error("Error initiating password reset:", error);
        return {
            success: false,
            error: "An unexpected error occurred. Please try again.",
        };
    }
}

// --- Reset Password Action ---

// Schema for the resetPassword action input
const resetPasswordSchema = z.object({
    token: z.string().min(1, "Reset token is required."),
    // email: emailSchema, // Email will be derived from the user found via token
    password: passwordSchema,
    // It's good practice to have password confirmation on the client-side,
    // but the server action only needs the final password.
});

// Type for the return value of resetPassword
type ResetPasswordResult = { success: true } | { success: false; error: string };

async function pathExists(targetPath: string): Promise<boolean> {
    return fs
        .access(targetPath)
        .then(() => true)
        .catch(() => false);
}

async function rebuildPasswordCredentials(params: {
    accountPath: string;
    did: string;
    newPassword: string;
    existingPublicKey?: string;
}): Promise<{ publicKeyForUserRecord?: string }> {
    const { accountPath, did, newPassword, existingPublicKey } = params;
    const plaintextPrivateKeyPath = path.join(accountPath, PRIVATE_KEY_FILENAME);
    const publicKeyPath = path.join(accountPath, PUBLIC_KEY_FILENAME);

    await fs.mkdir(USERS_DIR, { recursive: true });
    await fs.mkdir(accountPath, { recursive: true });

    let privateKeyPem: string | undefined;
    let publicKeyForUserRecord = existingPublicKey;

    if (await pathExists(plaintextPrivateKeyPath)) {
        privateKeyPem = await fs.readFile(plaintextPrivateKeyPath, "utf8");
    }

    if (!publicKeyForUserRecord && (await pathExists(publicKeyPath))) {
        publicKeyForUserRecord = await fs.readFile(publicKeyPath, "utf8");
    }

    if (!privateKeyPem) {
        // The original private key cannot be recovered without the old password once the
        // filesystem credential material is gone, so generate a fresh local keypair in-place.
        const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
        publicKeyForUserRecord = publicKey.export({ type: "pkcs1", format: "pem" }) as string;
        console.warn(`Password reset regenerated filesystem key material for DID ${did} after credential loss.`);
    }

    const newSalt = crypto.randomBytes(16);
    const newIv = crypto.randomBytes(16);
    const newEncryptionKey = crypto.pbkdf2Sync(newPassword, newSalt, 100000, 32, "sha512");
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, newEncryptionKey, newIv);
    let newEncryptedPrivateKey = cipher.update(privateKeyPem, "utf8", "hex");
    newEncryptedPrivateKey += cipher.final("hex");

    await fs.writeFile(path.join(accountPath, SALT_FILENAME), newSalt);
    await fs.writeFile(path.join(accountPath, IV_FILENAME), newIv);
    await fs.writeFile(path.join(accountPath, ENCRYPTED_PRIVATE_KEY_FILENAME), newEncryptedPrivateKey);

    if (publicKeyForUserRecord) {
        await fs.writeFile(publicKeyPath, publicKeyForUserRecord);
    }

    return { publicKeyForUserRecord };
}

/**
 * Server Action for Users to reset their password using a valid token.
 * Verifies the token and rotates password-derived credential material.
 * DID MUST NOT CHANGE (Option A).
 * @param token - The unhashed password reset token from the URL.
 * @param newPassword - The new password provided by the user.
 */
export async function resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult> {
    try {
        // 1. Validate input (token and newPassword)
        const result = resetPasswordSchema.safeParse({
            token,
            password: newPassword, // Zod schema uses 'password'
        });
        if (!result.success) {
            const errors = result.error.errors.map((e) => e.message).join(", ");
            return { success: false, error: `Invalid input: ${errors}` };
        }

        // 2. Hash the provided token for lookup
        const hashedTokenToFind = crypto.createHash("sha256").update(token).digest("hex");

        // 3. Find user by the hashed password reset token
        const user = await Circles.findOne({ passwordResetToken: hashedTokenToFind });

        if (!user || !user.passwordResetTokenExpiry) {
            // Check expiry along with token existence
            return { success: false, error: "Invalid or expired reset token." };
        }

        // 4. Verify token expiry (token itself is verified by being found)
        if (new Date() > user.passwordResetTokenExpiry) {
            // Optionally clear the expired token here
            await Circles.updateOne(
                { _id: user._id },
                { $set: { passwordResetToken: null, passwordResetTokenExpiry: null } },
            );
            return { success: false, error: "Reset token has expired." };
        }

        // DID MUST NOT CHANGE (Option A): password reset cannot mutate user.did.
        const existingDid = user.did;
        if (!existingDid) {
            // Should not happen if user exists, but good to check
            return { success: false, error: "User identity information is missing." };
        }

        const accountPath = path.join(USERS_DIR, existingDid);
        let publicKeyForUserRecord = user.publicKey;

        try {
            const rebuildResult = await rebuildPasswordCredentials({
                accountPath,
                did: existingDid,
                newPassword,
                existingPublicKey: user.publicKey,
            });
            publicKeyForUserRecord = rebuildResult.publicKeyForUserRecord;
        } catch (fsError) {
            console.error("Filesystem error during password reset:", fsError);
            return { success: false, error: "Failed to update user credentials." };
        }

        const resetUpdateSet: {
            passwordResetToken: null;
            passwordResetTokenExpiry: null;
            publicKey?: string;
        } = {
            passwordResetToken: null,
            passwordResetTokenExpiry: null,
        };

        if (publicKeyForUserRecord && publicKeyForUserRecord !== user.publicKey) {
            resetUpdateSet.publicKey = publicKeyForUserRecord;
        }

        // 5. Update User Database Record (DID remains unchanged)
        const userUpdateResult = await Circles.updateOne(
            { _id: user._id },
            {
                $set: resetUpdateSet,
            },
        );

        if (userUpdateResult.matchedCount !== 1) {
            console.error(`Failed to update primary user record for DID ${existingDid}`);
            return { success: false, error: "Failed to update user record. Please contact support." };
        }

        return { success: true };
    } catch (error) {
        console.error("Error resetting password:", error);
        return {
            success: false,
            error: "An unexpected error occurred during password reset.",
        };
    }
}

// --- Login Link Action ---
//
// Reuses the same hashed-token/expiry pattern as password reset (see resetPassword
// above and requestLoginLinkAction in src/components/forms/login/actions.ts), but
// for accounts whose password is unusable to them (e.g. pilot-signup accounts, which
// get a random server-generated password at creation). Unlike resetPassword, this
// never touches password-derived credential material on disk — it only verifies the
// token and establishes a session, the same way clicking the original signup
// verification link does (see verifyEmailAction in
// src/app/(auth)/verify-email/actions.ts). Deliberately a separate token/field pair
// (loginLinkToken/loginLinkTokenExpiry) rather than reusing emailVerificationToken,
// so requesting a login link can never interfere with a pending signup verification
// or flip isEmailVerified in a confusing way for an already-verified account.

const consumeLoginLinkSchema = z.object({
    token: z.string().min(1, "Login link token is required."),
});

type ConsumeLoginLinkResult = { success: true; handle?: string } | { success: false; error: string };

/**
 * Server Action to log a user in via a magic login-link token, without requiring
 * their password.
 * @param token - The unhashed login link token from the URL.
 */
export async function consumeLoginLink(token: string): Promise<ConsumeLoginLinkResult> {
    try {
        const result = consumeLoginLinkSchema.safeParse({ token });
        if (!result.success) {
            return { success: false, error: "Invalid login link." };
        }

        const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
        const user = await Circles.findOne({ loginLinkToken: hashedToken });

        if (!user || !user.loginLinkTokenExpiry) {
            return { success: false, error: "Invalid or expired login link." };
        }

        if (new Date() > user.loginLinkTokenExpiry) {
            await Circles.updateOne(
                { _id: user._id },
                { $set: { loginLinkToken: null, loginLinkTokenExpiry: null } },
            );
            return { success: false, error: "This login link has expired. Please request a new one." };
        }

        if (!user.did) {
            return { success: false, error: "Could not log in. Please contact support." };
        }

        // Clicking a valid link proves ownership of the account, the same way the
        // original signup verification link does — so mark the email verified here too
        // if it wasn't already (covers accounts whose original link expired unused).
        const updateSet: Record<string, unknown> = { loginLinkToken: null, loginLinkTokenExpiry: null };
        if (!user.isEmailVerified) {
            updateSet.isEmailVerified = true;
        }
        await Circles.updateOne({ _id: user._id }, { $set: updateSet });

        const privateUser = await getUserPrivate(user.did);
        await createUserSession(privateUser, user.did);

        return { success: true, handle: user.handle || undefined };
    } catch (error) {
        console.error("Error consuming login link:", error);
        return { success: false, error: "An unexpected error occurred. Please try again." };
    }
}
