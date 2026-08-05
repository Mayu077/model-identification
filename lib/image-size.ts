/**
 * Minimal intrinsic-dimension reader for JPEG and PNG.
 *
 * The review UI needs the image's aspect ratio to size a row crop correctly, and
 * getting it wrong shifts every band. The browser does send the dimensions it
 * compressed to, but this is a public API route, so the value is verified here
 * rather than trusted — and this also covers the fallback path where the browser
 * failed to compress and uploaded the original file.
 *
 * Deliberately dependency-free: `sharp` is a native binary that would need to be
 * installed and bundled for the Vercel runtime, and all we need is two integers
 * out of the file header.
 */
export interface ImageSize {
  width: number
  height: number
}

function readPng(buffer: Buffer): ImageSize | null {
  // 8-byte signature, then a 25-byte IHDR chunk whose data starts at offset 16.
  if (buffer.length < 24) return null
  const signature = buffer.subarray(0, 8)
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function readJpeg(buffer: Buffer): ImageSize | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1 // resynchronise past padding rather than giving up
      continue
    }
    const marker = buffer[offset + 1]
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // end of header section
    const length = buffer.readUInt16BE(offset + 2)
    // Any SOF variant (baseline, progressive, ...) but not DHT/DAC/JPG-reserved.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

export function readImageSize(buffer: Buffer): ImageSize | null {
  const size = readJpeg(buffer) ?? readPng(buffer)
  if (!size) return null
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null
  if (size.width <= 0 || size.height <= 0) return null
  return size
}
