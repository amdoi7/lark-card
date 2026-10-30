import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CardError } from '../errors.ts';

type AsarEntry = {
  files?: Record<string, AsarEntry>;
  link?: string;
  unpacked?: boolean;
  offset: string;
  size: number;
  integrity?: { algorithm: string; hash: string };
};

export class Asar {
  private readonly data: Buffer;
  private readonly base: number;
  readonly files: Map<string, AsarEntry>;

  constructor(filename: string) {
    this.data = readFileSync(filename);
    if (this.data.length < 16) throw new CardError('client_unavailable', `asar_header_invalid file=${filename}`);
    const headerSize = this.data.readUInt32LE(12);
    this.base = 8 + this.data.readUInt32LE(4);
    if (this.data.readUInt32LE(0) !== 4 || headerSize > this.base - 16 || this.base > this.data.length) {
      throw new CardError('client_unavailable', `asar_header_invalid file=${filename}`);
    }
    const header = JSON.parse(this.data.subarray(16, 16 + headerSize).toString());
    this.files = new Map();
    const visit = (node: AsarEntry, prefix = '') => {
      for (const [name, entry] of Object.entries(node.files!)) {
        const path = prefix + name;
        if (entry.files) visit(entry, path + '/');
        else if (!entry.link && !entry.unpacked) this.files.set(path, entry);
      }
    };
    visit(header);
  }

  read(path: string): Buffer | undefined {
    const entry = this.files.get(path);
    if (!entry) return undefined;
    const offset = Number(entry.offset), size = entry.size;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || this.base + offset + size > this.data.length) {
      throw new CardError('client_unavailable', `asar_entry_invalid path=${path}`);
    }
    const bytes = this.data.subarray(this.base + offset, this.base + offset + size);
    const integrity = entry.integrity;
    if (integrity?.algorithm === 'SHA256' && createHash('sha256').update(bytes).digest('hex') !== integrity.hash) {
      throw new CardError('client_unavailable', `asar_integrity_mismatch path=${path}`);
    }
    return bytes;
  }
}
