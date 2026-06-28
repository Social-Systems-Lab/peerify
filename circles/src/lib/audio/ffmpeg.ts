// Peerify: generate a single web-playable MP3 derivative from an uploaded audio
// original, using one ffmpeg invocation. Duration is parsed from the same call's
// stderr so we don't need a separate ffprobe pass.

import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs-extra";
import os from "os";
import path from "path";

// Resolve an ffmpeg binary. Order:
//   1. FFMPEG_PATH env (explicit override, e.g. system install in Docker)
//   2. system "ffmpeg" on PATH
//   3. the ffmpeg-static bundled binary (covers local dev with no system ffmpeg)
const resolveFfmpegPath = (): string => {
    if (process.env.FFMPEG_PATH) {
        return process.env.FFMPEG_PATH;
    }
    try {
        const ffmpegStatic = require("ffmpeg-static");
        const staticPath = typeof ffmpegStatic === "string" ? ffmpegStatic : ffmpegStatic?.default;
        if (staticPath) {
            return staticPath;
        }
    } catch {
        // ffmpeg-static not installed / not resolvable; fall back to PATH
    }
    return "ffmpeg";
};

// Parse "Duration: 00:03:21.50" out of ffmpeg's stderr → seconds.
const parseDurationSec = (stderr: string): number | undefined => {
    const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
    if (!match) return undefined;
    const [, hh, mm, ss, frac] = match;
    const seconds =
        parseInt(hh, 10) * 3600 +
        parseInt(mm, 10) * 60 +
        parseInt(ss, 10) +
        parseFloat(`0.${frac}`);
    return Math.round(seconds);
};

export type DerivativeResult = {
    buffer: Buffer;
    durationSec?: number;
};

// Convert an arbitrary input audio buffer to ~192kbps MP3. Throws on failure
// (including ffmpeg not being available), which the caller surfaces to the user.
export const generateMp3Preview = async (input: Buffer, originalExt: string): Promise<DerivativeResult> => {
    const ffmpegPath = resolveFfmpegPath();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "peerify-audio-"));
    const safeExt = originalExt && /^\.[a-z0-9]+$/i.test(originalExt) ? originalExt : ".bin";
    const inputPath = path.join(tmpDir, `in-${randomBytes(6).toString("hex")}${safeExt}`);
    const outputPath = path.join(tmpDir, `out-${randomBytes(6).toString("hex")}.mp3`);

    try {
        await fs.writeFile(inputPath, input);

        const args = [
            "-hide_banner",
            "-y",
            "-i",
            inputPath,
            "-vn", // drop any cover-art/video stream
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-f",
            "mp3",
            outputPath,
        ];

        const stderr = await new Promise<string>((resolve, reject) => {
            const proc = spawn(ffmpegPath, args);
            let stderrBuf = "";
            proc.stderr.on("data", (chunk) => {
                stderrBuf += chunk.toString();
            });
            proc.on("error", (err) => {
                reject(new Error(`Failed to start ffmpeg (${ffmpegPath}): ${err.message}`));
            });
            proc.on("close", (code) => {
                if (code === 0) {
                    resolve(stderrBuf);
                } else {
                    reject(new Error(`ffmpeg exited with code ${code}: ${stderrBuf.slice(-500)}`));
                }
            });
        });

        const buffer = await fs.readFile(outputPath);
        if (buffer.length === 0) {
            throw new Error("ffmpeg produced an empty MP3 derivative");
        }

        return { buffer, durationSec: parseDurationSec(stderr) };
    } finally {
        await fs.remove(tmpDir).catch(() => {});
    }
};
