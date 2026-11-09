#!/usr/bin/env node
// Builds the approvals page as static files: sign/main.tsx → dist/.
//
//   node scripts/build.mjs
//
// Output: index.html (CSP meta, subresource integrity), app-<hash>.js,
// app-<hash>.css, assets/<name>-<hash>.<ext> (fonts) and _headers (the HTTP
// headers for a host that reads a _headers file). The page fetches nothing at
// run time: connect-src 'none', since an injected wallet runs its RPC outside
// the page. The build fails on a CRX host, an RPC URL or an image file in the
// bundle.

import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "dist");
if (path.basename(out) !== "dist" || path.dirname(out) !== root.replace(/\/$/, "")) throw new Error(`build: unexpected out dir ${out}`);

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

// The bundle takes each listed pair's symbol and feed id from
// pairs.config.json (the feed id names a price source on screen).
const listedPairsOnly = {
  name: "listed-pairs-only",
  setup(b) {
    b.onLoad({ filter: /pairs\.config\.json$/ }, async (args) => {
      const cfg = JSON.parse(await fs.promises.readFile(args.path, "utf8"));
      const pairs = cfg.pairs.filter((p) => p.listed === true).map((p) => ({ symbol: p.symbol, listed: true, feedId: p.feedId }));
      return { contents: JSON.stringify({ pairs }), loader: "json" };
    });
  },
};

// Each token(--gs-breakpoint-*) in a media or container query becomes its
// value from app/discover/skin-gs/tokens.css.
const require = createRequire(import.meta.url);
const postcss = require("postcss");
const queryTokens = require("./postcss-discover-tokens.cjs");
const discoverQueryTokens = {
  name: "discover-query-tokens",
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const text = await fs.promises.readFile(args.path, "utf8");
      const done = await postcss([queryTokens()]).process(text, { from: args.path });
      return { contents: done.css, loader: "css", resolveDir: path.dirname(args.path) };
    });
  },
};

fs.rmSync(out, { recursive: true, force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { app: "sign/main.tsx" },
  outdir: out,
  entryNames: "[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  chunkNames: "[name]-[hash]",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  loader: { ".png": "file", ".svg": "file", ".jpg": "file", ".webp": "file", ".woff2": "file", ".woff": "file" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [listedPairsOnly, discoverQueryTokens],
  metafile: true,
  logLevel: "warning",
});

const outputs = Object.keys(result.metafile.outputs).map((p) => path.resolve(root, p));
const js = outputs.find((p) => /\/app-[^/]+\.js$/.test(p));
const css = outputs.find((p) => /\/app-[^/]+\.css$/.test(p));
if (!js) throw new Error("build: no app js");

// No CRX host, no RPC endpoint and no image file in the output.
const BANNED = [/crxfx/i, /infura\.io/i, /alchemy(api)?\.(io|com)/i, /publicnode/i, /llamarpc/i, /ankr\.com/i, /cloudflare-eth/i, /quiknode|quicknode/i, /drpc\.org/i, /wss?:\/\//i];
const image = outputs.find((p) => /\.(png|svg|jpe?g|webp)$/i.test(p));
if (image) throw new Error(`build: the output carries ${path.basename(image)}`);
const urls = new Set();
for (const p of outputs.filter((x) => /\.(js|css)$/.test(x))) {
  const text = fs.readFileSync(p, "utf8");
  if (p.endsWith(".css") && text.includes("token(")) throw new Error(`build: ${path.basename(p)} keeps a token() query`);
  for (const re of BANNED) {
    const m = text.match(re);
    if (m) throw new Error(`build: ${path.basename(p)} carries "${m[0]}" (${re})`);
  }
  for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) urls.add(m[0]);
}

const sri = (p) => `sha384-${createHash("sha384").update(fs.readFileSync(p)).digest("base64")}`;
const rel = (p) => `./${path.relative(out, p)}`;
const head = [
  css ? `<link rel="stylesheet" href="${rel(css)}" integrity="${sri(css)}" />` : "",
  `<script type="module" src="${rel(js)}" integrity="${sri(js)}"></script>`,
]
  .filter(Boolean)
  .join("\n    ");
const html = fs.readFileSync(path.join(root, "sign/index.html"), "utf8").replace("%CSP%", CSP).replace("%HEAD%", head);
fs.writeFileSync(path.join(out, "index.html"), html);

const headers = `/*
  Content-Security-Policy: ${CSP}; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/index.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache

/app-*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
fs.writeFileSync(path.join(out, "_headers"), headers);

const size = outputs.reduce((n, p) => n + fs.statSync(p).size, 0);
console.log(`build: ${outputs.length} files, ${Math.round(size / 1024)} KiB → ${path.relative(process.cwd(), out) || out}`);
console.log(`build: URL strings in the bundle (text only, never fetched): ${[...urls].sort().join(" ") || "none"}`);
