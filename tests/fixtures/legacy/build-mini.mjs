#!/usr/bin/env node
// Generates mini.sql: a SYNTHETIC WordPress database (no real people, no real e-mail addresses — only *.example.org) that exercises every
// migration rule. Run `node build-mini.mjs` to regenerate. The password hashes below are fake sentinels the tests search for to prove
// that nothing resembling a WordPress hash ever reaches the new database.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`);
const insert = (table, rows) => rows.length ? `INSERT INTO \`${table}\` (${Object.keys(rows[0]).map((k) => `\`${k}\``).join(',')}) VALUES\n${rows.map((r) => `(${Object.values(r).map(q).join(',')})`).join(',\n')};\n` : '';
const caps = (...roles) => `a:${roles.length}:{${roles.map((r) => `s:${Buffer.byteLength(r)}:"${r}";b:1;`).join('')}}`;

export const HASH_SENTINEL = '$wp$2y$10$FIXTURE.HASH.MUST.NEVER.BE.IMPORTED';

const users = [
  [1, 'admin_user', 'admin@legacy.example.org', 'Quản trị', caps('administrator')],
  [2, 'collab', 'collab@legacy.example.org', 'Cộng tác viên', caps('riseup_collaborator')],
  [3, 'member1', 'member1@legacy.example.org', 'Thành viên Một', caps('riseup_member')],
  [4, 'sub1', 'sub1@legacy.example.org', 'Người đăng ký', caps('subscriber')],
  [5, 'editor1', 'editor1@legacy.example.org', 'Biên tập WP', caps('editor')],
  [6, 'noemail', '', 'Không email', caps('subscriber')],
  [7, 'dupemail', 'MEMBER1@legacy.example.org', 'Trùng email', caps('subscriber')],
  [8, 'evilcaps', 'evil@legacy.example.org', 'Quyền độc hại', 'O:8:"stdClass":0:{}'],
  [9, 'ab', 'short@legacy.example.org', 'Tên ngắn', caps('subscriber')],
  [10, 'Member1', 'member1b@legacy.example.org', 'Trùng tên đăng nhập', caps('subscriber')],
];
const wpUsers = users.map(([ID, login, email, name]) => ({ ID, user_login: login, user_pass: HASH_SENTINEL, user_nicename: login, user_email: email, user_url: '', user_registered: '2026-03-12 09:00:00', user_activation_key: '', user_status: 0, display_name: name }));
const usermeta = users.flatMap(([ID, , , , c]) => [{ user_id: ID, meta_key: 'nickname', meta_value: `nick${ID}` }, { user_id: ID, meta_key: 'wp_capabilities', meta_value: c }, { user_id: ID, meta_key: 'session_tokens', meta_value: 'a:1:{s:4:"FAKE";a:0:{}}' }]);

const terms = [
  [1, 'Uncategorized', 'uncategorized', 'category'], [2, 'Chuyện Vươn Lên', 'chuyen-vuon-len', 'category'], [3, 'Charity', 'charity', 'category'],
  [4, 'tag a', 'tag-a', 'post_tag'], [5, 'tag b', 'tag-b', 'post_tag'], [6, 'Primary Menu', 'primary-menu', 'nav_menu'],
];
const post = (o) => ({ ID: 0, post_author: 1, post_date: '2026-08-01 10:00:00', post_date_gmt: '2026-08-01 03:00:00', post_content: '', post_title: '', post_excerpt: '', post_status: 'publish', comment_status: 'open', ping_status: 'closed', post_password: '', post_name: '', to_ping: '', pinged: '', post_modified: '2026-08-02 10:00:00', post_modified_gmt: '2026-08-02 03:00:00', post_content_filtered: '', post_parent: 0, guid: '', menu_order: 0, post_type: 'post', post_mime_type: '', comment_count: 0, ...o });
const EN = 'We left the city early in the morning and we brought rice and notebooks for the children. It is a day that we will remember, and it is what we are going back for in the spring. The team is thankful for the help that we got from the community.';
const posts = [
  post({ ID: 100, post_author: 3, post_title: 'Bài mới', post_name: 'bai-moi', post_excerpt: 'Tóm tắt <b>ngắn</b>', post_content: '<p>Nội dung tiếng Việt có ảnh.</p><p><img src="http://legacy.test/wp/wp-content/uploads/2026/08/a-300x200.png" alt="Ảnh A"></p><p><img src="http://legacy.test/wp/wp-content/uploads/2026/08/missing.png"></p><script>alert(1)</script>' }),
  post({ ID: 101, post_author: 3, post_title: 'Bài trùng slug', post_name: 'bai-moi', post_content: '<p>Một bài khác cùng slug.</p>' }),
  post({ ID: 102, post_title: 'Bài hẹn giờ', post_name: 'bai-hen-gio', post_status: 'future', post_date: '2030-01-01 10:00:00', post_date_gmt: '2030-01-01 03:00:00', post_content: '<p>Tương lai</p>' }),
  post({ ID: 103, post_title: 'Bài riêng tư', post_name: 'bai-rieng', post_status: 'private', post_content: '<p>Riêng</p>' }),
  post({ ID: 104, post_title: 'Bài đã xoá', post_name: 'bai-xoa__trashed', post_status: 'trash', post_content: '<p>Rác</p>' }),
  post({ ID: 105, post_title: 'Bài có mật khẩu', post_name: 'bai-mat-khau', post_password: 'pw-must-not-be-imported', post_content: '<p>Bí mật</p>' }),
  post({ ID: 106, post_author: 3, post_title: 'Bài chờ duyệt', post_name: 'bai-cho-duyet', post_status: 'pending', post_content: '<p>Chờ</p>' }),
  post({ ID: 107, post_author: 3, post_title: 'Cần sửa', post_name: 'can-sua', post_status: 'draft', post_content: '<p>Sửa</p>' }),
  post({ ID: 108, post_author: 4, post_title: 'Bị từ chối', post_name: 'bi-tu-choi', post_status: 'draft', post_content: '<p>Từ chối</p>' }),
  post({ ID: 109, post_title: 'Auto Draft', post_status: 'auto-draft' }),
  post({ ID: 110, post_title: 'The Day We Showed Up', post_name: 'the-day-we-showed-up', post_content: `<p>${EN}</p>` }),
  post({ ID: 111, post_title: 'Bài có shortcode', post_name: 'bai-shortcode', post_content: 'Dòng một\n\nDòng hai [gallery ids="1,2"] xem <a href="http://legacy.test/wp/?p=100">bài mới</a> và <a href="http://legacy.test/wp/gioi-thieu/">giới thiệu</a>.' }),
  post({ ID: 112, post_title: 'Sự kiện A', post_name: 'su-kien-a', post_type: 'event', post_content: '<p>Sự kiện</p>' }),
  post({ ID: 113, post_title: 'Chương trình B', post_name: 'chuong-trinh-b', post_type: 'program', post_content: '<p>Chương trình</p>' }),
  post({ ID: 114, post_author: 99, post_title: 'Tác giả đã mất', post_name: 'tac-gia-mat', post_status: 'pending', post_content: '<p>x</p>' }),
  post({ ID: 115, post_title: 'Trạng thái lạ', post_name: 'trang-thai-la', post_status: 'weird', post_content: '<p>x</p>' }),
  post({ ID: 20, post_title: 'Giới thiệu', post_name: 'gioi-thieu', post_type: 'page', post_content: '<p>Trang giới thiệu</p>' }),
  post({ ID: 21, post_title: 'Tổng quan', post_name: 'tong-quan', post_type: 'page', post_parent: 20, post_content: '<p>Tổng quan</p>' }),
  post({ ID: 22, post_title: 'Liên hệ', post_name: 'lien-he', post_type: 'page', post_content: '<p>Trang cũ</p>' }),
  post({ ID: 23, post_title: 'Trang ch?', post_name: 'home', post_type: 'page', post_content: '' }),
  post({ ID: 24, post_title: 'Tin t?c & Blog', post_name: 'blog', post_type: 'page', post_content: '' }),
  post({ ID: 25, post_title: 'Trang nháp', post_name: 'nhap', post_type: 'page', post_status: 'draft', post_content: '<p>Nháp</p>' }),
  post({ ID: 26, post_title: 'Trang đã xoá', post_name: 'trang-xoa__trashed', post_type: 'page', post_status: 'trash', post_content: '<p>Rác</p>' }),
  post({ ID: 200, post_title: 'a', post_name: 'a', post_type: 'attachment', post_status: 'inherit', post_mime_type: 'image/png' }),
  post({ ID: 201, post_title: 'gone', post_name: 'gone', post_type: 'attachment', post_status: 'inherit', post_mime_type: 'image/png' }),
  post({ ID: 300, post_title: 'Bài mới (bản cũ)', post_name: '100-revision-v1', post_type: 'revision', post_status: 'inherit', post_parent: 100, post_content: '<p>Bản cũ</p>' }),
  post({ ID: 301, post_title: 'Giới thiệu (bản cũ)', post_name: '20-revision-v1', post_type: 'revision', post_status: 'inherit', post_parent: 20, post_content: '<p>Bản cũ trang</p>' }),
  post({ ID: 302, post_title: 'Mồ côi', post_name: '999-revision-v1', post_type: 'revision', post_status: 'inherit', post_parent: 999, post_content: '<p>x</p>' }),
  post({ ID: 400, post_author: 3, post_title: 'Góp ý A', post_name: 'gop-y-a', post_type: 'riseup_feedback', post_status: 'private', post_content: 'Nội dung góp ý.' }),
  post({ ID: 401, post_author: 3, post_title: 'Góp ý đã xoá', post_type: 'riseup_feedback', post_status: 'trash', post_content: 'x' }),
  post({ ID: 410, post_author: 4, post_title: 'Hỏi về học bổng', post_type: 'riseup_contact', post_status: 'private', post_content: 'Họ tên: An Nguyễn\nEmail: an@legacy.example.org\n\nXin chào, cho tôi hỏi.' }),
  post({ ID: 411, post_author: 0, post_title: '', post_type: 'riseup_contact', post_status: 'private', post_content: 'Tin nhắn không có email' }),
];
const pm = (post_id, meta_key, meta_value) => ({ post_id, meta_key, meta_value });
const postmeta = [
  pm(100, '_thumbnail_id', '200'), pm(100, '_post_likes', '12'), pm(100, '_edit_lock', '1:1'),
  pm(104, '_wp_trash_meta_time', '1790000000'),
  pm(106, '_submission', '1'),
  pm(107, '_submission', '1'), pm(107, '_submission_review', 'changes'), pm(107, '_submission_reason', 'Cần bổ sung nguồn.'),
  pm(108, '_submission', '1'), pm(108, '_submission_review', 'rejected'), pm(108, '_submission_reason', 'Không phù hợp.'),
  pm(200, '_wp_attached_file', '2026/08/a.png'), pm(201, '_wp_attached_file', '2026/08/gone.png'),
  pm(22, '_wp_page_template', 'page-contact.php'),
  pm(410, '_contact_email', 'an@legacy.example.org'), pm(410, '_contact_status', 'done'), pm(410, '_contact_mail', 'accepted'), pm(411, '_contact_mail', 'failed'),
];
const rel = [[100, 2], [100, 4], [100, 5], [101, 2], [110, 3], [111, 1]].map(([object_id, term_taxonomy_id]) => ({ object_id, term_taxonomy_id, term_order: 0 }));
const comment = (o) => ({ comment_ID: 0, comment_post_ID: 100, comment_author: 'Khách', comment_author_email: 'visitor@legacy.example.org', comment_author_url: '', comment_author_IP: '203.0.113.9', comment_date: '2026-08-03 10:00:00', comment_date_gmt: '2026-08-03 03:00:00', comment_content: '', comment_karma: 0, comment_approved: '1', comment_agent: 'UA', comment_type: 'comment', comment_parent: 0, user_id: 0, ...o });
const comments = [
  comment({ comment_ID: 1, comment_author: 'Thành viên Một', comment_content: '<b>Hay</b> quá!', user_id: 3 }),
  comment({ comment_ID: 2, comment_content: 'Cảm ơn bạn.', comment_parent: 1 }),
  comment({ comment_ID: 3, comment_content: 'Mua hàng giá rẻ http://spam.example', comment_approved: 'spam' }),
  comment({ comment_ID: 4, comment_content: 'Đã xoá', comment_approved: 'trash' }),
  comment({ comment_ID: 5, comment_content: 'pingback', comment_type: 'pingback' }),
  comment({ comment_ID: 6, comment_post_ID: 20, comment_content: 'Bình luận trên trang' }),
  comment({ comment_ID: 7, comment_content: 'Đang chờ', comment_approved: '0' }),
  comment({ comment_ID: 8, comment_post_ID: 999, comment_content: 'Bài không tồn tại' }),
];
const options = [
  ['siteurl', 'http://legacy.test/wp'], ['home', 'http://legacy.test/wp'], ['blogname', 'Legacy'], ['blogdescription', ''], ['timezone_string', 'Asia/Ho_Chi_Minh'], ['permalink_structure', '/%postname%/'],
  ['page_on_front', '23'], ['page_for_posts', '24'], ['users_can_register', '1'], ['default_role', 'subscriber'], ['date_format', 'd/m/Y'],
  ['mailserver_pass', 'SMTP-SECRET-MUST-NOT-IMPORT'], ['auth_key', 'AUTH-KEY-MUST-NOT-IMPORT'], ['active_plugins', 'a:0:{}'],
].map(([option_name, option_value], i) => ({ option_id: i + 1, option_name, option_value, autoload: 'yes' }));

const DDL = `
DROP TABLE IF EXISTS wp_users, wp_usermeta, wp_posts, wp_postmeta, wp_comments, wp_commentmeta, wp_terms, wp_term_taxonomy, wp_term_relationships, wp_options;
CREATE TABLE wp_users (ID bigint unsigned NOT NULL AUTO_INCREMENT, user_login varchar(60) NOT NULL DEFAULT '', user_pass varchar(255) NOT NULL DEFAULT '', user_nicename varchar(50) NOT NULL DEFAULT '', user_email varchar(100) NOT NULL DEFAULT '', user_url varchar(100) NOT NULL DEFAULT '', user_registered datetime NOT NULL DEFAULT '0000-00-00 00:00:00', user_activation_key varchar(255) NOT NULL DEFAULT '', user_status int NOT NULL DEFAULT 0, display_name varchar(250) NOT NULL DEFAULT '', PRIMARY KEY (ID)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_usermeta (umeta_id bigint unsigned NOT NULL AUTO_INCREMENT, user_id bigint unsigned NOT NULL DEFAULT 0, meta_key varchar(255) DEFAULT NULL, meta_value longtext, PRIMARY KEY (umeta_id)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_posts (ID bigint unsigned NOT NULL AUTO_INCREMENT, post_author bigint unsigned NOT NULL DEFAULT 0, post_date datetime NOT NULL DEFAULT '0000-00-00 00:00:00', post_date_gmt datetime NOT NULL DEFAULT '0000-00-00 00:00:00', post_content longtext NOT NULL, post_title text NOT NULL, post_excerpt text NOT NULL, post_status varchar(20) NOT NULL DEFAULT 'publish', comment_status varchar(20) NOT NULL DEFAULT 'open', ping_status varchar(20) NOT NULL DEFAULT 'open', post_password varchar(255) NOT NULL DEFAULT '', post_name varchar(200) NOT NULL DEFAULT '', to_ping text NOT NULL, pinged text NOT NULL, post_modified datetime NOT NULL DEFAULT '0000-00-00 00:00:00', post_modified_gmt datetime NOT NULL DEFAULT '0000-00-00 00:00:00', post_content_filtered longtext NOT NULL, post_parent bigint unsigned NOT NULL DEFAULT 0, guid varchar(255) NOT NULL DEFAULT '', menu_order int NOT NULL DEFAULT 0, post_type varchar(20) NOT NULL DEFAULT 'post', post_mime_type varchar(100) NOT NULL DEFAULT '', comment_count bigint NOT NULL DEFAULT 0, PRIMARY KEY (ID)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_postmeta (meta_id bigint unsigned NOT NULL AUTO_INCREMENT, post_id bigint unsigned NOT NULL DEFAULT 0, meta_key varchar(255) DEFAULT NULL, meta_value longtext, PRIMARY KEY (meta_id)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_comments (comment_ID bigint unsigned NOT NULL AUTO_INCREMENT, comment_post_ID bigint unsigned NOT NULL DEFAULT 0, comment_author tinytext NOT NULL, comment_author_email varchar(100) NOT NULL DEFAULT '', comment_author_url varchar(200) NOT NULL DEFAULT '', comment_author_IP varchar(100) NOT NULL DEFAULT '', comment_date datetime NOT NULL DEFAULT '0000-00-00 00:00:00', comment_date_gmt datetime NOT NULL DEFAULT '0000-00-00 00:00:00', comment_content text NOT NULL, comment_karma int NOT NULL DEFAULT 0, comment_approved varchar(20) NOT NULL DEFAULT '1', comment_agent varchar(255) NOT NULL DEFAULT '', comment_type varchar(20) NOT NULL DEFAULT 'comment', comment_parent bigint unsigned NOT NULL DEFAULT 0, user_id bigint unsigned NOT NULL DEFAULT 0, PRIMARY KEY (comment_ID)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_commentmeta (meta_id bigint unsigned NOT NULL AUTO_INCREMENT, comment_id bigint unsigned NOT NULL DEFAULT 0, meta_key varchar(255) DEFAULT NULL, meta_value longtext, PRIMARY KEY (meta_id)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_terms (term_id bigint unsigned NOT NULL AUTO_INCREMENT, name varchar(200) NOT NULL DEFAULT '', slug varchar(200) NOT NULL DEFAULT '', term_group bigint NOT NULL DEFAULT 0, PRIMARY KEY (term_id)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_term_taxonomy (term_taxonomy_id bigint unsigned NOT NULL AUTO_INCREMENT, term_id bigint unsigned NOT NULL DEFAULT 0, taxonomy varchar(32) NOT NULL DEFAULT '', description longtext NOT NULL, parent bigint unsigned NOT NULL DEFAULT 0, count bigint NOT NULL DEFAULT 0, PRIMARY KEY (term_taxonomy_id)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_term_relationships (object_id bigint unsigned NOT NULL DEFAULT 0, term_taxonomy_id bigint unsigned NOT NULL DEFAULT 0, term_order int NOT NULL DEFAULT 0, PRIMARY KEY (object_id, term_taxonomy_id)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE wp_options (option_id bigint unsigned NOT NULL AUTO_INCREMENT, option_name varchar(191) NOT NULL DEFAULT '', option_value longtext NOT NULL, autoload varchar(20) NOT NULL DEFAULT 'yes', PRIMARY KEY (option_id)) DEFAULT CHARSET=utf8mb4;
`;
const sql = `-- SYNTHETIC FIXTURE (generated by build-mini.mjs). No real data.\nSET NAMES utf8mb4;\n${DDL}\n`
  + insert('wp_users', wpUsers) + insert('wp_usermeta', usermeta) + insert('wp_posts', posts) + insert('wp_postmeta', postmeta)
  + insert('wp_comments', comments) + insert('wp_terms', terms.map(([term_id, name, slug]) => ({ term_id, name, slug, term_group: 0 })))
  + insert('wp_term_taxonomy', terms.map(([term_id, , , taxonomy]) => ({ term_taxonomy_id: term_id, term_id, taxonomy, description: '', parent: 0, count: 0 })))
  + insert('wp_term_relationships', rel) + insert('wp_options', options);
writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'mini.sql'), sql);
console.log(`mini.sql written (${sql.length} bytes)`);
