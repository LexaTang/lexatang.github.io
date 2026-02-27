/**
 * 浏览器版 GIF 解码器
 * 从 gif-decoder.mjs 移植，去掉 Node.js 依赖
 * 解析 GIF89a/GIF87a 格式，提取每帧的 RGBA 像素数据和帧元信息
 */

export interface DecodedFrame {
  pixels: Uint8Array; // RGBA 像素数据
  width: number;
  height: number;
  delay: number; // 1/100秒
}

export interface GifInfo {
  width: number;
  height: number;
  loopCount: number;
  frames: DecodedFrame[];
}

interface RawFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  colorTable: number[][];
  indices: Uint8Array;
  interlaced: number;
  disposalMethod: number;
  delayTime: number;
  transparentColorIndex: number;
}

function buildInterlaceMap(height: number): number[] {
  const map = new Array(height);
  const passes = [
    { start: 0, step: 8 },
    { start: 4, step: 8 },
    { start: 2, step: 4 },
    { start: 1, step: 2 },
  ];
  let idx = 0;
  for (const { start, step } of passes) {
    for (let y = start; y < height; y += step) {
      map[idx++] = y;
    }
  }
  return map;
}

export function decodeGif(buffer: ArrayBuffer): GifInfo {
  const data = new Uint8Array(buffer);
  let pos = 0;
  let globalColorTable: number[][] | null = null;
  const frames: RawFrame[] = [];

  // --- 基础读取 ---
  function readByte() {
    return data[pos++];
  }

  function readUint16() {
    const val = data[pos] | (data[pos + 1] << 8);
    pos += 2;
    return val;
  }

  function readBytes(n: number) {
    const bytes = data.slice(pos, pos + n);
    pos += n;
    return bytes;
  }

  function readSubBlocks() {
    const blocks: Uint8Array[] = [];
    let size: number;
    while ((size = readByte()) !== 0) {
      blocks.push(readBytes(size));
    }
    const totalLen = blocks.reduce((s, b) => s + b.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const block of blocks) {
      result.set(block, offset);
      offset += block.length;
    }
    return result;
  }

  function readColorTable(count: number) {
    const table = new Array(count);
    for (let i = 0; i < count; i++) {
      table[i] = [data[pos++], data[pos++], data[pos++]];
    }
    return table;
  }

  // --- LZW 解码 ---
  function decodeLZW(minCodeSize: number, compressedData: Uint8Array) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let codeMask = (1 << codeSize) - 1;
    let nextCode = eoiCode + 1;

    const MAX_CODE_SIZE = 12;
    const tableSize = 1 << MAX_CODE_SIZE;
    const pfx = new Int32Array(tableSize);
    const sfx = new Uint8Array(tableSize);
    const len = new Uint16Array(tableSize);

    function initTable() {
      for (let i = 0; i < clearCode; i++) {
        pfx[i] = -1;
        sfx[i] = i;
        len[i] = 1;
      }
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      codeMask = (1 << codeSize) - 1;
    }

    initTable();

    let bitPos = 0;
    const totalBits = compressedData.length * 8;

    function readCode() {
      if (bitPos + codeSize > totalBits) return eoiCode;
      const bytePos = bitPos >> 3;
      let val = compressedData[bytePos];
      if (bytePos + 1 < compressedData.length) val |= compressedData[bytePos + 1] << 8;
      if (bytePos + 2 < compressedData.length) val |= compressedData[bytePos + 2] << 16;
      val = (val >> (bitPos & 7)) & codeMask;
      bitPos += codeSize;
      return val;
    }

    function outputCode(code: number, output: Uint8Array, outPos: number) {
      const l = len[code];
      let p = outPos + l - 1;
      let c = code;
      while (c >= 0 && p >= outPos) {
        output[p--] = sfx[c];
        c = pfx[c];
      }
      return l;
    }

    const output: number[] = [];
    let prevCode = -1;

    while (true) {
      const code = readCode();

      if (code === clearCode) {
        initTable();
        prevCode = -1;
        continue;
      }

      if (code === eoiCode) break;

      if (prevCode === -1) {
        output.push(sfx[code]);
        prevCode = code;
        continue;
      }

      if (code < nextCode) {
        const tempBuf = new Uint8Array(len[code]);
        outputCode(code, tempBuf, 0);
        for (let i = 0; i < tempBuf.length; i++) output.push(tempBuf[i]);

        if (nextCode < tableSize) {
          pfx[nextCode] = prevCode;
          let firstChar = code;
          while (pfx[firstChar] >= 0) firstChar = pfx[firstChar];
          sfx[nextCode] = sfx[firstChar];
          len[nextCode] = len[prevCode] + 1;
          nextCode++;
        }
      } else {
        let firstChar = prevCode;
        while (pfx[firstChar] >= 0) firstChar = pfx[firstChar];
        const fc = sfx[firstChar];

        if (nextCode < tableSize) {
          pfx[nextCode] = prevCode;
          sfx[nextCode] = fc;
          len[nextCode] = len[prevCode] + 1;
          nextCode++;
        }

        const tempBuf = new Uint8Array(len[prevCode] + 1);
        outputCode(prevCode, tempBuf, 0);
        tempBuf[len[prevCode]] = fc;
        for (let i = 0; i < tempBuf.length; i++) output.push(tempBuf[i]);
      }

      if (nextCode > codeMask && codeSize < MAX_CODE_SIZE) {
        codeSize++;
        codeMask = (1 << codeSize) - 1;
      }

      prevCode = code;
    }

    return new Uint8Array(output);
  }

  // --- 主解析流程 ---
  const sig = String.fromCharCode(...readBytes(3));
  const ver = String.fromCharCode(...readBytes(3));
  if (sig !== 'GIF' || (ver !== '89a' && ver !== '87a')) {
    throw new Error(`不是有效的 GIF 文件: ${sig}${ver}`);
  }

  const gifWidth = readUint16();
  const gifHeight = readUint16();
  const packed = readByte();
  const bgColorIndex = readByte();
  readByte(); // pixel aspect ratio

  const hasGCT = (packed >> 7) & 1;
  const gctSize = 1 << ((packed & 0x07) + 1);

  if (hasGCT) {
    globalColorTable = readColorTable(gctSize);
  }

  let disposalMethod = 0;
  let delayTime = 0;
  let transparentColorIndex = -1;
  let hasTransparency = false;
  let loopCount = 0;

  while (pos < data.length) {
    const introducer = readByte();

    if (introducer === 0x3b) break;

    if (introducer === 0x21) {
      const label = readByte();

      if (label === 0xf9) {
        readByte(); // block size (always 4)
        const gcPacked = readByte();
        delayTime = readUint16();
        transparentColorIndex = readByte();
        readByte(); // terminator

        disposalMethod = (gcPacked >> 2) & 0x07;
        hasTransparency = (gcPacked & 0x01) === 1;
        if (!hasTransparency) transparentColorIndex = -1;
      } else if (label === 0xff) {
        const appBlockSize = readByte();
        const appId = String.fromCharCode(...readBytes(appBlockSize));

        if (appId === 'NETSCAPE2.0') {
          const subBlockSize = readByte();
          if (subBlockSize === 3) {
            readByte();
            loopCount = readUint16();
            readByte();
          } else {
            pos += subBlockSize;
            readSubBlocks();
          }
        } else {
          readSubBlocks();
        }
      } else {
        readSubBlocks();
      }

      continue;
    }

    if (introducer === 0x2c) {
      const left = readUint16();
      const top = readUint16();
      const frameWidth = readUint16();
      const frameHeight = readUint16();
      const imgPacked = readByte();

      const hasLocalCT = (imgPacked >> 7) & 1;
      const interlaced = (imgPacked >> 6) & 1;
      const localCTSize = 1 << ((imgPacked & 0x07) + 1);

      let localColorTable: number[][] | null = null;
      if (hasLocalCT) {
        localColorTable = readColorTable(localCTSize);
      }

      const lzwMinCodeSize = readByte();
      const compressedData = readSubBlocks();
      const indices = decodeLZW(lzwMinCodeSize, compressedData);
      const colorTable = localColorTable || globalColorTable;

      frames.push({
        left,
        top,
        width: frameWidth,
        height: frameHeight,
        colorTable: colorTable!,
        indices,
        interlaced,
        disposalMethod,
        delayTime,
        transparentColorIndex,
      });

      disposalMethod = 0;
      delayTime = 0;
      transparentColorIndex = -1;
      hasTransparency = false;

      continue;
    }
  }

  // --- 渲染帧（coalesce） ---
  const canvas = new Uint8Array(gifWidth * gifHeight * 4);
  let previousCanvas: Uint8Array | null = null;
  const renderedFrames: DecodedFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    if (frame.disposalMethod === 3) {
      previousCanvas = new Uint8Array(canvas);
    }

    const deinterlaceMap = frame.interlaced ? buildInterlaceMap(frame.height) : null;

    for (let y = 0; y < frame.height; y++) {
      const srcY = deinterlaceMap ? deinterlaceMap[y] : y;
      for (let x = 0; x < frame.width; x++) {
        const srcIdx = srcY * frame.width + x;
        const colorIdx = frame.indices[srcIdx];

        if (colorIdx === frame.transparentColorIndex) continue;

        const dstX = frame.left + x;
        const dstY = frame.top + y;
        if (dstX >= gifWidth || dstY >= gifHeight) continue;

        const dstIdx = (dstY * gifWidth + dstX) * 4;
        const [r, g, b] = frame.colorTable[colorIdx];
        canvas[dstIdx] = r;
        canvas[dstIdx + 1] = g;
        canvas[dstIdx + 2] = b;
        canvas[dstIdx + 3] = 255;
      }
    }

    renderedFrames.push({
      pixels: new Uint8Array(canvas),
      width: gifWidth,
      height: gifHeight,
      delay: frame.delayTime === 0 ? 10 : frame.delayTime,
    });

    switch (frame.disposalMethod) {
      case 0:
      case 1:
        break;
      case 2:
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < frame.width; x++) {
            const dstX = frame.left + x;
            const dstY = frame.top + y;
            if (dstX >= gifWidth || dstY >= gifHeight) continue;
            const idx = (dstY * gifWidth + dstX) * 4;
            canvas[idx] = 0;
            canvas[idx + 1] = 0;
            canvas[idx + 2] = 0;
            canvas[idx + 3] = 0;
          }
        }
        break;
      case 3:
        if (previousCanvas) {
          canvas.set(previousCanvas);
        }
        break;
    }
  }

  return {
    width: gifWidth,
    height: gifHeight,
    loopCount,
    frames: renderedFrames,
  };
}
