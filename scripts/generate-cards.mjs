// Generates stats + top-language SVG cards (light & dark) from the GitHub GraphQL API.
// Usage: GH_TOKEN=... GH_USER=jongbonga node scripts/generate-cards.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const USER = process.env.GH_USER || 'jongbonga';
const TOKEN = process.env.GH_TOKEN;
const OUT = process.env.OUT_DIR || 'assets';

const QUERY = `
query($login:String!,$after:String){
  user(login:$login){
    name
    contributionsCollection{
      totalCommitContributions restrictedContributionsCount
      totalPullRequestContributions totalIssueContributions
      contributionCalendar{ totalContributions }
    }
    pullRequests{ totalCount }
    issues{ totalCount }
    repositories(ownerAffiliations:OWNER,isFork:false,first:100,after:$after){
      totalCount
      pageInfo{ hasNextPage endCursor }
      nodes{
        stargazerCount
        languages(first:10,orderBy:{field:SIZE,direction:DESC}){
          edges{ size node{ name color } }
        }
      }
    }
  }
}`;

async function gql(variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

const CAL_QUERY = `
query($login:String!,$from:DateTime!,$to:DateTime!){
  user(login:$login){
    createdAt
    contributionsCollection(from:$from,to:$to){
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } }
    }
  }
}`;

async function calendarYear(year) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CAL_QUERY, variables: { login: USER, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

// Every day with its contribution count, from account creation to today.
async function fetchDays() {
  if (process.env.MOCK) return mockDays();
  const first = await calendarYear(new Date().getUTCFullYear());
  const startYear = new Date(first.createdAt).getUTCFullYear();
  const days = new Map();
  for (let y = startYear; y <= new Date().getUTCFullYear(); y++) {
    const u = y === new Date().getUTCFullYear() ? first : await calendarYear(y);
    for (const w of u.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
  }
  return days;
}

function mockDays() {
  const days = new Map(), today = new Date();
  for (let i = 0; i < 900; i++) {
    const d = new Date(today - i * 864e5).toISOString().slice(0, 10);
    days.set(d, i % 11 === 0 || (i > 20 && i < 70) ? 0 : (i * 7) % 5 + (i < 9 ? 1 : 0));
  }
  return days;
}

const addDay = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

function computeStreaks(days) {
  const keys = [...days.keys()].sort();
  const today = new Date().toISOString().slice(0, 10);
  let total = 0, best = { len: 0, start: null, end: null }, run = { len: 0, start: null, end: null };
  for (const k of keys) {
    const n = days.get(k);
    total += n;
    if (n > 0) {
      run = run.len > 0 && run.end === addDay(k, -1) ? { ...run, len: run.len + 1, end: k } : { len: 1, start: k, end: k };
      if (run.len > best.len) best = { ...run };
    } else run = { len: 0, start: null, end: null };
  }
  // Current streak counts back from today, or from yesterday if today has no activity yet.
  let cur = { len: 0, start: null, end: null }, d = (days.get(today) || 0) > 0 ? today : addDay(today, -1);
  while ((days.get(d) || 0) > 0) { cur = { len: cur.len + 1, start: d, end: cur.end || d }; d = addDay(d, -1); }
  return { total, since: keys[0], cur, best };
}

async function fetchData() {
  if (process.env.MOCK) return mock();
  if (!TOKEN) throw new Error('GH_TOKEN is required');
  let after = null, user, repos = [];
  do {
    user = await gql({ login: USER, after });
    repos.push(...user.repositories.nodes);
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);
  const c = user.contributionsCollection;
  const langs = {};
  for (const r of repos)
    for (const e of r.languages.edges) {
      const l = (langs[e.node.name] ??= { size: 0, color: e.node.color || '#888888' });
      l.size += e.size;
    }
  return {
    name: user.name || USER,
    stats: {
      'Contributions (last year)': c.contributionCalendar.totalContributions,
      'Commits (last year)': c.totalCommitContributions + c.restrictedContributionsCount,
      'Pull requests': user.pullRequests.totalCount,
      'Issues': user.issues.totalCount,
      'Stars earned': repos.reduce((s, r) => s + r.stargazerCount, 0),
      'Repositories': user.repositories.totalCount,
    },
    langs,
  };
}

function mock() {
  return {
    name: 'Jonathan',
    stats: { 'Contributions (last year)': 412, 'Commits (last year)': 380, 'Pull requests': 57,
      'Issues': 12, 'Stars earned': 34, 'Repositories': 41 },
    langs: { TypeScript: { size: 500, color: '#3178c6' }, JavaScript: { size: 320, color: '#f1e05a' },
      SCSS: { size: 120, color: '#c6538c' }, HTML: { size: 90, color: '#e34c26' }, Vue: { size: 60, color: '#41b883' } },
  };
}

const THEMES = {
  light: { bg: '#ffffff', border: '#d0d7de', title: '#1f2328', text: '#59636e', track: '#eaeef2' },
  dark:  { bg: '#0d1117', border: '#30363d', title: '#e6edf3', text: '#8d96a0', track: '#21262d' },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const FONT = `font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"`;

function frame(t, w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
  <rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="8" fill="${t.bg}" stroke="${t.border}"/>
  <text x="24" y="36" ${FONT} font-size="17" font-weight="600" fill="${t.title}">${esc(title)}</text>
${body}
</svg>
`;
}

function statsCard(t, data) {
  const rows = Object.entries(data.stats).map(([k, v], i) => {
    const y = 68 + i * 26;
    return `  <text x="24" y="${y}" ${FONT} font-size="14" fill="${t.text}">${esc(k)}</text>
  <text x="371" y="${y}" ${FONT} font-size="14" font-weight="600" fill="${t.title}" text-anchor="end">${Number(v).toLocaleString('en-US')}</text>`;
  });
  return frame(t, 395, 68 + rows.length * 26 + 4, `${data.name}'s GitHub Stats`, rows.join('\n'));
}

function langsCard(t, data) {
  const list = Object.entries(data.langs).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const total = list.reduce((s, [, l]) => s + l.size, 0) || 1;
  const rows = list.map(([name, l], i) => {
    const y = 72 + i * 30, pct = (l.size / total) * 100, bw = Math.max(2, (pct / 100) * 347);
    return `  <text x="24" y="${y}" ${FONT} font-size="13" fill="${t.text}">${esc(name)}</text>
  <text x="371" y="${y}" ${FONT} font-size="13" fill="${t.text}" text-anchor="end">${pct.toFixed(1)}%</text>
  <rect x="24" y="${y + 6}" width="347" height="8" rx="4" fill="${t.track}"/>
  <rect x="24" y="${y + 6}" width="${bw.toFixed(1)}" height="8" rx="4" fill="${esc(l.color)}"/>`;
  });
  return frame(t, 395, 72 + list.length * 30 + 12, 'Top Languages', rows.join('\n'));
}

const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtShort = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function streakCard(t, s) {
  const col = (cx, big, label, sub, accent) => `  <text x="${cx}" y="88" ${FONT} font-size="34" font-weight="700" fill="${accent ? '#f78166' : t.title}" text-anchor="middle">${esc(big)}</text>
  <text x="${cx}" y="118" ${FONT} font-size="14" font-weight="${accent ? 600 : 400}" fill="${accent ? '#f78166' : t.title}" text-anchor="middle">${esc(label)}</text>
  <text x="${cx}" y="140" ${FONT} font-size="12" fill="${t.text}" text-anchor="middle">${esc(sub)}</text>`;
  const range = (r) => r.len ? `${fmtShort(r.start)} - ${fmtShort(r.end)}` : '-';
  const body = [
    col(87, s.total.toLocaleString('en-US'), 'Total Contributions', `${fmtDate(s.since)} - Present`),
    col(260, s.cur.len, 'Current Streak', range(s.cur), true),
    col(433, s.best.len, 'Longest Streak', s.best.len ? `${fmtDate(s.best.start)} - ${fmtDate(s.best.end)}` : '-'),
    `  <line x1="173" y1="60" x2="173" y2="150" stroke="${t.border}"/>`,
    `  <line x1="347" y1="60" x2="347" y2="150" stroke="${t.border}"/>`,
  ].join('\n');
  return frame(t, 520, 175, `${USER}'s Contribution Streak`, body);
}

const data = await fetchData();
const streak = computeStreaks(await fetchDays());
mkdirSync(OUT, { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  writeFileSync(`${OUT}/stats-${mode}.svg`, statsCard(t, data));
  writeFileSync(`${OUT}/langs-${mode}.svg`, langsCard(t, data));
  writeFileSync(`${OUT}/streak-${mode}.svg`, streakCard(t, streak));
}
console.log(`Wrote 6 cards to ${OUT}/`);
