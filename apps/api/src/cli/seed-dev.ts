import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createPrismaClient, seedReferenceData } from '@hbvl/database';
import { foldVietnamese, normalizeEmail, normalizeUsername, slugify } from '@hbvl/contracts';
import * as argon2 from 'argon2';
import sharp from 'sharp';
import { encrypt } from '../auth/crypto';
import { generateSecret } from '../auth/totp';
import { sanitizeRichText } from '../content/sanitize';
import { loadEnv } from '../config/env';
import { MediaService } from '../media/media.service';
import { StorageService } from '../media/storage.service';

/**
 * DEVELOPMENT ONLY. Creates clearly-labelled DEMO data (origin = SEED_DEMO): 4 accounts with random passwords printed once,
 * demo posts with generated cover images, synthetic members and two demo directory contacts.
 * Refuses to run when NODE_ENV=production or APP_ENV=production. Idempotent: re-running reuses existing demo rows.
 */
async function main() {
  const env = loadEnv();
  if (env.NODE_ENV === 'production' || env.APP_ENV === 'production' || env.APP_ENV === 'staging') throw new Error('seed:dev refuses to run outside local/ci environments');
  const prisma = createPrismaClient({ connectionString: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, poolMax: 4 });
  const storage = new StorageService(env);
  await storage.ensureBucket();
  const media = new MediaService(prisma, storage);
  await seedReferenceData(prisma);
  const out: string[] = [];

  const mk = async (username: string, role: 'ADMIN' | 'COLLABORATOR' | 'MEMBER', displayName: string, mfa = false) => {
    const existing = await prisma.user.findUnique({ where: { usernameNormalized: normalizeUsername(username) } });
    if (existing) {
      out.push(`${role.padEnd(12)} ${username} (already exists — password unchanged)`);
      return existing;
    }
    const password = randomBytes(15).toString('base64url');
    const email = `${username}@demo.hbvl.test`;
    const secret = mfa ? generateSecret() : undefined;
    const u = await prisma.user.create({
      data: {
        username,
        usernameNormalized: normalizeUsername(username),
        email,
        emailNormalized: normalizeEmail(email),
        displayName,
        role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        ...(secret ? { mfaEnabled: true, mfaSecretEnc: encrypt(secret, env.MFA_ENCRYPTION_KEY) } : {}),
        profile: { create: {} },
      },
    });
    out.push(
      `${role.padEnd(12)} ${username.padEnd(14)} password: ${password}${secret ? `   TOTP secret: ${secret}  (code: pnpm --filter @hbvl/api exec tsx src/cli/totp.ts ${secret})` : ''}`,
    );
    return u;
  };
  const admin = await mk('demo-admin', 'ADMIN', 'Quản trị viên (demo)', true);
  await mk('demo-ctv', 'COLLABORATOR', 'Cộng tác viên (demo)');
  const m1 = await mk('demo-thanhvien', 'MEMBER', 'Thành viên Một (demo)');
  await mk('demo-thanhvien2', 'MEMBER', 'Thành viên Hai (demo)');

  const cats = new Map((await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  const demo: { cat: string; title: string; body: string }[] = [
    {
      cat: 'chuyen-vuon-len',
      title: '[Demo] Buổi gặp mặt đầu năm của các bạn học bổng',
      body: '<p>Đây là <strong>nội dung demo</strong> dùng để kiểm tra giao diện. Bài viết mô tả một buổi gặp gỡ giả định để thử bố cục, ảnh đại diện và phần bình luận.</p><h2>Điều đọng lại</h2><p>Mỗi người chia sẻ một điều học được trong năm qua.</p><blockquote>Một câu trích dẫn mẫu để thử kiểu hiển thị.</blockquote>',
    },
    { cat: 'guong-mat-vuon-len', title: '[Demo] Gương mặt Vươn Lên: Học viên mẫu', body: '<p>Hồ sơ <em>mẫu</em> nhằm thử thẻ dạng “hồ sơ”. Không phải người thật.</p>' },
    {
      cat: 'tiep-noi',
      title: '[Demo] Câu chuyện tiếp nối của một cựu học viên (mẫu)',
      body: '<p>Nội dung giả định dành cho mục Tiếp nối.</p><ul><li>Gạch đầu dòng một</li><li>Gạch đầu dòng hai</li></ul>',
    },
    {
      cat: 'nhat-ky-chuyen-di',
      title: '[Demo] Nhật ký chuyến đi về miền Trung',
      body: '<p>Nhật ký mẫu: đi, thấy, nhớ.</p><h2>Ngày thứ nhất</h2><p>Văn bản dài hơn để thử độ rộng dòng và khoảng cách đoạn. Tiếng Việt có dấu: Đồng Tháp, Quảng Ngãi, Khánh Hòa, Đắk Lắk.</p>',
    },
    { cat: 'gioi-thieu-dia-diem', title: '[Demo] Giới thiệu một địa điểm đáng đến', body: '<p>Địa điểm mẫu để thử mục Giới thiệu địa điểm.</p>' },
    { cat: 'bi-kip', title: '[Demo] Bí kíp ghi nhớ nhanh', body: '<p>Mẹo mẫu: lặp lại ngắt quãng.</p>' },
    { cat: 'the-gioi-quanh-ta', title: '[Demo] Thế giới quanh ta: vì sao trời xanh?', body: '<p>Bài ngắn mẫu về kiến thức khoa học.</p>' },
    { cat: 'tom-tat-sach', title: '[Demo] Tóm tắt một cuốn sách về nghị lực', body: '<p>Tóm tắt giả định.</p>' },
    { cat: 'viet-cam-nhan-sach', title: '[Demo] Cảm nhận sau khi đọc một cuốn sách', body: '<p>Cảm nhận mẫu.</p>' },
    { cat: 'tro-choi-sinh-hoat-tap-the', title: '[Demo] Trò chơi vòng tròn cho nhóm nhỏ', body: '<p>Luật chơi mẫu.</p><ol><li>Xếp vòng tròn</li><li>Bắt đầu</li></ol>' },
    { cat: 'tong-hop-bai-hat', title: '[Demo] Bài hát sinh hoạt (lời mẫu)', body: '<p>La la la — lời bài hát mẫu.</p>' },
  ];
  const palette = ['#1d4ed8', '#2f6f4f', '#b45309', '#0f2a6b', '#7c3aed', '#0e7490'];
  let created = 0;
  for (const [i, d] of demo.entries()) {
    const slug = slugify(d.title);
    if (await prisma.post.findUnique({ where: { kind_slug: { kind: 'POST', slug } }, select: { id: true } })) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${palette[i % palette.length]}"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><text x="800" y="470" font-family="sans-serif" font-size="96" font-weight="700" fill="white" text-anchor="middle" opacity="0.85">HBVL · DEMO</text></svg>`;
    const asset = await media.uploadImage(
      { id: admin.id },
      { buffer: await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer(), originalname: `demo-${i}.jpg` },
      'POST_FEATURED',
    );
    const s = sanitizeRichText(d.body);
    const post = await prisma.post.create({
      data: {
        kind: 'POST',
        slug,
        authorId: (i % 2 ? m1 : admin).id,
        status: 'PUBLISHED',
        title: d.title,
        contentHtml: s.html,
        contentText: s.text,
        searchText: s.searchText + ' ' + foldVietnamese(d.title),
        featuredAssetId: asset.id,
        publishedAt: new Date(Date.now() - i * 36 * 3600_000),
        origin: 'SEED_DEMO',
        categories: { create: [{ categoryId: cats.get(d.cat)!, isPrimary: true }] },
        media: { create: [{ assetId: asset.id, role: 'FEATURED' }] },
      },
    });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { visibility: 'PUBLIC', status: 'ACTIVE', attachedAt: new Date() } });
    void post;
    created++;
  }
  out.push(`Demo posts created: ${created}`);

  // Synthetic members (NOT real people): spread across a few provinces to exercise the map.
  const legacy = await prisma.province.findMany({ where: { system: 'LEGACY_63' }, select: { id: true, code: true, slug: true } });
  const spread: [string, number][] = [
    ['ho-chi-minh', 4],
    ['dong-thap', 2],
    ['quang-ngai', 2],
    ['khanh-hoa', 2],
    ['ha-giang', 1],
    ['tuyen-quang', 1],
    ['binh-duong', 1],
    ['dak-lak', 1],
  ];
  const { createHash } = await import('node:crypto');
  let mcount = 0;
  for (const [slug, n] of spread) {
    const p = legacy.find((x) => x.slug === slug)!;
    for (let k = 1; k <= n; k++) {
      const name = `HỌC VIÊN MẪU ${slug.toUpperCase().replace(/-/g, ' ')} ${k}`;
      const r = await prisma.scholarshipMember.createMany({
        data: [{ fullName: name, normalizedName: foldVietnamese(name), legacyProvinceId: p.id, sourceIdentity: createHash('sha256').update(`demo|${slug}|${k}`).digest('hex') }],
        skipDuplicates: true,
      });
      mcount += r.count;
    }
  }
  const hn = legacy.find((x) => x.slug === 'ho-chi-minh')!;
  if (!(await prisma.directoryContact.count({ where: { provinceId: hn.id, source: 'seed-dev' } }))) {
    await prisma.directoryContact.createMany({
      data: [
        { provinceId: hn.id, name: 'Liên hệ mẫu A (demo)', role: 'Đại diện tỉnh', verification: 'VERIFIED', source: 'seed-dev' },
        { provinceId: hn.id, name: 'Liên hệ mẫu B (demo)', role: 'Thành viên', verification: 'VERIFIED', source: 'seed-dev' },
      ],
    });
  }
  out.push(`Synthetic demo members added: ${mcount}`);

  console.log('\n=== DEV SEED (demo data — never run in production) ===');
  for (const l of out) console.log(l);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
