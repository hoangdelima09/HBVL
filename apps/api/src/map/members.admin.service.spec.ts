import { describe, expect, it } from 'vitest';
import { classifyMemberRows, originalProvinceOf } from './members.admin.service';

const P = (slug: string, nameVi: string) => ({ id: slug, code: slug, slug, nameVi, nameEn: nameVi });
const provinces = [P('phu-yen', 'Phú Yên'), P('dak-lak', 'Đắk Lắk'), P('ho-chi-minh', 'Hồ Chí Minh')];

describe('originalProvinceOf', () => {
  it('takes the province named in a trailing "(… cũ)" note', () => {
    expect(originalProvinceOf('ĐẮC LẮK(phú yên cũ)')).toBe('phú yên');
    expect(originalProvinceOf('Đắk Lắk (Phú Yên cũ)')).toBe('Phú Yên');
  });
  it('leaves plain values untouched', () => {
    expect(originalProvinceOf('ĐẮC LẮK')).toBe('ĐẮC LẮK');
    expect(originalProvinceOf('TP. HỒ CHÍ MINH')).toBe('TP. HỒ CHÍ MINH');
  });
});

describe('classifyMemberRows', () => {
  it('places a "(… cũ)" member in the original province and keeps same-spelling members in theirs', () => {
    const out = classifyMemberRows(
      [
        { name: 'CAO THUẬN THIÊN', province: 'ĐẮC LẮK(phú yên cũ)' },
        { name: 'PHẠM VĂN NGUYÊN', province: 'ĐẮC LẮK' },
        { name: 'HOÀNG MINH DƯƠNG', province: 'TP. HỒ CHÍ MINH' },
      ],
      provinces,
      [],
    );
    expect(out.map((r) => [r.status, r.provinceSlug])).toEqual([
      ['OK', 'phu-yen'],
      ['OK', 'dak-lak'],
      ['OK', 'ho-chi-minh'],
    ]);
  });
});
