import assert from "node:assert/strict";
import sharp from "sharp";
import { claimsToBeImage, sanitizeUpload, UnsupportedImageError } from "./sanitize-image";

const base = () => sharp({ create: { width: 120, height: 80, channels: 3, background: "#6a8" } });
// Orientation must be set via withMetadata({ orientation }); an Orientation key in withExif is ignored.
const gpsExif = {
    IFD0: { Make: "Test" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "0/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "0/1 0/1 0/1" },
};

const noMetadata = async (buffer: Buffer) => {
    const m = await sharp(buffer).metadata();
    assert.equal(m.exif, undefined, "no EXIF");
    assert.equal(m.xmp, undefined, "no XMP");
    assert.equal(m.iptc, undefined, "no IPTC");
    assert.equal(m.icc, undefined, "no ICC");
    assert.equal(m.orientation, undefined, "no orientation tag");
    return m;
};

const rejects = async (promise: Promise<unknown>, label: string) => {
    await assert.rejects(promise, (e) => e instanceof UnsupportedImageError, label);
};

const main = async () => {
    // claimsToBeImage
    assert.equal(claimsToBeImage("image/jpeg", "x.bin"), true);
    assert.equal(claimsToBeImage("application/octet-stream", "photo.JPG"), true);
    assert.equal(claimsToBeImage(undefined, "drawing.svg"), true);
    assert.equal(claimsToBeImage("application/pdf", "doc.pdf"), false);
    assert.equal(claimsToBeImage(undefined, undefined), false);

    // JPEG with GPS + orientation: stripped, rotation baked in (120x80 -> 80x120), stays JPEG
    const jpeg = await base().jpeg().withMetadata({ orientation: 6 }).withExif(gpsExif).toBuffer(); // 6 = rotate 90°
    const jin = await sharp(jpeg).metadata();
    assert.ok(jin.exif && jin.orientation === 6, "control: input has EXIF and orientation 6");
    const j = await sanitizeUpload(jpeg, "image/jpeg", "photo.jpeg");
    const jm = await noMetadata(j.buffer);
    assert.deepEqual([jm.format, jm.width, jm.height], ["jpeg", 80, 120]);
    assert.deepEqual([j.contentType, j.extension, j.sanitized], ["image/jpeg", ".jpg", true]);

    // PNG with EXIF + ICC profile
    const png = await base().png().withExif(gpsExif).withIccProfile("p3").toBuffer();
    assert.ok((await sharp(png).metadata()).icc, "control: input has ICC");
    const p = await sanitizeUpload(png, "image/png", "a.png");
    assert.equal((await noMetadata(p.buffer)).format, "png");
    assert.equal(p.contentType, "image/png");

    // WebP with EXIF, format taken from the bytes even when the client lies about type/name
    const webp = await base().webp().withExif(gpsExif).toBuffer();
    const w = await sanitizeUpload(webp, "image/jpeg", "not-really.jpg");
    assert.equal((await noMetadata(w.buffer)).format, "webp");
    assert.deepEqual([w.contentType, w.extension], ["image/webp", ".webp"]);

    // An image with no image claim at all (e.g. a chat attachment) is still stripped
    const unnamed = await sanitizeUpload(jpeg, "application/octet-stream", "file.bin");
    assert.equal(unnamed.sanitized, true);
    await noMetadata(unnamed.buffer);

    // Animated GIF keeps its frames. Hand-built two-frame 1x1 GIF89a: sharp 0.33 can't assemble one.
    const gifFrame = (lzw: number[]) => [
        0x21,
        0xf9,
        0x04,
        0x00,
        0x0a,
        0x00,
        0x00,
        0x00,
        0x2c,
        0,
        0,
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        0x02,
        0x02,
        ...lzw,
        0x00,
    ];
    const gif = Buffer.from([
        ...Buffer.from("GIF89a"),
        1,
        0,
        1,
        0,
        0x80,
        0,
        0,
        0,
        0,
        0,
        255,
        255,
        255,
        0x21,
        0xff,
        0x0b,
        ...Buffer.from("NETSCAPE2.0"),
        0x03,
        0x01,
        0x00,
        0x00,
        0x00,
        ...gifFrame([0x44, 0x01]),
        ...gifFrame([0x4c, 0x01]),
        0x3b,
    ]);
    assert.equal((await sharp(gif).metadata()).pages, 2, "control: input animated");
    const g = await sanitizeUpload(gif, "image/gif", "a.gif");
    assert.equal((await sharp(g.buffer).metadata()).pages, 2, "animation kept");

    // Fail closed: claims to be an image but isn't decodable / allowed
    await rejects(sanitizeUpload(Buffer.from("not an image"), "image/jpeg", "x.jpg"), "text named .jpg");
    await rejects(sanitizeUpload(Buffer.from("not an image"), "text/plain", "x.png"), "image extension only");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await rejects(sanitizeUpload(svg, "image/svg+xml", "x.svg"), "svg");
    await rejects(sanitizeUpload(svg, "application/octet-stream", "x.svg"), "svg by name");
    await rejects(sanitizeUpload(svg, "image/png", "x.png"), "svg claiming png");

    // Non-images pass through untouched
    const pdf = Buffer.from("%PDF-1.4\n%fake\n");
    const d = await sanitizeUpload(pdf, "application/pdf", "doc.pdf");
    assert.deepEqual([d.buffer, d.contentType, d.extension, d.sanitized], [pdf, "application/pdf", "", false]);

    console.log("sanitize-image tests passed");
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
