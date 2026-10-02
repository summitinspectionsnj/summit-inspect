import { describe, expect, it } from 'vitest';
import { threeDAdapter } from '../../../server/lib/migration-intake/adapters/three-d';

const HT4 = `<?xml version="1.0" encoding="UTF-8"?>
<template version="3">
  <st><stKey>SmartText1</stKey><stVal>Asphalt</stVal><stVal>Concrete</stVal></st>
  <com id="C-1"><comName>MATERIAL:</comName><comText>The driveway was [___]. *SmartText1*</comText></com>
  <ii id="II-1"><iiText>Driveway</iiText><iiCID>C-1</iiCID></ii>
  <sec name="GROUNDS"><secIIID>II-1</secIIID></sec>
</template>`;

describe('3D HT4 adapter', () => {
    it('recognises an HT4 template and preserves its structure and SmartText choices', async () => {
        const inspected = await threeDAdapter.inspect?.(HT4);
        expect(inspected).toMatchObject({ kind: 'template', sections: 1, items: 1 });

        const result = await threeDAdapter.convert(HT4, { name: 'Summit 3D' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const template = result.bundle.templates[0]!;
        expect(template.name).toBe('Summit 3D');
        expect(template.schema.sections[0]?.title).toBe('GROUNDS');
        expect(template.schema.sections[0]?.items[0]?.label).toBe('Driveway');
        expect(template.schema.sections[0]?.items[0]?.tabs?.information[0]?.comment)
            .toContain('[3D choices: Asphalt | Concrete]');
        expect(result.bundle.manifest.source.vendor).toBe('three_d');
    });

    it('refuses unrelated XML', async () => {
        expect(await threeDAdapter.inspect?.('<root/>')).toBeNull();
        expect((await threeDAdapter.convert('<root/>', { name: 'Nope' })).ok).toBe(false);
    });
});
