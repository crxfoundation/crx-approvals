#!/usr/bin/env node
// Prints the SHA-256 of each file in dist/. With a URL, also fetches each
// served file (index.html, app-*.js, app-*.css, assets/*) from that URL and
// compares the bytes. Exit code 1 on a difference.
//
//   node scripts/check.mjs [https://host/path/]

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("check: no dist/index.html; run npm run build");

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(dist, p));
  }
})(dist);
files.sort();

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const base = process.argv[2] ? new URL(process.argv[2].endsWith("/") ? process.argv[2] : `${process.argv[2]}/`) : null;
let differs = 0;
for (const rel of files) {
  const local = sha(fs.readFileSync(path.join(dist, rel)));
  if (!base || rel === "_headers") {
    console.log(`${local}  ${rel}`);
    continue;
  }
  const res = await fetch(new URL(rel, base), { redirect: "follow" });
  const remote = res.ok ? sha(Buffer.from(await res.arrayBuffer())) : `HTTP ${res.status}`;
  const same = remote === local;
  if (!same) differs++;
  console.log(`${local}  ${rel}  ${same ? "match" : `differs: ${remote}`}`);
}
if (base) console.log(differs ? `check: ${differs} file(s) differ from ${base.href}` : `check: every served file matches ${base.href}`);
process.exit(differs ? 1 : 0);
