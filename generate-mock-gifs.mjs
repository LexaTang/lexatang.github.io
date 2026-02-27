#!/usr/bin/env node

/**
 * generate-mock-gifs.mjs
 *
 * 生成 25x25 像素的黑白 GIF 动画，用于 WebKit decode="async" 线程泄露的复现。
 *
 * 每一帧是一个 25x25 的黑白阵列（每个像素要么黑要么白），理论上有 2^625 种状态。
 * 通过随机种子（seed）确定性地从中选取帧。
 *
 * 用法：
 *   node generate-mock-gifs.mjs [options]
 *
 * 选项：
 *   --seed <number>        随机种子 (默认: 42)
 *   --frames <number>      每张 GIF 的帧数 (默认: 8)
 *   --count <number>       生成 GIF 的数量 (默认: 500)
 *   --delay <number>       帧延迟，单位 10ms (默认: 10，即 100ms)
 *   --output <path>        输出目录 (默认: public/EmojiMockPacks)
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';

// ─── 参数解析 ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    seed:   { type: 'string', default: '42' },
    frames: { type: 'string', default: '8' },
    count:  { type: 'string', default: '500' },
    delay:  { type: 'string', default: '10' },
    output: { type: 'string', default: 'public/EmojiMockPacks' },
  },
});

const SEED         = parseInt(args.seed, 10);
const FRAMES       = parseInt(args.frames, 10);
const COUNT        = parseInt(args.count, 10);
const DELAY        = parseInt(args.delay, 10);
const OUTPUT_DIR   = path.resolve(args.output);
const WIDTH        = 25;
const HEIGHT       = 25;

console.log(`Config: seed=${SEED}, frames=${FRAMES}, count=${COUNT}, delay=${DELAY}*10ms`);
console.log(`Output: ${OUTPUT_DIR}`);

// ─── 确定性 PRNG (xoshiro128**) ─────────────────────────────────────────────

function splitmix32(a) {
  return function () {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

function xoshiro128ss(a, b, c, d) {
  return function () {
    const t = (b * 5) | 0;
    let r = (((t << 7) | (t >>> 25)) * 9) | 0;
    const u = (b << 9) | 0;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= u;
    d = (d << 11) | (d >>> 21);
    return (r >>> 0) / 4294967296;
  };
}

function createRng(seed) {
  const sm = splitmix32(seed);
  const s0 = (sm() * 4294967296) >>> 0;
  const s1 = (sm() * 4294967296) >>> 0;
  const s2 = (sm() * 4294967296) >>> 0;
  const s3 = (sm() * 4294967296) >>> 0;
  return xoshiro128ss(s0, s1, s2, s3);
}

// ─── 生成 25x25 黑白帧数据 ──────────────────────────────────────────────────

function generateFrame(rng) {
  // 返回 625 个 0/1 值的数组
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = rng() < 0.5 ? 0 : 1;
  }
  return pixels;
}

// ─── 手工构建 GIF89a 二进制 ──────────────────────────────────────────────────
// 无需任何外部依赖，纯手写 GIF 编码器
// 使用全局颜色表（黑白 2 色），LZW 最小码位 = 2

function buildGif(frames, delay) {
  const parts = [];

  // --- GIF Header ---
  parts.push(Buffer.from('GIF89a'));

  // --- Logical Screen Descriptor ---
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(WIDTH, 0);       // 宽
  lsd.writeUInt16LE(HEIGHT, 2);      // 高
  lsd.writeUInt8(0x80, 4);           // GCT flag=1, color res=1, sort=0, GCT size=0 (2^(0+1)=2 colors)
  lsd.writeUInt8(0, 5);              // 背景色索引
  lsd.writeUInt8(0, 6);              // 像素宽高比
  parts.push(lsd);

  // --- Global Color Table (2 colors: black, white) ---
  parts.push(Buffer.from([
    0x00, 0x00, 0x00,  // index 0: black
    0xFF, 0xFF, 0xFF,  // index 1: white
  ]));

  // --- Netscape Application Extension (for looping) ---
  parts.push(Buffer.from([
    0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, // NETSCAPE
    0x32, 0x2E, 0x30, // 2.0
    0x03, 0x01,
    0x00, 0x00,       // loop count = 0 (infinite)
    0x00,             // block terminator
  ]));

  for (const pixelData of frames) {
    // --- Graphic Control Extension ---
    const gce = Buffer.alloc(8);
    gce.writeUInt8(0x21, 0);          // extension introducer
    gce.writeUInt8(0xF9, 1);          // GCE label
    gce.writeUInt8(0x04, 2);          // block size
    gce.writeUInt8(0x00, 3);          // packed: disposal=0, no user input, no transparent
    gce.writeUInt16LE(delay, 4);      // delay time
    gce.writeUInt8(0x00, 6);          // transparent color index
    gce.writeUInt8(0x00, 7);          // block terminator
    parts.push(gce);

    // --- Image Descriptor ---
    const imgDesc = Buffer.alloc(10);
    imgDesc.writeUInt8(0x2C, 0);      // image separator
    imgDesc.writeUInt16LE(0, 1);      // left
    imgDesc.writeUInt16LE(0, 3);      // top
    imgDesc.writeUInt16LE(WIDTH, 5);  // width
    imgDesc.writeUInt16LE(HEIGHT, 7); // height
    imgDesc.writeUInt8(0x00, 9);      // packed: no LCT, not interlaced
    parts.push(imgDesc);

    // --- Image Data (LZW compressed) ---
    const lzwData = lzwEncode(pixelData, 2); // min code size = 2
    parts.push(lzwData);
  }

  // --- GIF Trailer ---
  parts.push(Buffer.from([0x3B]));

  return Buffer.concat(parts);
}

// ─── LZW 编码器 ─────────────────────────────────────────────────────────────

function lzwEncode(pixels, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const output = []; // 收集所有字节
  output.push(minCodeSize); // LZW minimum code size

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const maxCodeLimit = 4096;

  // 初始化字典
  let dict = new Map();
  function resetDict() {
    dict.clear();
    for (let i = 0; i < clearCode; i++) {
      dict.set(String(i), i);
    }
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  }

  // 位流写入器
  let bitBuffer = 0;
  let bitCount = 0;
  const codeBuffer = [];

  function writeCode(code) {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      codeBuffer.push(bitBuffer & 0xFF);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  function flushBits() {
    if (bitCount > 0) {
      codeBuffer.push(bitBuffer & 0xFF);
      bitBuffer = 0;
      bitCount = 0;
    }
  }

  // 开始编码
  resetDict();
  writeCode(clearCode);

  let current = String(pixels[0]);

  for (let i = 1; i < pixels.length; i++) {
    const next = current + ',' + pixels[i];
    if (dict.has(next)) {
      current = next;
    } else {
      writeCode(dict.get(current));
      if (nextCode < maxCodeLimit) {
        dict.set(next, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        // 字典满了，发 clear code 重置
        writeCode(clearCode);
        resetDict();
      }
      current = String(pixels[i]);
    }
  }

  writeCode(dict.get(current));
  writeCode(eoiCode);
  flushBits();

  // 分成 sub-blocks (最大 255 字节)
  const subBlocks = [];
  for (let i = 0; i < codeBuffer.length; i += 255) {
    const chunk = codeBuffer.slice(i, i + 255);
    subBlocks.push(chunk.length); // sub-block size
    subBlocks.push(...chunk);
  }
  subBlocks.push(0); // block terminator

  return Buffer.from([output[0], ...subBlocks]);
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

const rng = createRng(SEED);

// 创建输出目录
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const startTime = Date.now();

for (let i = 0; i < COUNT; i++) {
  const id = String(i + 1).padStart(5, '0'); // 00001, 00002, ...
  const dir = path.join(OUTPUT_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  // 生成帧
  const frameData = [];
  for (let f = 0; f < FRAMES; f++) {
    frameData.push(generateFrame(rng));
  }

  // 构建 GIF
  const gifBuffer = buildGif(frameData, DELAY);
  const gifPath = path.join(dir, `${id}.gif`);
  fs.writeFileSync(gifPath, gifBuffer);

  if ((i + 1) % 100 === 0 || i === 0 || i === COUNT - 1) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  [${elapsed}s] Generated ${i + 1}/${COUNT}: ${gifPath} (${gifBuffer.length} bytes)`);
  }
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nDone! Generated ${COUNT} GIF files in ${totalTime}s`);
console.log(`Output directory: ${OUTPUT_DIR}`);
