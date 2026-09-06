// Rasterises public/icons/logo.svg into PNGs without any image dependency.
// The mark is analytic (two circles, a lens, two gradients), so it can be
// evaluated per-pixel directly; the browser's canvas.toDataURL produced a
// 266KB file for the same 512px image, which is not something to ship in a
// service-worker-cached shell.
import fs from "node:fs";
import zlib from "node:zlib";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mixHex = (c0, c1, t) => [0, 1, 2].map((i) => lerp(c0[i], c1[i], t));

// SVG userSpace geometry, in the 512 viewBox the logo is authored in.
const VB = 512;
const GROUND_TOP = hex("#16233c");
const GROUND_BOT = hex("#0a0f1c");
const GLOW = hex("#38bdf8");
const A = { cx: 204, cy: 256, r: 104, from: hex("#a5e8ff"), to: hex("#38bdf8"), v: [0.1, 0, 0.9, 1] };
const B = { cx: 308, cy: 256, r: 104, from: hex("#22d3ee"), to: hex("#0c6d8a"), v: [0.9, 0, 0.1, 1] };
const LENS = hex("#ffffff");
const LENS_ALPHA = 0.96;

// An SVG objectBoundingBox gradient: the vector is expressed as fractions of
// the shape's bounding box, so it has to be mapped back into user space
// before a point can be projected onto it.
function discColor(px, py, d) {
  const bx = d.cx - d.r,
    by = d.cy - d.r,
    s = d.r * 2;
  const gx1 = bx + d.v[0] * s,
    gy1 = by + d.v[1] * s;
  const gx2 = bx + d.v[2] * s,
    gy2 = by + d.v[3] * s;
  const dx = gx2 - gx1,
    dy = gy2 - gy1;
  const t = clamp01(((px - gx1) * dx + (py - gy1) * dy) / (dx * dx + dy * dy));
  return mixHex(d.from, d.to, t);
}

function sample(px, py) {
  // ground
  let col = mixHex(GROUND_TOP, GROUND_BOT, clamp01(py / VB));

  // radial glow, composited over the ground
  const gcx = 0.5 * VB,
    gcy = 0.34 * VB,
    gr = 0.66 * VB;
  const gt = clamp01(Math.hypot(px - gcx, py - gcy) / gr);
  const ga = 0.24 * (1 - gt);
  col = [0, 1, 2].map((i) => lerp(col[i], GLOW[i], ga));

  const inA = Math.hypot(px - A.cx, py - A.cy) <= A.r;
  const inB = Math.hypot(px - B.cx, py - B.cy) <= B.r;

  if (inA) col = discColor(px, py, A);
  if (inB) col = discColor(px, py, B); // painted after A, as in the SVG
  if (inA && inB) col = [0, 1, 2].map((i) => lerp(col[i], LENS[i], LENS_ALPHA));

  return col;
}

// 4x4 supersampling: the circle edges are the whole mark, and at 192px an
// aliased edge is the difference between "designed" and "exported wrong".
const SS = 4;
function renderRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = VB / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) * scale;
          const py = (y + (sy + 0.5) / SS) * scale;
          const c = sample(px, py);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      buf[o] = Math.round(r / n);
      buf[o + 1] = Math.round(g / n);
      buf[o + 2] = Math.round(b / n);
      buf[o + 3] = 255; // the icon is deliberately opaque: a maskable icon
                        // with transparency shows the launcher through it
    }
  }
  return buf;
}

// --- minimal PNG writer (RGBA, 8-bit, no interlace) ---
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Filter type 1 (Sub) predicts each pixel from its left neighbour, which is
// what smooth horizontal gradients want; it takes the 512 icon from 266KB to
// a few KB.
function filtered(rgba, size) {
  const stride = size * 4;
  const out = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const ro = y * stride;
    const wo = y * (stride + 1);
    out[wo] = 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[ro + x - 4] : 0;
      out[wo + 1 + x] = (rgba[ro + x] - left) & 0xff;
    }
  }
  return out;
}

function png(size) {
  const rgba = renderRGBA(size);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(filtered(rgba, size), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Icon URLs are versioned by directory. Chrome caches an installed PWA's
// launcher icon against its URL, so replacing the bytes at the same path
// leaves every phone that already added the app showing the old art — the
// manifest is re-read, but an unchanged icon URL is never re-fetched. Bump
// this when the mark changes rather than overwriting an existing version.
const VERSION = "v2";

fs.mkdirSync(`public/icons/${VERSION}`, { recursive: true });
for (const size of [192, 512]) {
  const out = png(size);
  fs.writeFileSync(`public/icons/${VERSION}/icon-${size}.png`, out);
  console.log(`icons/${VERSION}/icon-${size}.png  ${(out.length / 1024).toFixed(1)} KB`);
}
