// k6 load profile for the HBVL site (read-heavy public traffic + a small authenticated member population).
//   VUS / DURATION override the defaults (100 VUs for 5 minutes). BASE is the web origin (Next.js proxies /api/v1).
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter } from 'k6/metrics';

// BASE must equal the API's PUBLIC_ORIGIN (CSRF checks the Origin header).
const BASE = __ENV.BASE || 'http://localhost:3400';
const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '5m';
const MEMBERS = JSON.parse(__ENV.MEMBERS || '[]');
const POST_SLUGS = JSON.parse(__ENV.POST_SLUGS || '[]');
const MEMBER_VUS = Math.min(MEMBERS.length, Math.max(1, Math.round(VUS * 0.05)));
const writes = new Counter('hbvl_member_writes');

export const options = {
  noCookiesReset: true, // the member scenario keeps its session across iterations
  scenarios: {
    public: { executor: 'constant-vus', vus: VUS - MEMBER_VUS, duration: DURATION, exec: 'visitor' },
    members: { executor: 'constant-vus', vus: MEMBER_VUS, duration: DURATION, exec: 'member' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{kind:page}': ['p(95)<1500'],
    'http_req_duration{kind:api}': ['p(95)<600'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const page = (path, name) => {
  const r = http.get(`${BASE}${path}`, { tags: { kind: 'page', name } });
  check(r, { [`${name} 200`]: (x) => x.status === 200 });
  return r;
};
const api = (path, name) => {
  const r = http.get(`${BASE}/api/v1${path}`, { tags: { kind: 'api', name } });
  check(r, { [`${name} 200`]: (x) => x.status === 200 });
  return r;
};

export function visitor() {
  const roll = Math.random();
  if (roll < 0.3) page('/', 'home');
  else if (roll < 0.5) page(`/bai-viet/${pick(POST_SLUGS)}`, 'post');
  else if (roll < 0.65) page('/category/tin-tuc', 'category');
  else if (roll < 0.75) page(`/tim-kiem?q=${encodeURIComponent(pick(['hoc bong', 'dong thap', 'vuon len', 'sach']))}`, 'search');
  else if (roll < 0.83) page('/category/dong-du-ky/ban-do-vuon-len', 'map');
  else if (roll < 0.88) page('/en', 'home-en');
  else if (roll < 0.94) api('/map/summary?system=34', 'api-map-summary');
  else api('/posts?pageSize=12', 'api-posts');
  sleep(0.5 + Math.random() * 1.5); // think time
}

let session; // per-VU
function login() {
  const acct = MEMBERS[(__VU - 1) % MEMBERS.length];
  const csrf = http.get(`${BASE}/api/v1/auth/csrf`).json('csrfToken');
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ portal: 'MEMBER', identifier: acct.username, password: acct.password }), {
    headers: { 'content-type': 'application/json', origin: BASE, 'x-csrf-token': csrf },
    tags: { kind: 'api', name: 'login' },
  });
  if (!check(res, { 'login 200': (r) => r.status === 200 })) return null;
  return { csrf: res.json('csrfToken') };
}

export function member() {
  if (!session) session = login();
  if (!session) {
    sleep(5);
    return;
  }
  group('member', () => {
    const me = http.get(`${BASE}/api/v1/auth/me`, { tags: { kind: 'api', name: 'me' } });
    check(me, { 'me 200': (r) => r.status === 200 });
    api('/me/posts', 'my-posts');
    const slug = pick(POST_SLUGS);
    const post = http.get(`${BASE}/api/v1/posts/${slug}`, { tags: { kind: 'api', name: 'post-api' } });
    check(post, { 'post 200': (r) => r.status === 200 });
    if (post.status === 200) {
      const id = post.json('id');
      // double-submit CSRF: the header must equal the CURRENT cookie (the server may re-issue it on any response)
      const csrf = (http.cookieJar().cookiesForURL(BASE).hbvl_csrf || [session.csrf])[0];
      const h = { origin: BASE, 'x-csrf-token': csrf, 'content-type': 'application/json' };
      const put = http.put(`${BASE}/api/v1/posts/${id}/like`, null, { headers: h, tags: { kind: 'api', name: 'like' } });
      if (put.status >= 300) console.error(`like failed ${put.status} ${String(put.body).slice(0, 160)}`);
      check(put, { 'like ok': (r) => r.status === 200 || r.status === 204 });
      const del = http.del(`${BASE}/api/v1/posts/${id}/like`, null, { headers: h, tags: { kind: 'api', name: 'unlike' } });
      if (del.status >= 300) console.error(`unlike failed ${del.status} ${String(del.body).slice(0, 160)}`);
      check(del, { 'unlike ok': (r) => r.status === 200 || r.status === 204 });
      writes.add(2);
    }
  });
  sleep(1 + Math.random() * 2);
}
