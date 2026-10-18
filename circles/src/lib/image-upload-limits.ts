export const ABOUT_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const ABOUT_IMAGE_UPLOAD_MAX_MB = 10;

export const ABOUT_IMAGE_UPLOAD_TOO_LARGE_MESSAGE = `Image is too large. Please upload an image under ${ABOUT_IMAGE_UPLOAD_MAX_MB} MB.`;

// Shown when the server refuses an uploaded image (see sanitizeUpload / getImageUploadErrorMessage).
export const UNSUPPORTED_IMAGE_MESSAGE = "This file type isn't supported. Please use JPG, PNG or WebP.";
export const IMAGE_UPLOAD_FAILED_MESSAGE = "This image couldn't be uploaded. Please try again.";

export const formatFileSizeMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
