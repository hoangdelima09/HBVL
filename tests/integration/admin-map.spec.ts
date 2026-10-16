import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { foldVietnamese } from '@hbvl/contracts';
import { createTestApp, type Client, type TestApp, type TestUser } from './support/app';

let t: TestApp;
let admin: TestUser, collab: TestUser, member: TestUser;
let ac: Client, cc: Client, mc: Client;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  member = await t.makeUser();
  collab = await t.makeUser({ role: 'COLLABORATOR' });
  admin = await t.makeUser({ role: 'ADMIN', mfa: true });
  [mc, cc, ac] = await Promise.all([t.loginAs(member), t.loginAs(collab), t.loginAs(admin)]);
});

async function addMember(name: string, legacySlug: string) {
  const p = await t.admin.query(`SELECT id, code FROM provinces WHERE system='LEGACY_63' AND slug=$1`, [legacySlug]);
  await t.admin.query(
    `INSERT INTO scholarship_members (id, "fullName", "normalizedName", "legacyProvinceId", "sourceIdentity", "updatedAt") VALUES (gen_random_uuid(), $1::text, $2::text, $3::uuid, encode(sha256(convert_to($1::text || $4::text, 'UTF8')), 'hex'), now())`,
    [name, foldVietnamese(name), p.rows[0].id, legacySlug + Math.random()],
  );
}

describe('map data (single source of truth for 34/63)', () => {
  it('seed: 34 current + 63 legacy provinces, every legacy unit maps to exactly one current unit', async () => {
    const c = await t.admin.query(`SELECT system, count(*)::int n FROM provinces GROUP BY system ORDER BY system`);
    expect(c.rows).toEqual([
      { system: 'CURRENT_34', n: 34 },
      { system: 'LEGACY_63', n: 63 },
    ]);
    expect((await t.admin.query(`SELECT count(*)::int n FROM province_mappings`)).rows[0].n).toBe(63);
    expect((await t.admin.query(`SELECT count(DISTINCT "currentProvinceId")::int n FROM province_mappings`)).rows[0].n).toBe(34);
    // DB-level guard: mapping direction is enforced by trigger
    await expect(
      t.admin.query(
        `INSERT INTO province_mappings ("legacyProvinceId","currentProvinceId") SELECT a.id, b.id FROM provinces a, provinces b WHERE a.system='CURRENT_34' AND b.system='LEGACY_63' LIMIT 1`,
      ),
    ).rejects.toThrow();
  });

  it('34 and 63 modes never double count; totals equal; empty provinces are 0; 34-mode lists constituents', async () => {
    await addMember('NGUYỄN VĂN A', 'ha-giang'); // Hà Giang → Tuyên Quang (merged)
    await addMember('TRẦN THỊ B', 'tuyen-quang');
    await addMember('LÊ C', 'ho-chi-minh');
    await addMember('PHẠM D', 'binh-duong'); // Bình Dương → TP.HCM (merged)
    const anon = await t.newClient();
    const s63 = (await anon.get('/map/summary?system=63')).body;
    const s34 = (await anon.get('/map/summary?system=34')).body;
    expect(s63.provinces).toHaveLength(63);
    expect(s34.provinces).toHaveLength(34);
    expect(s63.totals.members).toBe(4);
    expect(s34.totals.members).toBe(4);
    const tq = s34.provinces.find((p: { slug: string }) => p.slug === 'tuyen-quang');
    expect(tq.count).toBe(2);
    expect(tq.constituents.map((c: { slug: string; count: number }) => [c.slug, c.count])).toEqual([
      ['ha-giang', 1],
      ['tuyen-quang', 1],
    ]);
    expect(s34.provinces.find((p: { slug: string }) => p.slug === 'ho-chi-minh').count).toBe(2);
    expect(s63.provinces.find((p: { slug: string }) => p.slug === 'ho-chi-minh').count).toBe(1);
    expect(s63.provinces.find((p: { slug: string }) => p.slug === 'ca-mau').count).toBe(0);
    expect(s34.totals.unitsWithMembers).toBe(2);
    expect(s34.geometryVersion).toMatch(/^[0-9a-f]{16}$/);
    const mem = await anon.get('/map/provinces/34/tuyen-quang/members');
    expect(mem.body.items.map((m: { name: string }) => m.name)).toEqual(['NGUYỄN VĂN A', 'TRẦN THỊ B']);
    expect((await anon.get('/map/provinces/63/ca-mau/members')).body).toEqual({ items: [], total: 0 });
    expect((await anon.get('/map/provinces/99/x/members')).status).toBe(404);
  });

  it('search finds provinces and members with/without diacritics (đ/d)', async () => {
    await addMember('ĐOÀN TRUNG NHÂN', 'dong-thap');
    const anon = await t.newClient();
    const r = await anon.get(`/map/search?system=34&q=${encodeURIComponent('doan trung')}`);
    expect(r.body.members[0]).toMatchObject({ name: 'ĐOÀN TRUNG NHÂN', provinceSlug: 'dong-thap' });
    const p = await anon.get(`/map/search?system=63&q=${encodeURIComponent('Đồng')}`);
    expect(p.body.provinces.map((x: { slug: string }) => x.slug)).toEqual(expect.arrayContaining(['dong-thap', 'dong-nai']));
    expect((await anon.get('/map/search?system=34&q=x')).body).toEqual({ provinces: [], members: [] });
  });

  it('geometry endpoint serves versioned immutable data (34 + 63 + 17 islands)', async () => {
    const anon = await t.newClient();
    const v = (await anon.get('/map/summary?system=34')).body.geometryVersion;
    const g = await anon.get(`/map/geometry?v=${v}`);
    expect(g.status).toBe(200);
    expect(g.headers['cache-control']).toContain('immutable');
    expect(g.body.modes['34']).toHaveLength(34);
    expect(g.body.modes['63']).toHaveLength(63);
    expect(g.body.islands).toHaveLength(17);
    expect(
      g.body.islands
        .filter((i: { archipelago?: boolean }) => i.archipelago)
        .map((i: { name: string }) => i.name)
        .sort(),
    ).toEqual(['QĐ. Hoàng Sa', 'QĐ. Trường Sa']);
  });

  it('province page: unknown slug 404; directory entries are hidden until verified', async () => {
    const prov = await t.admin.query(`SELECT id FROM provinces WHERE system='LEGACY_63' AND slug='ha-noi'`);
    await t.admin.query(
      `INSERT INTO directory_contacts (id, "provinceId", name, role, verification, source) VALUES (gen_random_uuid(), $1, 'Người Mẫu', 'Đại diện tỉnh', 'UNVERIFIED_SAMPLE', 'province-directory.json')`,
      [prov.rows[0].id],
    );
    const anon = await t.newClient();
    expect((await anon.get('/provinces/khong-co')).status).toBe(404);
    const page = await anon.get('/provinces/ha-noi');
    expect(page.status).toBe(200);
    expect(page.body.contacts).toEqual([]);
    expect(page.body.memberCount).toBe(0);
    const id = (await t.admin.query(`SELECT id FROM directory_contacts`)).rows[0].id;
    expect((await ac.patch(`/admin/directory/${id}`, { verification: 'VERIFIED' })).status).toBe(200);
    expect((await (await t.newClient()).get('/provinces/ha-noi')).body.contacts).toHaveLength(1);
    expect((await cc.patch(`/admin/directory/${id}`, { verification: 'HIDDEN' })).status).toBe(403);
  });
});

describe('admin members import (preview → commit)', () => {
  it('reports row-level problems, never merges same-name people silently, and is idempotent', async () => {
    await addMember('LÊ QUANG DŨNG', 'binh-phuoc');
    const rows = [
      { name: 'Nguyễn Minh Quân', province: 'ĐÀ NẴNG' },
      { name: 'Nguyễn Minh Quân', province: 'Đà Nẵng' }, // duplicate in file
      { name: 'Bùi Phương Thảo', province: 'TP. THỦ ĐỨC' }, // alias → HCM
      { name: 'Hoàng Thị X', province: 'ĐẮC LẮK' }, // alias
      { name: 'Ai Đó', province: 'Atlantis' }, // unknown
      { name: 'Lê Quang Dũng', province: 'Khánh Hòa' }, // same name, other province → ambiguous
      { name: '', province: 'Hà Nội' }, // invalid
    ];
    const prev = await ac.post('/admin/members/import/preview', { rows });
    expect(prev.status).toBe(200);
    const st = prev.body.rows.map((r: { status: string }) => r.status);
    expect(st).toEqual(['OK', 'DUPLICATE_IN_FILE', 'OK', 'OK', 'UNKNOWN_PROVINCE', 'AMBIGUOUS_SAME_NAME', 'INVALID']);
    expect(prev.body.rows[2].provinceSlug).toBe('ho-chi-minh');
    expect(prev.body.rows[3].provinceSlug).toBe('dak-lak');
    // nothing written by preview
    expect((await t.admin.query(`SELECT count(*)::int n FROM scholarship_members`)).rows[0].n).toBe(1);
    const commit = await ac.post('/admin/members/import/commit', { token: prev.body.token, confirmAmbiguous: [] });
    expect(commit.body.created).toBe(3);
    expect((await t.admin.query(`SELECT count(*)::int n FROM scholarship_members`)).rows[0].n).toBe(4);
    // ambiguous row confirmed as a different person
    const again = await ac.post('/admin/members/import/preview', {
      rows: [
        { name: 'Lê Quang Dũng', province: 'Khánh Hòa' },
        { name: 'Bùi Phương Thảo', province: 'Hồ Chí Minh' },
      ],
    });
    expect(again.body.rows.map((r: { status: string }) => r.status)).toEqual(['AMBIGUOUS_SAME_NAME', 'ALREADY_EXISTS']);
    const c2 = await ac.post('/admin/members/import/commit', { token: again.body.token, confirmAmbiguous: [1] });
    expect(c2.body.created).toBe(1);
    expect((await t.admin.query(`SELECT count(*)::int n FROM scholarship_members WHERE "normalizedName"='le quang dung'`)).rows[0].n).toBe(2);
    // a preview token is single-use
    expect((await ac.post('/admin/members/import/commit', { token: again.body.token, confirmAmbiguous: [] })).status).toBe(404);
    // members are not accounts: no user rows were created from names
    expect((await t.admin.query(`SELECT count(*)::int n FROM users`)).rows[0].n).toBe(3);
    expect((await cc.post('/admin/members/import/preview', { rows })).status).toBe(403);
    expect((await mc.post('/admin/members/import/preview', { rows })).status).toBe(403);
  });

  it('replace mode: the file becomes the whole list (current members deleted in the same commit)', async () => {
    await addMember('Người Cũ Một', 'ha-noi');
    await addMember('Người Cũ Hai', 'hue');
    const prev = await ac.post('/admin/members/import/preview', {
      rows: [
        { name: 'Người Cũ Một', province: 'Hà Nội' },
        { name: 'Người Mới', province: 'Cà Mau' },
      ],
      replace: true,
    });
    expect(prev.body.replace).toBe(true);
    expect(prev.body.replacing).toBe(2);
    expect(prev.body.rows.map((r: { status: string }) => r.status)).toEqual(['OK', 'OK']); // checked against an empty list
    const c = await ac.post('/admin/members/import/commit', { token: prev.body.token, confirmAmbiguous: [] });
    expect(c.body).toMatchObject({ created: 2, deleted: 2 });
    const names = (await t.admin.query(`SELECT "fullName" FROM scholarship_members ORDER BY "fullName"`)).rows.map((r) => r.fullName);
    expect(names).toEqual(['Người Cũ Một', 'Người Mới']);
  });
});

describe('admin members: full editing', () => {
  const memberRow = async (name: string) =>
    (
      await t.admin.query(
        `SELECT m.id, m."fullName", m."normalizedName", m."sourceIdentity", m.status, m."isPublic", p.slug FROM scholarship_members m JOIN provinces p ON p.id = m."legacyProvinceId" WHERE m."fullName" = $1`,
        [name],
      )
    ).rows[0];

  it('edits name and province (search name + identity recomputed, a later import recognises the person), status and visibility', async () => {
    const r = await ac.post('/admin/members', { name: 'Nguyen Van Sai', provinceSlug: 'ha-noi' });
    expect(r.status).toBe(201);
    const before = await memberRow('Nguyen Van Sai');
    const up = await ac.patch(`/admin/members/${before.id}`, { fullName: '  Nguyễn  Văn Đúng ', provinceSlug: 'ca-mau', isPublic: false, status: 'ARCHIVED' });
    expect(up.status).toBe(200);
    const after = await memberRow('Nguyễn Văn Đúng');
    expect(after).toMatchObject({ id: before.id, normalizedName: foldVietnamese('Nguyễn Văn Đúng'), slug: 'ca-mau', isPublic: false, status: 'ARCHIVED' });
    expect(after.sourceIdentity).not.toBe(before.sourceIdentity);
    const again = await ac.post('/admin/members/import/preview', { rows: [{ name: 'Nguyễn Văn Đúng', province: 'Cà Mau' }] });
    expect(again.body.rows[0].status).toBe('ALREADY_EXISTS');
    // filters
    const list = await ac.get('/admin/members?province=ca-mau&status=ARCHIVED&visibility=hidden');
    expect(list.body.items.map((m: { id: string }) => m.id)).toEqual([before.id]);
    expect((await ac.get('/admin/members?province=ca-mau&visibility=public')).body.total).toBe(0);
    const audit = await t.admin.query(`SELECT metadata FROM audit_logs WHERE action='member.update' AND "resourceId"=$1`, [before.id]);
    expect(audit.rows[0].metadata.from).toEqual({ name: 'Nguyen Van Sai', province: 'ha-noi' });
  });

  it('a namesake needs "different person" confirmation; unknown province / member are refused', async () => {
    await addMember('Trần Thị Hai', 'hue');
    await addMember('Trần Thị Hai', 'ha-noi');
    const other = await ac.post('/admin/members', { name: 'Trần Thị Khác', provinceSlug: 'hue' });
    expect(other.status).toBe(201);
    const id = (await memberRow('Trần Thị Khác')).id;
    const clash = await ac.patch(`/admin/members/${id}`, { fullName: 'Trần Thị Hai' }); // same name, same province
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.status).toBe('DUPLICATE');
    expect((await ac.patch(`/admin/members/${id}`, { fullName: 'Trần Thị Hai', distinct: true })).status).toBe(200);
    expect((await t.admin.query(`SELECT count(*)::int n FROM scholarship_members WHERE "normalizedName"=$1`, [foldVietnamese('Trần Thị Hai')])).rows[0].n).toBe(3);
    expect((await ac.patch(`/admin/members/${id}`, { provinceSlug: 'atlantis' })).status).toBe(400);
    expect((await ac.patch(`/admin/members/00000000-0000-7000-8000-000000000000`, { fullName: 'X' })).status).toBe(404);
  });

  it('deletes one or many, bulk hides/archives/moves (namesake moves are reported, not forced), exports CSV; admins only', async () => {
    for (const n of ['A Một', 'B Hai', 'C Ba', 'D Bốn']) await ac.post('/admin/members', { name: n, provinceSlug: 'hue' });
    await addMember('C Ba', 'ca-mau');
    const ids = Object.fromEntries(
      (await t.admin.query(`SELECT m.id, m."fullName" FROM scholarship_members m JOIN provinces p ON p.id=m."legacyProvinceId" WHERE p.slug='hue'`)).rows.map((r) => [
        r.fullName,
        r.id,
      ]),
    );

    expect((await ac.delete(`/admin/members/${ids['A Một']}`)).status).toBe(204);
    expect((await ac.delete(`/admin/members/${ids['A Một']}`)).status).toBe(404);

    const hide = await ac.post('/admin/members/bulk', { ids: [ids['B Hai'], ids['C Ba']], action: 'hide' });
    expect(hide.body).toMatchObject({ done: 2, failed: [] });
    const move = await ac.post('/admin/members/bulk', { ids: [ids['B Hai'], ids['C Ba']], action: 'move', provinceSlug: 'ca-mau' });
    expect(move.body.done).toBe(1);
    expect(move.body.failed).toEqual([{ id: ids['C Ba'], message: expect.stringContaining('cùng họ tên') }]);
    expect((await ac.post('/admin/members/bulk', { ids: [ids['B Hai']], action: 'move' })).status).toBe(400);

    const csv = await ac.get('/admin/members/export?province=ca-mau');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(
      csv.text
        .replace(/^\uFEFF/, '')
        .split('\r\n')
        .filter(Boolean),
    ).toEqual(['name,province,trang_thai,hien_thi', 'B Hai,Cà Mau,Hoạt động,Ẩn', 'C Ba,Cà Mau,Hoạt động,Hiện']);

    const gone = await ac.post('/admin/members/bulk', { ids: [ids['B Hai'], ids['D Bốn']], action: 'delete' });
    expect(gone.body.done).toBe(2);
    expect((await t.admin.query(`SELECT count(*)::int n FROM scholarship_members`)).rows[0].n).toBe(2);
    expect((await t.admin.query(`SELECT count(*)::int n FROM audit_logs WHERE action IN ('member.delete','members.bulk')`)).rows[0].n).toBe(3);

    for (const c of [cc, mc]) {
      expect((await c.patch(`/admin/members/${ids['C Ba']}`, { fullName: 'X' })).status).toBe(403);
      expect((await c.delete(`/admin/members/${ids['C Ba']}`)).status).toBe(403);
      expect((await c.post('/admin/members/bulk', { ids: [ids['C Ba']], action: 'delete' })).status).toBe(403);
      expect((await c.get('/admin/members/export')).status).toBe(403);
    }
  });
});

describe('admin users', () => {
  it('cannot demote/suspend/delete the last active admin, not even concurrently; cannot change own role', async () => {
    const second = await t.makeUser({ role: 'ADMIN', mfa: true });
    expect((await ac.patch(`/admin/users/${admin.id}`, { role: 'MEMBER' })).status).toBe(403); // self
    const [r1, r2] = await Promise.all([
      ac.patch(`/admin/users/${second.id}`, { role: 'MEMBER' }),
      (await t.loginAs(second)).patch(`/admin/users/${admin.id}`, { role: 'MEMBER' }),
    ]);
    // one of the two demotions must be refused; at least one admin remains active
    expect([r1.status, r2.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1);
    expect((await t.admin.query(`SELECT count(*)::int n FROM users WHERE role='ADMIN' AND status='ACTIVE'`)).rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("role change and suspension revoke the target's sessions immediately; invite creates PENDING_RESET with an activation e-mail", async () => {
    const target = await t.makeUser({ role: 'MEMBER' });
    const tc = await t.loginAs(target);
    expect((await tc.get('/auth/me')).body.user.role).toBe('MEMBER');
    expect((await ac.patch(`/admin/users/${target.id}`, { role: 'COLLABORATOR' })).status).toBe(200);
    expect((await tc.get('/auth/me')).body.user).toBeNull(); // old session revoked; must sign in again with the new role
    const inv = await ac.post('/admin/users', { username: 'moi.moi', email: 'moi@example.test', displayName: 'Người Mới', role: 'COLLABORATOR' });
    expect(inv.status).toBe(201);
    expect(inv.body.status).toBe('PENDING_RESET');
    const row = await t.admin.query(`SELECT "passwordHash" FROM users WHERE username='moi.moi'`);
    expect(row.rows[0].passwordHash).toBeNull();
    expect((await t.admin.query(`SELECT count(*)::int n FROM outbox_events WHERE type='EMAIL_SEND' AND "aggregateId"=$1`, [inv.body.id])).rows[0].n).toBe(1);
    expect((await cc.get('/admin/users')).status).toBe(403);
    expect((await mc.post('/admin/users', { username: 'x.y.z', email: 'x@example.test', displayName: 'X', role: 'ADMIN' })).status).toBe(403);
  });

  it('anonymise keeps posts/comments intact but removes personal data and sessions', async () => {
    const victim = await t.makeUser();
    const vc = await t.loginAs(victim);
    await t.admin.query(`INSERT INTO posts (id, kind, slug, "authorId", status, title, "updatedAt") VALUES (gen_random_uuid(),'POST','nhap-v',$1,'DRAFT','Giữ lại',now())`, [
      victim.id,
    ]);
    expect((await ac.delete(`/admin/users/${victim.id}`)).status).toBe(200);
    const u = await t.admin.query(`SELECT username, email, status, "passwordHash", "displayName" FROM users WHERE id=$1`, [victim.id]);
    expect(u.rows[0]).toMatchObject({ status: 'DELETED', passwordHash: null, displayName: 'Người dùng đã xóa' });
    expect(u.rows[0].email).toMatch(/@invalid\.local$/);
    expect((await t.admin.query(`SELECT count(*)::int n FROM posts WHERE "authorId"=$1`, [victim.id])).rows[0].n).toBe(1);
    expect((await vc.get('/auth/me')).body.user).toBeNull();
  });
});

describe('audit log, dashboards, redirects, settings, pages', () => {
  it('audit log is append-only at the database level and records admin actions with request ids', async () => {
    await ac.patch(`/admin/users/${member.id}`, { displayName: 'Tên mới' });
    const rows = (await ac.get('/admin/audit?action=user.update')).body.items;
    expect(rows.length).toBeGreaterThan(0);
    await expect(t.admin.query(`UPDATE audit_logs SET action='x'`)).rejects.toThrow(/append-only/);
    await expect(t.admin.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    expect((await cc.get('/admin/audit')).status).toBe(403);
  });

  it('dashboards return live numbers and only to the right roles', async () => {
    await mc.post('/feedback', { subject: 's', message: 'm' });
    const staff = await cc.get('/staff/dashboard');
    expect(staff.body.feedbackNew).toBe(1);
    expect((await mc.get('/staff/dashboard')).status).toBe(403);
    const dash = await ac.get('/admin/dashboard');
    expect(dash.body.users).toMatchObject({ ADMIN: 1, COLLABORATOR: 1, MEMBER: 1 });
    expect(dash.body.feedback.NEW).toBe(1);
    expect((await cc.get('/admin/dashboard')).status).toBe(403);
  });

  it('redirects: internal-only targets, no loops, resolved from the table (never open redirect)', async () => {
    expect((await ac.post('/admin/redirects', { fromPath: '/cu', toPath: 'https://evil.example/x' })).status).toBe(400);
    expect((await ac.post('/admin/redirects', { fromPath: '/cu', toPath: '//evil.example' })).status).toBe(400);
    expect((await ac.post('/admin/redirects', { fromPath: '/a', toPath: '/b' })).status).toBe(201);
    expect((await ac.post('/admin/redirects', { fromPath: '/b', toPath: '/a' })).status).toBe(400); // loop
    expect((await ac.post('/admin/redirects', { fromPath: '/x', toPath: '/x' })).status).toBe(400);
    const anon = await t.newClient();
    expect((await anon.get('/redirects/resolve?path=/a/')).body).toEqual({ to: '/b', status: 301 });
    expect((await anon.get('/redirects/resolve?path=/nope')).status).toBe(404);
    expect((await mc.post('/admin/redirects', { fromPath: '/q', toPath: '/r' })).status).toBe(403);
  });

  it('settings: only allow-listed keys, admin only; public endpoint exposes brand/contact/home', async () => {
    const pub = await (await t.newClient()).get('/settings/public');
    expect(Object.keys(pub.body).sort()).toEqual(['brand', 'contact', 'home', 'social']);
    expect(pub.body.contact.email).toBe('quykhuyenhocdongdu@gmail.com');
    expect((await ac.put('/admin/settings/contact', { value: { ...pub.body.contact, phone: '000' } })).status).toBe(200);
    expect((await ac.put('/admin/settings/wp_options', { value: {} })).status).toBe(404);
    expect((await cc.put('/admin/settings/contact', { value: {} })).status).toBe(403);
  });

  it('pages: nested paths resolve; drafts/private/trashed pages are not public; admin CRUD with version check', async () => {
    const parent = await ac.post('/admin/pages', { slug: 'gioi-thieu', title: 'Giới thiệu', contentHtml: '<p>Xin chào</p><script>x</script>', status: 'PUBLISHED' });
    expect(parent.status).toBe(201);
    const child = await ac.post('/admin/pages', { slug: 'tong-quan', title: 'Tổng quan', parentId: parent.body.id, contentHtml: '<p>Con</p>', status: 'PUBLISHED' });
    const hidden = await ac.post('/admin/pages', { slug: 'nhap', title: 'Nháp', contentHtml: '', status: 'DRAFT' });
    const anon = await t.newClient();
    const r = await anon.get('/pages/by-path?path=gioi-thieu/tong-quan');
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Tổng quan');
    expect((await anon.get('/pages/by-path?path=gioi-thieu')).body.contentHtml).not.toContain('script');
    expect((await anon.get('/pages/by-path?path=nhap')).status).toBe(404);
    expect((await anon.get('/pages/by-path?path=tong-quan')).status).toBe(404); // child is only reachable under its parent
    const stale = await ac.patch(`/admin/pages/${child.body.id}`, { title: 'Mới' }, { 'If-Match': '"99"' });
    expect(stale.status).toBe(409);
    expect((await ac.patch(`/admin/pages/${hidden.body.id}`, { status: 'PUBLISHED' }, { 'If-Match': '"1"' })).status).toBe(200);
    expect((await ac.delete(`/admin/pages/${parent.body.id}`)).status).toBe(409); // has children
  });

  it('events/programs: admin creates, publishes; public lists them; optional fields stay empty (nothing invented)', async () => {
    const ev = await ac.post('/admin/content/events', { title: 'Gặp mặt thành viên', contentHtml: '<p>Chi tiết</p>', status: 'PUBLISHED' });
    expect(ev.status).toBe(201);
    const pr = await ac.post('/admin/content/programs', { title: 'Học bổng Vươn Lên 2027', contentHtml: '<p>Chương trình</p>', status: 'DRAFT' });
    const anon = await t.newClient();
    expect((await anon.get('/events')).body.items.map((i: { slug: string }) => i.slug)).toEqual(['gap-mat-thanh-vien']);
    expect((await anon.get('/events/gap-mat-thanh-vien')).body.event).toMatchObject({ startsAt: null, endsAt: null, locationText: null });
    expect((await anon.get('/programs')).body.items).toHaveLength(0); // draft is not public
    expect((await anon.get('/programs/hoc-bong-vuon-len-2027')).status).toBe(404);
    expect(pr.status).toBe(201);
    const put = await ac.put(`/admin/posts/${ev.body.id}/translations/en`, { title: 'Members meetup', contentHtml: '<p>Details</p>' });
    expect(put.status).toBe(200);
    expect((await mc.post('/admin/content/events', { title: 'x', contentHtml: '', status: 'PUBLISHED' })).status).toBe(403);
  });
});
