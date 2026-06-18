// Teste de cleanUGSong + ugTitle (mesma lógica do Palco.jsx). Uso: node tools/test_clean.mjs brother.txt
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
function isSectionLine(line) {
  const t = line.trim(); if (!t) return false;
  if (/^[\[(].+[\])]$/.test(t)) return true;
  if (t.length <= 24 && /^[A-Za-zÀ-ÿ0-9º ª°ª .º/-]+:$/.test(t) && !isChordLine(t)) return true;
  return false;
}
function normalizeTitle(s) {
  let t = (s || "").trim().replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const letters = t.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length > 0 && letters === letters.toUpperCase();
  const allLower = letters.length > 0 && letters === letters.toLowerCase();
  if (allCaps || allLower) t = t.toLowerCase().replace(/(^|\s)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  return t;
}
const UG_JUNK_EXACT = new Set(["search","chords","play","autoscroll","listen","pdf","x","tab","video","versions","related tabs","discover","about ug","site rules","advertise"]);
const UG_JUNK_RE = [/views,?\s*added to favorites/i,/^rating:/i,/^last edit:/i,/^tuning:\s*e a d g b e/i,/guitar amps|for beginners that are actually great/i,/^\d+\s*comments?$/i,/^ver\s*\d+$/i,/^please rate this tab/i,/^© ?\d{4}/i];
const UG_FOOTER_RE = /^(last update\b|please,?\s*rate this tab|rating$|[\d.,]+\s*rates?$|welcome offer|play next$|more versions$|related tabs$|from collections$|theory and practice$|get effects$|all artists$|all collections$|©|all rights reserved|official version created)/i;
function isTabLine(l) { return /^\s*[a-gA-G][b#]?\s*\|/.test(l) || /\|[-0-9hpb/\\~xX().\s]{4,}\|/.test(l); }
function ugTitle(raw) {
  const lines = (raw || "").replace(/\r\n/g, "\n").split("\n");
  for (const l of lines.slice(0, 40)) {
    const m = l.match(/^(.+?)\s+(?:Acoustic\s+|Live\s+|Electric\s+|Ukulele\s+|Solo\s+)?(?:Chords|Tabs?|Bass|Drums?|Lyrics|Pro)\s+by\s+\S/i);
    if (m) { const t = normalizeTitle(m[1]); if (t && !/^(tabs?|chords?|courses?)$/i.test(t)) return t; }
  }
  return null;
}
function cleanUGSong(raw) {
  let lines = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const fi = lines.findIndex((l) => UG_FOOTER_RE.test(l.trim()));
  if (fi !== -1) lines = lines.slice(0, fi);
  const start = lines.findIndex((l) => { const t = l.trim(); return t !== "" && (isSectionLine(t) || isChordLine(t) || isTabLine(l)); });
  let header = [];
  if (start > 0) { header = lines.slice(0, start).filter((l) => /^\s*(tuning|speed)\b/i.test(l.trim())); lines = lines.slice(start); }
  lines = lines.filter((l) => { const t = l.trim(); if (!t) return true; if (UG_JUNK_EXACT.has(t.toLowerCase())) return false; if (UG_JUNK_RE.some((re) => re.test(t))) return false; return true; });
  const out = [...header, ...(header.length ? [""] : []), ...lines];
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

const raw = readFileSync(new URL("./" + (process.argv[2] || "down.txt"), import.meta.url), "utf8");
const out = cleanUGSong(raw);
console.log("TÍTULO DETECTADO:", JSON.stringify(ugTitle(raw)));
console.log("===== CIFRA LIMPA =====");
console.log(out);
console.log("===== FIM (" + out.split("\n").length + " linhas) =====");
