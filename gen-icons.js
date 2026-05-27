// PNG 아이콘 생성 스크립트 (외부 라이브러리 없이)
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function makePNG(size, bgR, bgG, bgB, text) {
  const W = size, H = size;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter type
    for (let x = 0; x < W; x++) {
      const i = y * (W * 4 + 1) + 1 + x * 4;
      // 둥근 배경
      const cx = x - W / 2, cy = y - H / 2;
      const r = Math.sqrt(cx * cx + cy * cy);
      const radius = W * 0.42;
      if (r < radius) {
        raw[i] = bgR; raw[i+1] = bgG; raw[i+2] = bgB; raw[i+3] = 255;
      } else {
        raw[i] = bgR; raw[i+1] = bgG; raw[i+2] = bgB; raw[i+3] = 255;
      }
    }
  }

  // 간단한 "₩" 픽셀 글자 (size/4 위치에 흰색 픽셀 블록)
  const mid = Math.floor(W / 2);
  const s = Math.floor(W / 8);
  for (let dy = -s*2; dy <= s*2; dy++) {
    for (let dx = -s*2; dx <= s*2; dx++) {
      const x = mid + dx, y = Math.floor(H / 2) + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * (W * 4 + 1) + 1 + x * 4;
      raw[i] = 255; raw[i+1] = 255; raw[i+2] = 255; raw[i+3] = 255;
    }
  }

  const deflated = zlib.deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type);
    const crcBuf = Buffer.concat([t, data]);
    const crc = crc32(crcBuf);
    const crcOut = Buffer.alloc(4); crcOut.writeInt32BE(crc | 0, 0);
    return Buffer.concat([len, t, data, crcOut]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let crc = -1;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let i = 0; i < 8; i++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ -1) >>> 0;
}

const dir = path.join(__dirname, 'public');
fs.writeFileSync(path.join(dir, 'icon-192.png'),  makePNG(192, 15, 23, 42));
fs.writeFileSync(path.join(dir, 'icon-512.png'),  makePNG(512, 15, 23, 42));
fs.writeFileSync(path.join(dir, 'icon-apple.png'), makePNG(180, 15, 23, 42));
console.log('✅ 아이콘 생성 완료');
