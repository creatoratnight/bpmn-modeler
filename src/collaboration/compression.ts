import pako from 'pako';
import { encode, decode } from 'base64-arraybuffer';

// The collaboration document is BPMN XML, which compresses extremely well
// (~6-10x). Firebase bills bytes downloaded and does not compress payload values
// itself, so gzipping the document before it goes into the Realtime Database
// cuts the billed egress by roughly the same factor. base64 re-inflates the size
// by ~33% (RTDB stores strings, not binary), but XML gzip still nets a large win.

/** Gzip a string and base64-encode it for storage as an RTDB string value. */
export function compressToBase64(text: string): string {
    const bytes = pako.gzip(text);
    // Copy out an exact-length ArrayBuffer (gzip may return a view over a larger buffer).
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return encode(buffer);
}

/** Inverse of {@link compressToBase64}. */
export function decompressFromBase64(base64: string): string {
    const bytes = new Uint8Array(decode(base64));
    return pako.ungzip(bytes, { to: 'string' });
}
