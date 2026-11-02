import { NextRequest, NextResponse } from "next/server";
import { Client as MinioClient } from "minio";
import { getClientIp } from "@/lib/utils/client-ip";
import { isMissingObjectError, recordStorageMiss, storageBlockedForSeconds } from "@/lib/storage/miss-limiter";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;

  // Too many missing objects from this IP recently: refuse everything, hits included, until the
  // window ends (see miss-limiter.ts). Internal requests (no X-Real-IP) aren't limited.
  const clientIp = getClientIp(req.headers);
  if (clientIp) {
    const blockedForSeconds = storageBlockedForSeconds(clientIp);
    if (blockedForSeconds > 0) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(blockedForSeconds) } },
      );
    }
  }

  // Production storage proxy is intentionally enabled.
  const host = process.env.MINIO_HOST || "127.0.0.1";
  const port = parseInt(process.env.MINIO_PORT || "9000", 10);
  // No default credentials: a missing key is a configuration error, not a guess.
  const accessKey = process.env.MINIO_ROOT_USERNAME;
  const secretKey = process.env.MINIO_ROOT_PASSWORD;
  if (!accessKey || !secretKey) {
    console.error("Storage proxy: MINIO_ROOT_USERNAME / MINIO_ROOT_PASSWORD not set");
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }
  const bucket = process.env.MINIO_BUCKET || "circles";

  const objectName = (path || []).join("/");
  if (!objectName) {
    return NextResponse.json({ error: "Missing object path" }, { status: 400 });
  }

  const client = new MinioClient({
    endPoint: host,
    port,
    useSSL: false,
    accessKey,
    secretKey,
  });

  try {
    const stream = await client.getObject(bucket, objectName);
    const buffer = await streamToBuffer(stream);

    const lower = objectName.toLowerCase();
    const contentType =
      lower.endsWith(".png") ? "image/png" :
      lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" :
      lower.endsWith(".webp") ? "image/webp" :
      lower.endsWith(".gif") ? "image/gif" :
      lower.endsWith(".svg") ? "image/svg+xml" :
      "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    // A missing object is a 404 and counts towards this IP's misses. Not logged: a guesser would
    // fill the log with names.
    if (isMissingObjectError(err)) {
      if (clientIp) recordStorageMiss(clientIp);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[storage proxy] failed", { bucket, objectName, host, port, err });
    return NextResponse.json({ error: "Storage fetch failed" }, { status: 502 });
  }
}