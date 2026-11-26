/**
 * Gera assets/stats.svg — radar de linguagens, barras e contadores do perfil.
 *
 * Uso:
 *   GITHUB_TOKEN=... node scripts/stats.mjs   (ou GH_TOKEN)
 *
 * Usado pela GitHub Action .github/workflows/stats.yml para atualizar o README.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.STATS_USER || "Juholiver";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "stats.svg");

if (!TOKEN) {
  console.error("Defina GITHUB_TOKEN ou GH_TOKEN antes de rodar o script.");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

async function apiAll(url) {
  const items = [];
  for (let page = 1; ; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const batch = await api(`${url}${sep}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Cores vibrantes (padrão GitHub ajustado para fundo escuro). */
const COLORS = {
  HTML: "#e44d26",
  CSS: "#ec4899",
  TypeScript: "#8b5cf6",
  Python: "#3b82f6",
  JavaScript: "#f7df1e",
  "C#": "#178600",
  C: "#7f8fa6",
  "C++": "#f34b7d",
  Java: "#b07219",
  PHP: "#4F5D95",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#e0115f",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  SCSS: "#c6538c",
  Sass: "#cd6799",
  Shell: "#89e051",
  "Jupyter Notebook": "#DA5B0B",
  Dockerfile: "#384d54",
  Lua: "#5656e6",
  PowerShell: "#012456",
  Markdown: "#083fa1",
  YAML: "#cb171e",
  Makefile: "#427819",
};
const FALLBACK = "#8b949e";
const colorOf = (lang) => COLORS[lang] || FALLBACK;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => n.toLocaleString("pt-BR");
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pctText = (v) => {
  if (v >= 10) return `${Math.round(v)}%`;
  const s = v.toFixed(1);
  return s.endsWith(".0") ? `${Math.round(v)}%` : `${s}%`;
};

// ---------------------------------------------------------------- coleta
async function collect() {
  const [profile, repos] = await Promise.all([
    api(`https://api.github.com/users/${USER}`),
    apiAll(`https://api.github.com/users/${USER}/repos?type=owner&sort=updated`),
  ]);

  // Bytes por linguagem somando todos os repositórios próprios com código.
  const targets = repos.filter((r) => r.size > 0 && !r.fork);
  const results = await pool(targets, 12, (r) =>
    api(`https://api.github.com/repos/${r.full_name}/languages`).catch((err) => {
      console.warn(`aviso: languages de ${r.full_name} falhou — ${err.message}`);
      return {};
    })
  );

  const totals = new Map();
  for (const langs of results) {
    for (const [name, bytes] of Object.entries(langs)) {
      totals.set(name, (totals.get(name) || 0) + bytes);
    }
  }
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);
  const languages = [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes, pct: grand ? (bytes / grand) * 100 : 0 }))
    .sort((a, b) => b.bytes - a.bytes);

  const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [commitSearch, prSearch] = await Promise.all([
    api(
      `https://api.github.com/search/commits?q=${encodeURIComponent(
        `author:${USER} author-date:>=${yearAgo}`
      )}&per_page=1`
    ),
    api(`https://api.github.com/search/issues?q=${encodeURIComponent(`type:pr author:${USER}`)}&per_page=1`),
  ]);

  return {
    languages,
    counters: {
      repos: profile.public_repos ?? repos.length,
      commits: commitSearch.total_count,
      prs: prSearch.total_count,
      stars: repos.reduce((s, r) => s + r.stargazers_count, 0),
    },
    today: new Date().toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------- desenho
const FONT = "Segoe UI, Helvetica, Arial, sans-serif";
const GREEN = "#3fb950";
const CARD_BG = "#0d1117";
const CARD_BORDER = "#30363d";
const MUTED = "#8b949e";
const TEXT = "#e6edf3";

const W = 840;
const H = 452;
const card = (x, y, w, h) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${CARD_BG}" stroke="${CARD_BORDER}" stroke-width="1"/>`;

function radarCard(top) {
  const cx = 205;
  const cy = 185;
  const R = 100;
  const n = Math.max(top.length, 3);
  const angle = (i) => ((-90 + (i * 360) / n) * Math.PI) / 180;
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  const poly = (radii) =>
    radii.map((r, i) => pt(i, r).map((v) => v.toFixed(1)).join(",")).join(" ");

  const rings = [0.25, 0.5, 0.75, 1]
    .map(
      (k) =>
        `<polygon points="${poly(Array(n).fill(R * k))}" fill="none" stroke="${CARD_BORDER}" stroke-width="1"/>`
    )
    .join("\n  ");
  const axes = top
    .map((_, i) => {
      const [x, y] = pt(i, R);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${CARD_BORDER}" stroke-width="1"/>`;
    })
    .join("\n  ");

  const max = top[0]?.pct || 1;
  const radii = top.map((l) => R * Math.sqrt(Math.max(l.pct, 0) / max));
  const dataPoly = `<polygon points="${poly(radii)}" fill="${GREEN}" fill-opacity="0.22" stroke="${GREEN}" stroke-width="2" stroke-linejoin="round"/>`;
  const dots = radii
    .map((r, i) => {
      const [x, y] = pt(i, r);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${GREEN}"/>`;
    })
    .join("\n  ");
  const labels = top
    .map((l, i) => {
      const cos = Math.cos(angle(i));
      const sin = Math.sin(angle(i));
      const x = cx + (R + 16) * cos;
      const y = cy + (R + 16) * sin;
      let anchor = "middle";
      if (cos > 0.3) anchor = "start";
      else if (cos < -0.3) anchor = "end";
      let dy = 4;
      if (sin < -0.3) dy = -6;
      else if (sin > 0.3) dy = 16;
      return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" font-family="${FONT}" font-size="13" fill="${TEXT}">${esc(short(l.name, 12))}</text>`;
    })
    .join("\n  ");

  return `
  ${card(0, 0, 410, 344)}
  <text x="18" y="32" font-family="${FONT}" font-size="14" font-weight="600" fill="${GREEN}">Radar de linguagens</text>
  ${rings}
  ${axes}
  ${dataPoly}
  ${dots}
  ${labels}
  <text x="205" y="336" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}">Proporção de código por linguagem, escala raiz quadrada</text>`;
}

function langsCard(languages, today) {
  const top = languages.slice(0, 4);
  const x0 = 448;
  const barW = 374;
  const max = top[0]?.pct || 1;

  const stops = languages.slice(0, 6);
  const legendStops = stops.length
    ? stops
        .map((l, i) => {
          const off = stops.length === 1 ? 0.5 : i / (stops.length - 1);
          return `<stop offset="${off.toFixed(3)}" stop-color="${colorOf(l.name)}"/>`;
        })
        .join("")
    : `<stop offset="0" stop-color="${FALLBACK}"/>`;

  const rows = top
    .map((l, i) => {
      const baseline = 82 + i * 62;
      const color = colorOf(l.name);
      const w = Math.max((l.pct / max) * barW, 2);
      return `
  <circle cx="${x0 + 6}" cy="${baseline - 4}" r="5" fill="${color}"/>
  <text x="${x0 + 20}" y="${baseline}" font-family="${FONT}" font-size="13" fill="${TEXT}">${esc(l.name)}</text>
  <text x="${x0 + barW}" y="${baseline}" text-anchor="end" font-family="${FONT}" font-size="13" font-weight="600" fill="${TEXT}">${pctText(l.pct)}</text>
  <rect x="${x0}" y="${baseline + 12}" width="${barW}" height="8" rx="4" fill="#21262d"/>
  <rect x="${x0}" y="${baseline + 12}" width="${w.toFixed(1)}" height="8" rx="4" fill="${color}"/>`;
    })
    .join("");

  return `
  ${card(430, 0, 410, 344)}
  <text x="${x0}" y="32" font-family="${FONT}" font-size="14" font-weight="600" fill="${GREEN}">Principais linguagens</text>
  <rect x="${x0}" y="46" width="${barW}" height="6" rx="3" fill="url(#legend)"/>
  ${rows}
  <text x="${x0}" y="336" font-family="${FONT}" font-size="11" fill="${MUTED}">atualizado em ${today}</text>`;
}

function countersCard(counters) {
  const items = [
    ["Repositórios", counters.repos],
    ["Commits no último ano", counters.commits],
    ["Pull requests", counters.prs],
    ["Estrelas recebidas", counters.stars],
  ];
  return items
    .map(([label, value], i) => {
      const x = i * 214;
      return `
  ${card(x, 360, 198, 92)}
  <text x="${x + 99}" y="392" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${MUTED}">${label}</text>
  <text x="${x + 99}" y="434" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="${GREEN}">${fmt(value)}</text>`;
    })
    .join("");
}

function buildSvg({ languages, counters, today }) {
  const top = languages.slice(0, 4);
  const stops = languages.slice(0, 6);
  const legendStops = stops.length
    ? stops
        .map((l, i) => {
          const off = stops.length === 1 ? 0.5 : i / (stops.length - 1);
          return `<stop offset="${off.toFixed(3)}" stop-color="${colorOf(l.name)}"/>`;
        })
        .join("")
    : `<stop offset="0" stop-color="${FALLBACK}"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="stats-title">
  <title id="stats-title">Linguagens e atividade do GitHub de ${esc(USER)}</title>
  <defs>
    <linearGradient id="legend" x1="0" y1="0" x2="1" y2="0">${legendStops}</linearGradient>
  </defs>${radarCard(top)}
  ${langsCard(languages, today)}
  ${countersCard(counters)}
</svg>
`;
}

// ---------------------------------------------------------------- main
try {
  const data = await collect();
  const svg = buildSvg(data);
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, svg, "utf8");
  console.log(
    `OK: ${OUT_FILE} — ${data.languages.length} linguagens, ` +
      `${data.counters.repos} repositórios, ${data.counters.commits} commits (12 meses), ` +
      `${data.counters.prs} PRs, ${data.counters.stars} estrelas`
  );
} catch (err) {
  console.error(err);
  process.exit(1);
}
