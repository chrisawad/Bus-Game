import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type), payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const n of payload) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const color = hex => hex.match(/\w\w/g).map(x => parseInt(x, 16));
  const rect = (x, y, w, h, r, hex) => {
    const c = color(hex);
    for (let py = Math.floor(y * size); py < (y + h) * size; py++) {
      for (let px = Math.floor(x * size); px < (x + w) * size; px++) {
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const dx = Math.max(x * size + r * size - px, 0, px - (x + w - r) * size);
        const dy = Math.max(y * size + r * size - py, 0, py - (y + h - r) * size);
        if (dx * dx + dy * dy > r * r * size * size) continue;
        const index = (py * size + px) * 4;
        pixels[index] = c[0]; pixels[index + 1] = c[1]; pixels[index + 2] = c[2]; pixels[index + 3] = 255;
      }
    }
  };
  rect(0, 0, 1, 1, 0, 'e4edd9');
  rect(.27, .72, .1, .12, .035, '355440'); rect(.63, .72, .1, .12, .035, '355440');
  rect(.235, .18, .53, .6, .11, '5c8c68');
  rect(.285, .255, .43, .235, .04, 'f8f5df'); rect(.485, .25, .025, .25, 0, '5c8c68');
  rect(.29, .585, .09, .06, .025, 'f2cc70'); rect(.62, .585, .09, .06, .025, 'f2cc70');
  rect(.4, .65, .2, .045, .012, 'e4edd9');
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    rect(.75 + Math.cos(a) * .065 - .04, .235 + Math.sin(a) * .065 - .04, .08, .08, .04, 'edbf61');
  }
  rect(.72, .205, .06, .06, .03, 'fff3c9');
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir('public/icons', { recursive: true });
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['maskable-512', 512], ['apple-touch-icon', 180]]) {
  await writeFile('public/icons/' + name + '.png', render(size));
}
console.log('Generated four offline PWA icons.');
