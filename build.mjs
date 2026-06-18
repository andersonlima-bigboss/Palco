// Build do Palco: empacota src/main.jsx num único dist/index.html (offline, pronto pro GitHub Pages).
//   node build.mjs           -> gera dist/index.html (produção)
//   node build.mjs --watch   -> regenera a cada alteração em src/
//   node build.mjs --serve   -> watch + servidor local em http://localhost:8000
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import http from "http";

const WATCH = process.argv.includes("--watch") || process.argv.includes("--serve");
const SERVE = process.argv.includes("--serve");

const b64 = (p) => readFileSync(new URL(p, import.meta.url)).toString("base64");
const icon512 = `data:image/png;base64,${b64("./assets/icon-512.png")}`;
const icon192 = `data:image/png;base64,${b64("./assets/icon-192.png")}`;
const icon180 = `data:image/png;base64,${b64("./assets/icon-180.png")}`;
const manifest =
  "data:application/manifest+json," +
  JSON.stringify({
    name: "MyStage — Assistente de Performance", short_name: "MyStage", start_url: ".",
    display: "standalone", orientation: "portrait",
    background_color: "#14110D", theme_color: "#14110D",
    icons: [
      { src: icon192, sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: icon512, sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  }).replace(/#/g, "%23").replace(/"/g, "%22").replace(/ /g, "%20").replace(/,/g, "%2C").replace(/;/g, "%3B");

const page = (appJs) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>MyStage — Assistente de Performance</title>
<meta name="theme-color" content="#14110D">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="MyStage">
<link rel="icon" type="image/png" href="${icon192}">
<link rel="apple-touch-icon" href="${icon180}">
<link rel="manifest" href="${manifest}">
<style>
  html,body{margin:0;padding:0;height:100%;background:#14110D;overscroll-behavior:none;}
  #root{height:100%;}
  *{-webkit-tap-highlight-color:transparent;}
</style>
</head>
<body>
<div id="root"></div>
<script>${appJs}</script>
</body>
</html>
`;

const inlinePlugin = {
  name: "inline-html",
  setup(build) {
    build.onEnd((result) => {
      const js = (result.outputFiles || []).find((f) => f.path.endsWith(".js"));
      if (!js) { console.error("Falha no build."); return; }
      mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
      const html = page(js.text.replace(/<\/script>/g, "<\\/script>"));
      writeFileSync(new URL("./dist/index.html", import.meta.url), html);
      // Também grava index.html na raiz, que é o que o GitHub Pages publica.
      writeFileSync(new URL("./index.html", import.meta.url), html);
      console.log("✓ index.html (raiz) e dist/index.html atualizados —", new Date().toLocaleTimeString());
    });
  },
};

const options = {
  entryPoints: ["src/main.jsx"],
  bundle: true, minify: true, format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "dist/app.js", write: false,
  loader: { ".jsx": "jsx" },
  plugins: [inlinePlugin],
  logLevel: "error",
};

if (WATCH) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Observando alterações em src/ …");
  if (SERVE) {
    http.createServer((req, res) => {
      try {
        const html = readFileSync(new URL("./dist/index.html", import.meta.url));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (e) {
        res.writeHead(500); res.end("Build ainda não gerado. Salve um arquivo em src/.");
      }
    }).listen(8000, () => console.log("Dev em http://localhost:8000  (atualize a página após salvar)"));
  }
} else {
  await esbuild.build(options);
  console.log("Build concluído. Publique o arquivo dist/index.html.");
}
