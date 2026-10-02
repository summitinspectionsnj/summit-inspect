import type {
    TemplateSchemaV2, TemplateSection, TemplateItem, CannedInfoComment,
} from '../../../types/template-schema';
import { DEFAULT_IMPORTED_RATING_OPTIONS, type ConvertStats } from '../bundle';
import type { AdapterInspection, BundleResult, MigrationAdapter } from './types';
import { emptyEntityCounts } from './types';

const ADAPTER_VERSION = '1';

function decodeXml(value: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    let out = value;
    for (let pass = 0; pass < 3; pass++) {
        const next = out
            .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
            .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
            .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
        if (next === out) break;
        out = next;
    }
    return out;
}

function plain(value: string): string {
    return decodeXml(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<\/?p[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function elements(xml: string, tag: string): string[] {
    const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
    return [...xml.matchAll(re)].map((m) => m[0]!);
}

function body(element: string, tag: string): string | null {
    const m = element.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
    return m ? m[1]! : null;
}

function attr(element: string, name: string): string | null {
    const m = element.match(new RegExp('\\s' + name + '="([^"]*)"', 'i'));
    return m ? decodeXml(m[1]!) : null;
}

function allBodies(element: string, tag: string): string[] {
    return elements(element, tag).map((e) => plain(body(e, tag) ?? ''));
}

interface ParsedHt4 {
    sections: { name: string; itemIds: string[] }[];
    items: Map<string, { label: string; commentIds: string[] }>;
    comments: Map<string, { name: string; text: string }>;
    smartText: Map<string, string[]>;
}

function parseHt4(input: unknown): ParsedHt4 | null {
    if (typeof input !== 'string') return null;
    const xml = input.trim();
    if (!/^<\?xml[\s\S]*?<template\b/i.test(xml) && !/^<template\b/i.test(xml)) return null;

    const itemEls = elements(xml, 'ii');
    const sectionEls = elements(xml, 'sec');
    const commentEls = elements(xml, 'com');
    if (itemEls.length === 0 || sectionEls.length === 0 || commentEls.length === 0) return null;

    const items = new Map<string, { label: string; commentIds: string[] }>();
    for (const el of itemEls) {
        const id = attr(el, 'id');
        const label = plain(body(el, 'iiText') ?? '');
        if (id && label) items.set(id, { label, commentIds: allBodies(el, 'iiCID') });
    }

    const comments = new Map<string, { name: string; text: string }>();
    for (const el of commentEls) {
        const id = attr(el, 'id');
        if (!id) continue;
        comments.set(id, { name: plain(body(el, 'comName') ?? ''), text: plain(body(el, 'comText') ?? '') });
    }

    const smartText = new Map<string, string[]>();
    for (const el of elements(xml, 'st')) {
        const key = plain(body(el, 'stKey') ?? '');
        if (key) smartText.set(key, allBodies(el, 'stVal').filter(Boolean));
    }

    const sections = sectionEls.map((el) => ({
        name: plain(attr(el, 'name') ?? ''),
        itemIds: allBodies(el, 'secIIID'),
    })).filter((s) => s.name);

    return { sections, items, comments, smartText };
}

function preserveSmartText(text: string, smartText: Map<string, string[]>): string {
    let used = false;
    const replaced = text.replace(/\*SmartText(\d+)\*/g, (_whole, number: string) => {
        const values = smartText.get('SmartText' + number) ?? [];
        if (values.length === 0) return '';
        used = true;
        return '[3D choices: ' + values.join(' | ') + ']';
    });
    return used ? replaced.replace(/\[___\]/g, '').replace(/\s{2,}/g, ' ').trim() : replaced;
}

function build(parsed: ParsedHt4): { template: TemplateSchemaV2; stats: ConvertStats; smartTextComments: number } {
    const stats: ConvertStats = {
        sections: 0, items: 0, information: 0, limitations: 0, defects: 0, unknownCommentTypes: [],
    };
    let smartTextComments = 0;
    let commentIndex = 0;
    const sections: TemplateSection[] = [];

    for (const sourceSection of parsed.sections) {
        const section: TemplateSection = {
            id: 'sec_' + (++stats.sections),
            title: sourceSection.name.slice(0, 50),
            items: [],
        };
        for (const itemId of sourceSection.itemIds) {
            const sourceItem = parsed.items.get(itemId);
            if (!sourceItem) continue;
            const information: CannedInfoComment[] = [];
            for (const commentId of sourceItem.commentIds) {
                const sourceComment = parsed.comments.get(commentId);
                if (!sourceComment) continue;
                if (/\*SmartText\d+\*/.test(sourceComment.text)) smartTextComments++;
                information.push({
                    id: 'ri_' + (++commentIndex),
                    title: sourceComment.name || 'Comment',
                    comment: preserveSmartText(sourceComment.text, parsed.smartText),
                    default: false,
                });
                stats.information++;
            }
            const item: TemplateItem = {
                id: 'item_' + (++stats.items),
                label: sourceItem.label.slice(0, 100),
                type: 'rich',
                ratingOptions: [...DEFAULT_IMPORTED_RATING_OPTIONS],
                tabs: { information, limitations: [], defects: [] },
                source: { platform: '3d_inspection_system', externalId: itemId },
            };
            section.items.push(item);
        }
        sections.push(section);
    }
    return { template: { schemaVersion: 2, sections }, stats, smartTextComments };
}

export interface ThreeDAdapterOptions { name: string }

export const threeDAdapter: MigrationAdapter<ThreeDAdapterOptions> = {
    name: 'three-d-ht4',
    version: ADAPTER_VERSION,
    vendor: 'three_d',
    inspect(input: unknown): AdapterInspection | null {
        const parsed = parseHt4(input);
        if (!parsed) return null;
        return {
            kind: 'template',
            name: null,
            sections: parsed.sections.length,
            items: parsed.sections.reduce((n, s) => n + s.itemIds.filter((id) => parsed.items.has(id)).length, 0),
            ratings: [],
            ratingsDescribe: 'comments',
            ratingsShown: null,
        };
    },
    convert(input: unknown, options: ThreeDAdapterOptions): BundleResult {
        const parsed = parseHt4(input);
        if (!parsed) {
            return { ok: false, error: { code: 'NOT_3D_HT4', message: 'This file is not a readable 3D Inspection System .ht4 template.' } };
        }
        const { template, stats, smartTextComments } = build(parsed);
        const warnings = [{
            code: '3D_COMMENT_TAB_NOT_EXPLICIT',
            message: 'The HT4 file does not identify OpenInspection Information, Limitation, or Defect tabs. Its canned comments were preserved under Information so none are silently reclassified.',
        }];
        if (smartTextComments > 0) {
            warnings.push({
                code: '3D_SMARTTEXT_PRESERVED',
                message: smartTextComments + ' canned comments use 3D SmartText. Their source choices were preserved in the comment text while native selectable SmartText support is being added.',
            });
        }
        return {
            ok: true,
            bundle: {
                formatVersion: 1,
                manifest: {
                    source: { vendor: 'three_d' },
                    adapter: { name: 'three-d-ht4', version: ADAPTER_VERSION },
                    counts: {
                        template: { readFromSource: 1, emitted: 1, dropped: [] },
                        contact: emptyEntityCounts(),
                        member: emptyEntityCounts(),
                    },
                    warnings,
                },
                templates: [{ name: options.name, schema: template, stats }],
                contacts: [],
                members: [],
            },
        };
    },
};
