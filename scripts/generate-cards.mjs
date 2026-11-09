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

const data = await fetchData();
mkdirSync(OUT, { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  writeFileSync(`${OUT}/stats-${mode}.svg`, statsCard(t, data));
  writeFileSync(`${OUT}/langs-${mode}.svg`, langsCard(t, data));
}
console.log(`Wrote 4 cards to ${OUT}/`);
