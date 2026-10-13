#!/usr/bin/env node
// One-off, reproducible extraction of administrative reference data from the legacy WordPress theme.
// Output: packages/database/data/provinces.json (committed: contains NO personal data).
//   LEGACY_THEME_DIR=/path/to/charity-hcm  LEGACY_DATA_SOURCE_DIR=/path/to/data-source  node scripts/migration/extract-province-data.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const themeDir = process.env.LEGACY_THEME_DIR;
const dsDir = process.env.LEGACY_DATA_SOURCE_DIR;
if (!themeDir || !dsDir) throw new Error('Set LEGACY_THEME_DIR and LEGACY_DATA_SOURCE_DIR');

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const slugify = (s) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// 1) 34→63 mapping, from assets/js/province-mapping.js (static literal object).
const mappingSrc = readFileSync(resolve(themeDir, 'assets/js/province-mapping.js'), 'utf8');
const body = /NEW_34_TO_OLD_63 = Object\.freeze\((\{[\s\S]*?\})\);/.exec(mappingSrc)[1];
const mapping = Function(`"use strict"; return (${body});`)(); // literal object, no external input

// 2) Names: 34 EN names from functions.php lookup; 63 names/slug/EN from province-directory.json.
const fn = readFileSync(resolve(themeDir, 'functions.php'), 'utf8');
const lookup34 = {};
for (const m of fn.matchAll(/'p\d+'\s*=>\s*\[\s*'vi'\s*=>\s*'([^']+)',\s*'en'\s*=>\s*'([^']+)'/g)) lookup34[m[1]] = m[2];
const dir63 = JSON.parse(readFileSync(resolve(themeDir, 'data/province-directory.json'), 'utf8'));

// 3) Official codes for the 34 units: prefix of vietnam-34-api/NN_slug.json (thanglequoc/vietnamese-provinces-database).
const official34 = {};
for (const f of readdirSync(resolve(dsDir, 'vietnam-34-api'))) {
  const m = /^(\d{2})_(.+)\.json$/.exec(f);
  if (m) official34[m[2].replace(/_/g, '-')] = m[1];
}

const CITIES_34 = new Set(['Hà Nội', 'Huế', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'TP. Hồ Chí Minh']);
const CITIES_63 = new Set(['Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ']);
const stripTp = (n) => n.replace(/^TP\.\s*/, '');
const norm63 = (n) => n.replace(/\s*-\s*/g, '-'); // "Bà Rịa - Vũng Tàu" ↔ directory "Bà Rịa-Vũng Tàu"

const dirByName = new Map(Object.values(dir63).map((e) => [fold(norm63(e.name)), { ...e }]));
const dirCodeByName = new Map(Object.entries(dir63).map(([code, e]) => [fold(norm63(e.name)), code]));
// Source alias: the directory still says "Thừa Thiên Huế"; the legal name immediately before the 2025 reorganisation is "Huế".
for (const m of [dirByName, dirCodeByName]) {
  const k = fold('Thừa Thiên Huế');
  if (m.has(k)) {
    m.set(fold('Huế'), m.get(k));
    m.delete(k);
  }
}

const current = Object.keys(mapping).map((nameVi, i) => {
  const slug = slugify(stripTp(nameVi));
  const code = Object.keys(lookup34).find((c) => lookup34[c] && false) ?? null; // placeholder, set below
  return { nameVi, slug, officialCode: official34[slug] ?? null, kind: CITIES_34.has(nameVi) ? 'CITY' : 'PROVINCE', sortOrder: i, code };
});
// legacy theme codes for 34 (p11…p44): derived from the theme lookup order, which matches the lookup literal order.
const lookup34Entries = [...fn.matchAll(/'(p\d+)'\s*=>\s*\[\s*'vi'\s*=>\s*'([^']+)',\s*'en'\s*=>\s*'([^']+)'/g)].slice(-34);
const lookup34ByFold = new Map(lookup34Entries.map((m) => [fold(m[2]), { code: m[1], en: m[3] }]));
for (const c of current) {
  const hit = lookup34ByFold.get(fold(c.nameVi));
  if (!hit) throw new Error('No theme lookup for 34-unit: ' + c.nameVi);
  c.code = hit.code;
  c.nameEn = hit.en;
}

const legacy = [];
let order = 0;
for (const [curName, olds] of Object.entries(mapping)) {
  for (const oldName of olds) {
    const key = fold(norm63(oldName));
    const d = dirByName.get(key);
    if (!d) throw new Error('No directory entry for 63-unit: ' + oldName);
    legacy.push({
      nameVi: oldName,
      nameEn: d.name_en ?? oldName,
      slug: d.slug,
      code: dirCodeByName.get(key),
      kind: CITIES_63.has(oldName) ? 'CITY' : 'PROVINCE',
      currentNameVi: curName,
      sortOrder: order++,
    });
  }
}

const out = {
  _generated: 'scripts/migration/extract-province-data.mjs',
  _note:
    'code = legacy theme code (p11…), NOT an official administrative code. officialCode only for the 34 units, taken from data-source/vietnam-34-api file prefixes (thanglequoc/vietnamese-provinces-database); verify against Quyết định 19/2025/QĐ-TTg before relying on it.',
  current34: current,
  legacy63: legacy,
};
if (current.length !== 34 || legacy.length !== 63 || new Set(legacy.map((l) => l.slug)).size !== 63) throw new Error('Invariant 34/63 violated');
writeFileSync(resolve('packages/database/data/provinces.json'), JSON.stringify(out, null, 2) + '\n');
console.log('34:', current.length, '63:', legacy.length, 'official codes:', current.filter((c) => c.officialCode).length);
