import { customType } from 'drizzle-orm/sqlite-core';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

/**
 * D1 refuses any string/BLOB/row over 2,000,000 bytes. Large inspection
 * templates can cross that line while still being perfectly reasonable
 * documents. Keep the SQL type as TEXT, but gzip large values transparently.
 *
 * The marker is deliberately outside JSON syntax so legacy/plain rows remain
 * byte-for-byte readable and compressed rows are unambiguous.
 */
const PREFIX = '~oi-gz1~';
const COMPRESS_AT_BYTES = 1_500_000;

function utf8Bytes(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

export function packLargeText(value: string): string {
    if (value.startsWith(PREFIX) || utf8Bytes(value) < COMPRESS_AT_BYTES) return value;
    return PREFIX + gzipSync(Buffer.from(value, 'utf8'), { level: 9 }).toString('base64');
}

export function unpackLargeText(value: string): string {
    if (!value.startsWith(PREFIX)) return value;
    const compressed = Buffer.from(value.slice(PREFIX.length), 'base64');
    return gunzipSync(compressed).toString('utf8');
}

/** Plain TEXT whose compression is invisible to callers. */
export const largeText = customType<{ data: string; driverData: string }>({
    dataType() { return 'text'; },
    toDriver(value) { return packLargeText(value); },
    fromDriver(value) { return unpackLargeText(value); },
});

/**
 * Drop-in replacement for text(..., { mode: 'json' }).
 * It intentionally JSON-stringifies strings too, matching Drizzle's json text
 * mode, because a few legacy writers already hand the column a JSON string.
 */
export const largeJson = customType<{ data: unknown; driverData: string }>({
    dataType() { return 'text'; },
    toDriver(value) { return packLargeText(JSON.stringify(value)); },
    fromDriver(value) { return JSON.parse(unpackLargeText(value)) as unknown; },
});
