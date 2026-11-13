// Optional production build: copies the site to dist/ and minifies JS and CSS.
// Cloudflare Pages: build command "npm install && npm run build", output directory "dist".
import { transform } from "esbuild";
import { cp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const SKIP = new Set(["node_modules", "dist", ".git", "supabase", "build.mjs", "package.json", "package-lock.json", "README.md", "DEPLOY.md", ".env.example", ".gitignore"]);
await rm("dist", { recursive: true, force: true });
for (const name of await readdir(".")) if (!SKIP.has(name)) await cp(name, join("dist", name), { recursive: true });

let saved = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { await walk(p); continue; }
    const ext = extname(p);
    if (ext !== ".js" && ext !== ".css") continue;
    const src = await readFile(p, "utf8");
    const out = await transform(src, { loader: ext === ".js" ? "js" : "css", minify: true, target: "es2019" });
    await writeFile(p, out.code); saved += src.length - out.code.length;
  }
}
await walk("dist");
console.log(`Built dist/ (saved ${(saved / 1024).toFixed(0)} KB by minifying)`);
