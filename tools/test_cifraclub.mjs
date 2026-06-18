// Teste de cleanCifraClub (mesma lógica do Palco.jsx). Uso: node tools/test_cifraclub.mjs oceans.txt
import { readFileSync } from "fs";
const QUALITIES = ["maj7","maj9","maj","min","dim7","dim","aug","sus2","sus4","sus","add9","add11","add","7M","13","11","9","7","6","5","4","2","m","M","°","º","\\+"].join("|");
const CHORD_RE = new RegExp(`^\\(?[A-G][#b]?(?:${QUALITIES})*(?:\\([#b]?\\d+\\))?(?:\\/[A-G][#b]?)?\\)?$`);
const STRUCT_RE = /^(\||x\d+|%|\(\d+x?\)|N\.?C\.?|–|-|:|\.{2,}|…)$/i;
function isChordLine(line) {
  const t = line.trim(); if (!t) return false;
  const tokens = t.split(/\s+/); let hits = 0, real = 0;
  for (const tk of tokens) { if (CHORD_RE.test(tk)) { hits++; real++; } else if (STRUCT_RE.test(tk)) hits++; }
  return real >= 1 && hits / tokens.length >= 0.7;
}
function cleanCifraClub(raw) {
  const lines = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  const title = nonEmpty[0] || "Música";
  const tom = lines.find((l) => /^\s*tom\s*:/i.test(l));
  const afin = lines.find((l) => /^\s*afina[cç][aã]o\s*:/i.test(l));
  const cifraStart = lines.findIndex((l) => /^\s*\[.+\]\s*$/.test(l));
  let body = cifraStart !== -1 ? lines.slice(cifraStart) : lines;
  let di = -1;
  for (let i = 0; i < body.length; i++) { const t = body[i].trim(); if (t && /^[\dªº\s]+$/.test(t) && /\d/.test(t) && !isChordLine(t)) { di = i; break; } }
  if (di !== -1) { let cut = di; for (let k = di - 1; k >= 0; k--) { const t = body[k].trim(); if (t === "" || isChordLine(t)) cut = k; else break; } body = body.slice(0, cut); }
  const bodyStr = body.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
  const head = [`Título: ${title}`];
  if (tom) head.push(tom.trim());
  if (afin) head.push(afin.trim());
  return head.join("\n") + "\n\n" + bodyStr;
}
function cleanCifraClubText(raw) {
  const lines = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let title = "Música";
  const bc = lines.find((l) => /p[áa]gina inicial/i.test(l) && l.includes("►"));
  if (bc) { const segs = bc.split("►").map((s) => s.trim()).filter(Boolean); if (segs.length) title = segs[segs.length - 1]; }
  const tom = lines.find((l) => /^\s*tom\s*:/i.test(l));
  const afin = lines.find((l) => /^\s*afina[cç][aã]o\s*:/i.test(l));
  const cifraStart = lines.findIndex((l) => /^\s*\[.+\]/.test(l));
  let body = cifraStart !== -1 ? lines.slice(cifraStart) : lines;
  const footRe = /^(composi[çc][aã]o de |colabora[çc][aã]o e revis|conseguiu tocar|auto rolagem|[\d.,]+\s*exibi|ver todos os coment|adicione um coment|mais acessadas)/i;
  const fi = body.findIndex((l) => { const t = l.trim(); return footRe.test(t) || /esta informa[çc][aã]o est[áa] errada/i.test(t); });
  if (fi !== -1) body = body.slice(0, fi);
  const bodyStr = body.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
  const head = [`Título: ${title}`]; if (tom) head.push(tom.trim()); if (afin) head.push(afin.trim());
  return head.join("\n") + "\n\n" + bodyStr;
}
const fname = process.argv[2] || "oceans.txt";
const raw = readFileSync(new URL("./" + fname, import.meta.url), "utf8");
const out = fname.includes("alive") ? cleanCifraClubText(raw) : cleanCifraClub(raw);
console.log("===== CIFRA LIMPA =====");
console.log(out);
console.log("===== FIM (" + out.split("\n").length + " linhas) =====");
