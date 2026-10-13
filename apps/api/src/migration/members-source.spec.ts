import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readMembersCsv, readMembersJson, readMembersXlsx } from './members-source';

function realisticWorkbook(): Uint8Array {
  const strings = ['BÙI MINH LỘC', 'NAM', 'sv năm 4', 'VĨNH LONG', 'ĐẶNG PHÚC HẬU', 'AN GIANG'];
  const sst = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="B1"/></row>
    <row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c><c r="D2" t="s"><v>2</v></c><c r="E2" t="s"><v>3</v></c></row>
    <row r="3"><c r="A3"><v>2</v></c><c r="B3" t="s"><v>4</v></c><c r="E3" t="s"><v>5</v></c></row>
    <row r="4"><c r="B4" t="s"><v>0</v></c></row>
  </sheetData></worksheet>`;
  return zipSync({ 'xl/sharedStrings.xml': strToU8(sst), 'xl/worksheets/sheet1.xml': strToU8(sheet) });
}

describe('member list readers', () => {
  it('reads only name and province from a workbook (other columns are never returned)', () => {
    const rows = readMembersXlsx(realisticWorkbook());
    expect(rows).toEqual([
      { name: 'BÙI MINH LỘC', province: 'VĨNH LONG' },
      { name: 'ĐẶNG PHÚC HẬU', province: 'AN GIANG' },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/NAM|sv năm/);
  });
  it('reads CSV with header detection and quoted fields', () => {
    expect(readMembersCsv('﻿Họ tên,Tỉnh\n"NGUYỄN, VĂN A",Hà Nội\nLê B;Huế\n')).toEqual([
      { name: 'NGUYỄN, VĂN A', province: 'Hà Nội' },
      { name: 'Lê B', province: 'Huế' },
    ]);
    expect(() => readMembersCsv('a,b\n1,2')).toThrow(/name/);
  });
  it('reads the legacy theme JSON shape', () => {
    expect(readMembersJson('{"members":[{"name":"A","oldProvince":"Vĩnh Long","currentProvince":"Vĩnh Long"}]}')).toEqual([{ name: 'A', province: 'Vĩnh Long' }]);
  });
});
