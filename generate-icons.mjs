// Gera ícones provisórios (assets/icon-512/192/180.png) sem dependências externas.
// Desenho: fundo escuro + quadrado âmbar arredondado com uma nota musical no centro.
// Troque depois por ícones definitivos se quiser — basta substituir os PNGs.
//   node generate-icons.mjs
import { writeFileSync, mkdirSync } from "fs";
import zlib from "zlib";

const crcTable = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = [20, 17, 13], aLight = [240, 168, 51], aDeep = [196, 134, 31], dark = [26, 20, 10];
  const margin = size * 0.07, radius = size * 0.22;
  const x0 = margin, y0 = margin, x1 = size - margin, y1 = size - margin;
  const cx = size * 0.5, cy = size * 0.5;
  const stemW = size * 0.055, stemX = cx + size * 0.085, stemTop = cy - size * 0.24, stemBot = cy + size * 0.16;
  const headRx = size * 0.135, headRy = size * 0.10, headCx = cx - size * 0.01, headCy = cy + size * 0.15;
  const inRoundRect = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const rx = Math.max(x0 + radius - x, x - (x1 - radius), 0);
    const ry = Math.max(y0 + radius - y, y - (y1 - radius), 0);
    return rx * rx + ry * ry <= radius * radius;
  };
  const inNote = (x, y) => {
    if (x >= stemX && x <= stemX + stemW && y >= stemTop && y <= stemBot) return true;
    const dx = (x - headCx) / headRx, dy = (y - headCy) / headRy;
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    let col = bg;
    if (inRoundRect(x + 0.5, y + 0.5)) {
      const t = (x + y) / (2 * size);
      col = [Math.round(lerp(aLight[0], aDeep[0], t)), Math.round(lerp(aLight[1], aDeep[1], t)), Math.round(lerp(aLight[2], aDeep[2], t))];
      if (inNote(x + 0.5, y + 0.5)) col = dark;
    }
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
  }
  return buf;
}

mkdirSync(new URL("./assets/", import.meta.url), { recursive: true });
for (const s of [512, 192, 180]) {
  writeFileSync(new URL(`./assets/icon-${s}.png`, import.meta.url), png(s, draw(s)));
  console.log(`gerado assets/icon-${s}.png`);
}
