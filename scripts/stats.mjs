// Generates assets/stats.svg from the GitHub GraphQL API.
// Private repositories are counted, but only aggregated numbers are drawn:
// no repository names, only language names, counts and hours.
//
// Usage: GH_TOKEN=<token> node scripts/stats.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const LOGIN = process.env.STATS_USER || "jin-codes";
const OUT = process.env.STATS_OUT || "assets/stats.svg";
const TZ_OFFSET_HOURS = Number(process.env.STATS_TZ_OFFSET ?? 9); // KST
const TZ_LABEL = process.env.STATS_TZ_LABEL || "KST";

if (!TOKEN) {
  console.error("GH_TOKEN (or GITHUB_TOKEN) is required");
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-generator",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ---------- fetch ----------
const userData = await gql(
  `query($login: String!) {
    user(login: $login) {
      id name login createdAt
      followers { totalCount }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`,
  { login: LOGIN },
);
const user = userData.user;
const cc = user.contributionsCollection;

const repos = [];
let cursor = null;
do {
  const data = await gql(
    `query($login: String!, $id: ID!, $after: String) {
      user(login: $login) {
        repositories(first: 40, after: $after, ownerAffiliations: OWNER, isFork: false) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isPrivate stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name color } }
            }
            defaultBranchRef {
              target {
                ... on Commit {
                  history(first: 100, author: { id: $id }) {
                    totalCount
                    nodes { committedDate }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { login: LOGIN, id: user.id, after: cursor },
  );
  const page = data.user.repositories;
  repos.push(...page.nodes);
  cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (cursor);

// ---------- compute ----------
const publicRepos = repos.filter((r) => !r.isPrivate).length;
const privateRepos = repos.length - publicRepos;
const stars = repos.reduce((n, r) => n + r.stargazerCount, 0);
const totalCommits = repos.reduce(
  (n, r) => n + (r.defaultBranchRef?.target?.history?.totalCount ?? 0),
  0,
);

// languages (bytes, aggregated across all owned non-fork repos)
const langMap = new Map();
for (const r of repos) {
  for (const e of r.languages.edges) {
    const cur = langMap.get(e.node.name) ?? { size: 0, color: e.node.color || "#8b949e" };
    cur.size += e.size;
    langMap.set(e.node.name, cur);
  }
}
const langTotal = [...langMap.values()].reduce((n, l) => n + l.size, 0) || 1;
const langs = [...langMap.entries()]
  .map(([name, v]) => ({ name, color: v.color, size: v.size }))
  .sort((a, b) => b.size - a.size);
const TOP_LANGS = 6;
const shownLangs = langs.slice(0, TOP_LANGS);
const otherSize = langs.slice(TOP_LANGS).reduce((n, l) => n + l.size, 0);
if (otherSize > 0) shownLangs.push({ name: "Other", color: "#8b949e", size: otherSize });

// commit hours (from the latest 100 commits per repo)
const hours = new Array(24).fill(0);
for (const r of repos) {
  for (const n of r.defaultBranchRef?.target?.history?.nodes ?? []) {
    const h = (new Date(n.committedDate).getUTCHours() + TZ_OFFSET_HOURS + 24) % 24;
    hours[h] += 1;
  }
}

// contribution calendar
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const weekly = cc.contributionCalendar.weeks.map((w) =>
  w.contributionDays.reduce((n, d) => n + d.contributionCount, 0),
);
const todayStr = new Date().toISOString().slice(0, 10);
let longest = 0;
let run = 0;
for (const d of days) {
  run = d.contributionCount > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
}
let current = 0;
{
  let i = days.length - 1;
  if (days[i] && days[i].date >= todayStr && days[i].contributionCount === 0) i -= 1;
  while (i >= 0 && days[i].contributionCount > 0) {
    current += 1;
    i -= 1;
  }
}
const activeDays = days.filter((d) => d.contributionCount > 0).length;

// ---------- render ----------
const W = 900;
const H = 560;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const f1 = (n) => n.toFixed(1);

const parts = [];

// header
const title = user.name ? `${user.login} (${user.name})` : user.login;
parts.push(`<text x="30" y="46" class="fg title">${esc(title)}</text>`);
parts.push(
  `<text x="${W - 30}" y="46" text-anchor="end" class="muted small">Updated ${esc(todayStr)}</text>`,
);

// stat tiles
const tiles = [
  ["Contributions (1y)", fmt(cc.contributionCalendar.totalContributions)],
  ["Commits (all time)", fmt(totalCommits)],
  ["Repositories", `${repos.length}`, `${publicRepos} public · ${privateRepos} private`],
  ["Pull requests (1y)", fmt(cc.totalPullRequestContributions)],
  ["Stars", fmt(stars)],
];
const tileW = (W - 60 - 4 * 12) / 5;
tiles.forEach(([label, value, sub], i) => {
  const x = 30 + i * (tileW + 12);
  parts.push(`<rect x="${x}" y="70" width="${tileW}" height="84" rx="8" class="tile"/>`);
  parts.push(`<text x="${x + 14}" y="102" class="fg big">${esc(value)}</text>`);
  parts.push(`<text x="${x + 14}" y="124" class="muted small">${esc(label)}</text>`);
  if (sub) parts.push(`<text x="${x + 14}" y="141" class="muted tiny">${esc(sub)}</text>`);
});

// languages panel
const LX = 30;
const LY = 184;
const LW = 410;
parts.push(`<text x="${LX}" y="${LY + 8}" class="fg h2">Languages</text>`);
let bx = LX;
shownLangs.forEach((l) => {
  const w = (l.size / langTotal) * LW;
  parts.push(`<rect x="${f1(bx)}" y="${LY + 26}" width="${f1(Math.max(w, 1))}" height="10" fill="${esc(l.color)}"/>`);
  bx += w;
});
shownLangs.forEach((l, i) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const x = LX + col * 205;
  const y = LY + 66 + row * 30;
  const pct = ((l.size / langTotal) * 100).toFixed(1);
  parts.push(`<circle cx="${x + 6}" cy="${y - 5}" r="6" fill="${esc(l.color)}"/>`);
  parts.push(`<text x="${x + 20}" y="${y}" class="fg body">${esc(l.name)} <tspan class="muted">${pct}%</tspan></text>`);
});

// activity panel
const AX = 470;
const AY = 184;
const AW = 400;
const AH = 110;
parts.push(`<text x="${AX}" y="${AY + 8}" class="fg h2">Activity</text>`);
parts.push(`<text x="${AX + AW}" y="${AY + 8}" text-anchor="end" class="muted small">weekly contributions, last year</text>`);
{
  const top = AY + 28;
  const max = Math.max(...weekly, 1);
  const pts = weekly.map((v, i) => [AX + (i / Math.max(weekly.length - 1, 1)) * AW, top + AH - (v / max) * AH]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${f1(x)} ${f1(y)}`).join(" ");
  parts.push(`<path d="${line} L${f1(AX + AW)} ${top + AH} L${AX} ${top + AH} Z" class="area"/>`);
  parts.push(`<path d="${line}" class="linepath"/>`);
  parts.push(`<line x1="${AX}" y1="${top + AH}" x2="${AX + AW}" y2="${top + AH}" class="axis"/>`);
  parts.push(`<text x="${AX}" y="${top + AH + 16}" class="muted tiny">${esc(days[0].date.slice(0, 7))}</text>`);
  parts.push(
    `<text x="${AX + AW}" y="${top + AH + 16}" text-anchor="end" class="muted tiny">${esc(days[days.length - 1].date.slice(0, 7))}</text>`,
  );
  parts.push(`<text x="${AX + AW}" y="${top - 4}" text-anchor="end" class="muted tiny">peak ${fmt(max)}/week</text>`);
}

// commit hours panel
const HX = 30;
const HY = 366;
const HW = 410;
const HH = 100;
parts.push(`<text x="${HX}" y="${HY + 8}" class="fg h2">Commit hours</text>`);
parts.push(`<text x="${HX + HW}" y="${HY + 8}" text-anchor="end" class="muted small">${esc(TZ_LABEL)}, recent commits</text>`);
{
  const top = HY + 28;
  const max = Math.max(...hours, 1);
  const slot = HW / 24;
  hours.forEach((v, h) => {
    const bh = (v / max) * HH;
    parts.push(
      `<rect x="${f1(HX + h * slot + 1)}" y="${f1(top + HH - bh)}" width="${f1(slot - 2)}" height="${f1(Math.max(bh, v ? 1 : 0))}" rx="2" class="bar"/>`,
    );
  });
  parts.push(`<line x1="${HX}" y1="${top + HH}" x2="${HX + HW}" y2="${top + HH}" class="axis"/>`);
  [0, 6, 12, 18, 23].forEach((h) => {
    parts.push(
      `<text x="${f1(HX + h * slot + slot / 2)}" y="${top + HH + 16}" text-anchor="middle" class="muted tiny">${h}</text>`,
    );
  });
}

// streak panel
const SX = 470;
const SY = 366;
parts.push(`<text x="${SX}" y="${SY + 8}" class="fg h2">Streak</text>`);
const streakItems = [
  [fmt(current), "Current streak", "days"],
  [fmt(longest), "Longest streak", "days"],
  [fmt(activeDays), "Active days", "last year"],
];
streakItems.forEach(([value, label, sub], i) => {
  const x = SX + i * 135;
  parts.push(`<text x="${x}" y="${SY + 70}" class="fg big">${esc(value)}</text>`);
  parts.push(`<text x="${x}" y="${SY + 94}" class="fg body">${esc(label)}</text>`);
  parts.push(`<text x="${x}" y="${SY + 112}" class="muted tiny">${esc(sub)}</text>`);
});

// footer
parts.push(
  `<text x="30" y="${H - 22}" class="muted tiny">Includes private repositories (aggregated only). Generated by scripts/stats.mjs</text>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub stats for ${esc(user.login)}">
<style>
  :root { --bg:#ffffff; --border:#d0d7de; --tile:#f6f8fa; --fg:#1f2328; --muted:#656d76; --accent:#0969da; --axis:#d0d7de; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --border:#30363d; --tile:#161b22; --fg:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --axis:#30363d; }
  }
  text { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  .card { fill: var(--bg); stroke: var(--border); }
  .tile { fill: var(--tile); }
  .fg { fill: var(--fg); }
  .muted { fill: var(--muted); }
  .title { font-size: 24px; font-weight: 600; }
  .h2 { font-size: 15px; font-weight: 600; }
  .big { font-size: 26px; font-weight: 700; }
  .body { font-size: 14px; }
  .small { font-size: 12px; }
  .tiny { font-size: 11px; }
  .area { fill: var(--accent); fill-opacity: 0.18; }
  .linepath { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
  .bar { fill: var(--accent); }
  .axis { stroke: var(--axis); stroke-width: 1; }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" class="card"/>
${parts.join("\n")}
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(
  `wrote ${OUT}: ${repos.length} repos (${publicRepos} public, ${privateRepos} private), ${totalCommits} commits, ${shownLangs.length} languages`,
);
