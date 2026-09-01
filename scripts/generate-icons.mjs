// One-off script to generate simple solid-color placeholder PNG icons
// (theme navy background) so the PWA manifest has valid icons to start with.
// Replace public/icons/icon-192.png and icon-512.png with real branding later.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(size, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // simple raw scanlines: filter byte 0 + RGB pixels, with a lighter rounded
  // "car" glyph roughly centered as a couple of rectangles for visual interest
  const raw = Buffer.alloc((1 + size * 3) * size);
  const accent = [56, 189, 248]; // sky blue accent stripe
  const carTop = Math.floor(size * 0.42);
  const carBottom = Math.floor(size * 0.6);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter type none
    const inCarBand = y >= carTop && y <= carBottom;
    for (let x = 0; x < size; x++) {
      const inCarWidth = x >= size * 0.2 && x <= size * 0.8;
      const px = rowStart + 1 + x * 3;
      if (inCarBand && inCarWidth) {
        raw[px] = accent[0];
        raw[px + 1] = accent[1];
        raw[px + 2] = accent[2];
      } else {
        raw[px] = r;
        raw[px + 1] = g;
        raw[px + 2] = b;
      }
    }
  }

  const idat = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL("../public/icons", import.meta.url), { recursive: true });
const navy = [15, 23, 42];
writeFileSync(new URL("../public/icons/icon-192.png", import.meta.url), makePng(192, navy));
writeFileSync(new URL("../public/icons/icon-512.png", import.meta.url), makePng(512, navy));
console.log("generated icon-192.png and icon-512.png");
