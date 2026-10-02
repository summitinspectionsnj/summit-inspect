import { describe, expect, it } from 'vitest';
import { packLargeText, unpackLargeText } from '../../../server/lib/db/large-value';

describe('large D1 values', () => {
    it('leaves ordinary values readable as plain text', () => {
        const value = '{"small":true}';
        expect(packLargeText(value)).toBe(value);
        expect(unpackLargeText(value)).toBe(value);
    });

    it('compresses a template-sized value below D1 row limits and round-trips it', () => {
        // Deliberately repetitive like an inspection template: canned narrative
        // and choice vocabularies compress extremely well.
        const value = JSON.stringify({
            sections: Array.from({ length: 300 }, (_, i) => ({
                id: 'item_' + i,
                comments: Array.from({ length: 40 }, (_, j) =>
                    'Exterior component narrative ' + j + ': observed condition and recommendation. '.repeat(3)),
            })),
        });
        // Ensure the fixture actually exercises the >1.5 MB path.
        const oversized = value.repeat(Math.ceil(2_200_000 / value.length));
        expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(2_000_000);

        const packed = packLargeText(oversized);
        expect(packed.startsWith('~oi-gz1~')).toBe(true);
        expect(new TextEncoder().encode(packed).byteLength).toBeLessThan(2_000_000);
        expect(unpackLargeText(packed)).toBe(oversized);
    });
});
