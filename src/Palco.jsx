import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Play, Pause, ArrowLeft, ChevronLeft, Music2, ListMusic, Plus, Minus,
  RotateCcw, FileText, Disc3, FolderPlus, Trash2, Maximize2, Check,
  Download, Upload, Star, Search, Mic, X, Guitar,
} from "lucide-react";

/* ================================================================== */
/*  Palco — cifras ao vivo: rolagem, transpor, capo, diagramas,        */
/*  afinador, favoritos e busca. Persistência local.                   */
/* ================================================================== */

const C = {
  bg: "#14110D", bgGlow: "#1c1813", surface: "#1E1A14", surface2: "#262019",
  border: "#332B20", borderSoft: "#2A2319", text: "#ECE6D8", textDim: "#A89C87",
  textFaint: "#8C8068", amber: "#F0A833", amberDeep: "#c4861f", teal: "#79B7A6",
  red: "#E0683C", green: "#7BC47F",
};
const FONT_UI = "'Inter', system-ui, -apple-system, sans-serif";
const FONT_DISPLAY = "'Space Grotesk', 'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'Courier New', ui-monospace, monospace";
const STORAGE_KEY = "palco:library";
const MONO_RATIO = 0.6;

/* ---------------------- armazenamento (Claude OU navegador) -------- */
async function storageGet(key) {
  try {
    if (typeof window !== "undefined" && window.storage && window.storage.get) {
      const r = await window.storage.get(key);
      return r && r.value != null ? r.value : null;
    }
  } catch (e) {}
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, val) {
  try {
    if (typeof window !== "undefined" && window.storage && window.storage.set) {
      window.storage.set(key, val).catch(() => {});
      return true;
    }
  } catch (e) {}
  try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; }
}
function storageWorks() {
  if (typeof window !== "undefined" && window.storage && window.storage.get) return true;
  try {
    const k = "__palco_probe__";
    window.localStorage.setItem(k, "1");
    const ok = window.localStorage.getItem(k) === "1";
    window.localStorage.removeItem(k);
    return ok;
  } catch (e) { return false; }
}

/* ----------------------------- parser ----------------------------- */
function parseSongs(raw) {
  const text = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const tuningCount = (text.match(/^\s*tuning\s*:\s*eb/gim) || []).length;
  const songs = tuningCount >= 2 ? parseUltimateGuitar(text) : parseSimple(text);
  return songs
    .map((s, idx) => ({
      title: (s.title || "").trim() || `Música ${idx + 1}`,
      body: (s.body || "").replace(/^\n+/, "").replace(/\n+$/, ""),
    }))
    .filter((s) => s.title || s.body.trim() !== "");
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
function ugClean(text) {
  let lines = text.split("\n");
  const footerIdx = lines.findIndex((l) => { const t = l.trim(); return /^please rate this tab/i.test(t) || /^related tabs$/i.test(t); });
  if (footerIdx !== -1) lines = lines.slice(0, footerIdx);
  const firstTuning = lines.findIndex((l) => /^\s*tuning\s*:\s*eb/i.test(l));
  if (firstTuning !== -1) {
    let t = firstTuning - 1;
    while (t > 0 && lines[t].trim() === "") t--;
    let start = t;
    for (let k = t; k >= Math.max(0, t - 2); k--) if (/^\s*(?:t[ií]tulo|title)\s*:/i.test(lines[k])) start = k;
    lines = lines.slice(start);
  }
  return lines.filter((l) => { const t = l.trim(); if (UG_JUNK_EXACT.has(t.toLowerCase())) return false; if (UG_JUNK_RE.some((re) => re.test(t))) return false; return true; });
}
function ugDetectTitle(lines, tuningIdx) {
  let j = tuningIdx - 1;
  while (j >= 0 && lines[j].trim() === "") j--;
  if (j < 0) return null;
  for (let k = j; k >= Math.max(0, j - 2); k--) {
    const m = lines[k].match(/^\s*(?:t[ií]tulo|title)\s*:\s*(.*)$/i);
    if (m) {
      const parts = [m[1].trim()];
      for (let w = k + 1; w < tuningIdx; w++) if (lines[w].trim() !== "") parts.push(lines[w].trim());
      return { title: normalizeTitle(parts.join(" ")), startIdx: k };
    }
  }
  const dash = lines[j].match(/^([A-Za-zÀ-ÿ.&'’\s]{2,40})[–—]\s*(.+)$/);
  if (dash && /[a-z]/.test(dash[2])) return { title: normalizeTitle(dash[2]), startIdx: j };
  return { title: normalizeTitle(lines[j]), startIdx: j };
}
function parseUltimateGuitar(text) {
  const lines = ugClean(text);
  const tuningIdxs = [];
  lines.forEach((l, i) => { if (/^\s*tuning\s*:\s*eb/i.test(l)) tuningIdxs.push(i); });
  const marks = [];
  for (const ti of tuningIdxs) { const d = ugDetectTitle(lines, ti); if (d) marks.push({ ...d, tuningIdx: ti }); }
  const songs = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].tuningIdx + 1;
    const end = i + 1 < marks.length ? marks[i + 1].startIdx : lines.length;
    songs.push({ title: marks[i].title, body: lines.slice(start, end).join("\n") });
  }
  return songs;
}
function parseSimple(text) {
  const lines = text.split("\n");
  const titleRe = /^\s*t[ií]tulo\s*:\s*(.*)$/i, sepRe = /^\s*-{3,}\s*$/;
  const songs = []; let current = null;
  for (const line of lines) {
    const tm = line.match(titleRe);
    if (tm) { if (current) songs.push(current); current = { title: tm[1].trim(), lines: [] }; continue; }
    if (sepRe.test(line)) { if (current) songs.push(current); current = null; continue; }
    if (!current) { if (line.trim() === "") continue; current = { title: line.trim(), lines: [] }; continue; }
    current.lines.push(line);
  }
  if (current) songs.push(current);
  return songs.map((s) => ({ title: s.title, body: s.lines.join("\n") }));
}

/* ------------------------ classificação de linhas ----------------- */
const QUALITIES = ["maj7","maj9","maj","min","dim7","dim","aug","sus2","sus4","sus","add9","add11","add","7M","13","11","9","7","6","5","4","2","m","M","°","º","\\+"].join("|");
const CHORD_RE = new RegExp(`^\\(?[A-G][#b]?(?:${QUALITIES})*(?:\\([#b]?\\d+\\))?(?:\\/[A-G][#b]?)?\\)?$`);
const STRUCT_RE = /^(\||x\d+|%|\(\d+x?\)|N\.?C\.?|–|-|:)$/i;
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
function classifyLine(line) {
  if (line.trim() === "") return "blank";
  if (isSectionLine(line)) return "section";
  if (isChordLine(line)) return "chord";
  return "lyric";
}

/* ------------------------ teoria musical -------------------------- */
const SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
const NOTE_TO_I = {}; SHARP.forEach((n,i)=>NOTE_TO_I[n]=i); FLAT.forEach((n,i)=>NOTE_TO_I[n]=i);
function shiftNote(note, semis, preferFlat) {
  const idx = NOTE_TO_I[note]; if (idx == null) return note;
  const ni = (((idx + semis) % 12) + 12) % 12;
  return (preferFlat ? FLAT : SHARP)[ni];
}
function transposeToken(tok, semis) {
  if (!semis) return tok;
  const open = tok.startsWith("(") ? "(" : "", close = tok.endsWith(")") ? ")" : "";
  let core = tok.slice(open.length, tok.length - close.length);
  let main = core, bass = ""; const sl = core.indexOf("/");
  if (sl !== -1) { main = core.slice(0, sl); bass = core.slice(sl + 1); }
  const rm = main.match(/^([A-G][#b]?)(.*)$/); if (!rm) return tok;
  const newRoot = shiftNote(rm[1], semis, rm[1].includes("b"));
  let out = open + newRoot + rm[2];
  if (bass) { const bm = bass.match(/^([A-G][#b]?)(.*)$/); out += "/" + (bm ? shiftNote(bm[1], semis, bm[1].includes("b")) + bm[2] : bass); }
  return out + close;
}

/* ------------------------ diagramas de acorde --------------------- */
function parseFretStr(s) { return s.split("").map((c) => (c === "x" || c === "X" ? -1 : parseInt(c, 10))); }
const OPEN = {
  "C":"x32010","C7":"x32310","Cmaj7":"x32000",
  "D":"xx0232","Dm":"xx0231","D7":"xx0212","Dmaj7":"xx0222","Dsus4":"xx0233","Dsus2":"xx0230",
  "E":"022100","Em":"022000","E7":"020100","Em7":"020000","Emaj7":"021100",
  "F":"133211","Fmaj7":"xx3210",
  "G":"320003","G7":"320001","Gmaj7":"320002",
  "A":"x02220","Am":"x02210","A7":"x02020","Am7":"x02010","Amaj7":"x02120","Asus4":"x02230","Asus2":"x02200",
  "B7":"x21202","Bm":"x24432","B":"x24442",
};
const E_SHAPE = { maj:[0,2,2,1,0,0], m:[0,2,2,0,0,0], "7":[0,2,0,1,0,0], m7:[0,2,0,0,0,0], maj7:[0,2,1,1,0,0], sus4:[0,2,2,2,0,0] };
const A_SHAPE = { maj:[-1,0,2,2,2,0], m:[-1,0,2,2,1,0], "7":[-1,0,2,0,2,0], m7:[-1,0,2,0,1,0], maj7:[-1,0,2,1,2,0], sus4:[-1,0,2,2,3,0], sus2:[-1,0,2,2,0,0] };
function normQuality(suffix) {
  const s = suffix.trim();
  if (s === "") return { q: "maj", approx: false };
  if (/^(maj7|7M|M7|maj9|maj)/.test(s)) return { q: "maj7", approx: !/^maj7|^7M|^M7/.test(s) };
  if (/^(m7|min7)/.test(s)) return { q: "m7", approx: false };
  if (/^sus2/.test(s)) return { q: "sus2", approx: false };
  if (/^sus/.test(s)) return { q: "sus4", approx: false };
  if (/^(m|min)(?!aj)/.test(s)) return { q: /7/.test(s) ? "m7" : "m", approx: !/^m$|^min$|^m7$|^min7$/.test(s) };
  if (/^7/.test(s)) return { q: "7", approx: false };
  return { q: "maj", approx: true };
}
function parseChord(name) {
  const open = name.startsWith("(") ? 1 : 0;
  let core = name.slice(open).replace(/\)$/, ""); let bass = ""; const sl = core.indexOf("/");
  if (sl !== -1) { bass = core.slice(sl + 1); core = core.slice(0, sl); }
  const m = core.match(/^([A-G][#b]?)(.*)$/); if (!m) return null;
  return { root: m[1], suffix: m[2], bass };
}
function chordDiagram(name) {
  const p = parseChord(name); if (!p) return null;
  const exact = p.root + p.suffix;
  if (OPEN[exact]) return { name, frets: parseFretStr(OPEN[exact]), approx: false };
  const rootI = NOTE_TO_I[p.root]; if (rootI == null) return null;
  const { q, approx } = normQuality(p.suffix);
  const fretE = (((rootI - 4) % 12) + 12) % 12, fretA = (((rootI - 9) % 12) + 12) % 12;
  let useA = fretA < fretE;
  let tmpl = useA ? A_SHAPE[q] : E_SHAPE[q];
  if (!tmpl) { useA = !useA; tmpl = useA ? A_SHAPE[q] : E_SHAPE[q]; }
  if (!tmpl) { useA = false; tmpl = E_SHAPE.maj; }
  const f = useA ? fretA : fretE;
  return { name, frets: tmpl.map((o) => (o < 0 ? -1 : f + o)), approx };
}

/* ------------------------ pitch (afinador) ------------------------ */
function autoCorrelate(buf, sampleRate) {
  let SIZE = buf.length, rms = 0;
  for (let i = 0; i < SIZE; i++) { const v = buf[i]; rms += v * v; }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1; const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  buf = buf.slice(r1, r2); SIZE = buf.length;
  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] += buf[j] * buf[j + i];
  let d = 0; while (d < SIZE - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  let T0 = maxpos; if (T0 <= 0) return -1;
  const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);
  return sampleRate / T0;
}
function freqToNote(f) {
  const noteNum = 12 * (Math.log(f / 440) / Math.log(2)) + 69;
  const rounded = Math.round(noteNum);
  const cents = Math.round((noteNum - rounded) * 100);
  const name = SHARP[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name, octave, cents };
}

/* ------------------------ modo jogo (helpers) --------------------- */
const HIT_PRE = 0.6, HIT_POST = 0.6; // janela de acerto (s): antes/depois do tempo do acorde
const TIME_TOKEN_RE = /^\[\d{1,2}:\d{2}(?:\.\d+)?\]$/;

// garante um espaço após cada marcador [mm:ss] (facilita tokenizar)
function normalizeTimes(text) {
  return (text || "").replace(/(\[\d{1,2}:\d{2}(?:\.\d+)?\])(?=\S)/g, "$1 ");
}
// remove os marcadores de tempo para exibição limpa da cifra
function stripTimes(text) {
  return (text || "").replace(/\[\d{1,2}:\d{2}(?:\.\d+)?\]\s?/g, "");
}
// classe de altura (0-11) da fundamental de um acorde
function chordRootPC(chord) {
  const p = parseChord(chord); if (!p) return null;
  const i = NOTE_TO_I[p.root]; return i == null ? null : i;
}
// monta a timeline do jogo a partir dos marcadores [mm:ss] (ordem do documento)
function buildChart(body, shift) {
  const text = normalizeTimes(body);
  const re = /\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]\s*(\(?[A-G][#b]?[^\s\]]*)/g;
  const out = []; let m;
  while ((m = re.exec(text))) {
    const t = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const shifted = transposeToken(m[3], shift);
    const pc = chordRootPC(shifted);
    if (pc == null) continue;
    out.push({ idx: out.length, t, chord: shifted, pc });
  }
  return out;
}
// nota final a partir da porcentagem de acertos
function gradeFor(pct) {
  if (pct >= 90) return { letter: "A", label: "Lendário!", color: "#7BC47F" };
  if (pct >= 75) return { letter: "B", label: "Muito bom", color: "#79B7A6" };
  if (pct >= 50) return { letter: "C", label: "Precisa treinar o ritmo", color: "#F0A833" };
  return { letter: "D", label: "Bora ensaiar mais um pouco", color: "#E0683C" };
}

/* ----------------------------- sample ----------------------------- */
const SAMPLE = `Título: Boas-vindas (Demo)
[Intro] C  G  Am  F

C            G
Acende a luz, começa o show
Am               F
A voz do violão ecoou
C              G
A noite inteira pra cantar
Am           F        C
Bem-vindo, é hora de tocar

---

Título: Estrada de Terra (Demo)
[Verso]
G              D
Poeira sobe na manhã
Em             C
O caminho ainda é tão longe
G               D
Mas o coração não cansa não
Em         C       G
Segue firme nessa canção

[Refrão]
D            C        G
Vou pela estrada a cantarolar
D           C         G
Sem pressa alguma de chegar

---

Título: Treino de Ritmo (Modo Jogo)
[Intro]
[00:01] Em      [00:03] C
Toque cada acorde quando ele passar na linha
[00:05] G       [00:07] D
Siga o cronômetro, capriche no tempo
[00:09] Em      [00:11] C
Verde é acerto, vermelho é perdeu
[00:13] G       [00:15] D
No fim aparece a sua nota`;

/* ----------------------------- CSS -------------------------------- */
const CSS = `
.palco-root *{box-sizing:border-box;}
.palco-root ::selection{background:${C.amber};color:#1a140a;}
.palco-textarea::placeholder,.palco-input::placeholder{color:${C.textFaint};}
.palco-textarea:focus-visible,.palco-input:focus-visible{outline:none;border-color:${C.amber};box-shadow:0 0 0 3px rgba(240,168,51,.16);}
.palco-btn{transition:transform .12s ease, background .15s ease, border-color .15s ease, color .15s ease;}
.palco-btn:active{transform:translateY(1px) scale(.99);}
.palco-primary:hover{background:${C.amber};}
.palco-ghost:hover{background:${C.surface2};border-color:${C.border};}
.palco-icon:hover{background:${C.surface2};color:${C.text};}
.palco-song:hover{background:${C.surface2};}
.palco-song:hover .palco-chev{color:${C.amber};transform:translateX(2px);}
.palco-album:hover{border-color:${C.border};background:${C.surface2};}
.palco-album:hover .palco-disc{color:${C.amber};}
.palco-play:hover{background:${C.amber};box-shadow:0 0 28px rgba(240,168,51,.35);}
.palco-chip:hover{background:${C.surface2};border-color:${C.amber};color:${C.text};}
.palco-trash:hover{background:rgba(224,104,60,.16);color:${C.red};border-color:${C.red};}
.palco-chord{cursor:pointer;}
.palco-chord:hover{text-decoration:underline;text-underline-offset:3px;}
.palco-star:hover{color:${C.amber};}
.palco-scroll::-webkit-scrollbar{width:10px;height:10px;}
.palco-scroll::-webkit-scrollbar-track{background:transparent;}
.palco-scroll::-webkit-scrollbar-thumb{background:${C.border};border-radius:99px;border:3px solid ${C.bg};}
.palco-range{-webkit-appearance:none;appearance:none;height:4px;border-radius:99px;background:${C.surface2};outline:none;cursor:pointer;}
.palco-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:${C.amber};border:3px solid ${C.bg};box-shadow:0 0 0 1px ${C.amberDeep};cursor:grab;}
.palco-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:${C.amber};border:3px solid ${C.bg};cursor:grab;}
.palco-btn:focus-visible,.palco-range:focus-visible,.palco-song:focus-visible,.palco-album:focus-visible{outline:2px solid ${C.amber};outline-offset:2px;}
.palco-ev{transition:color .12s ease, background .12s ease;border-radius:4px;}
.palco-ev-active{text-decoration:underline;text-underline-offset:4px;}
.palco-ev-hit{background:rgba(123,196,127,.20);}
.palco-ev-miss{background:rgba(224,104,60,.20);}
@media (prefers-reduced-motion: reduce){.palco-btn,.palco-chev,.palco-ev{transition:none!important;}}
`;

/* ============================== APP =============================== */
export default function Palco() {
  const [library, setLibrary] = useState({ albums: [], favorites: [], settings: {} });
  const [ready, setReady] = useState(false);
  const [storageOK, setStorageOK] = useState(true);

  const [view, setView] = useState("albums");
  const [currentAlbumId, setCurrentAlbumId] = useState(null);
  const [selected, setSelected] = useState(null);

  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState(null);
  const [albumName, setAlbumName] = useState("");
  const [importErr, setImportErr] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [libMsg, setLibMsg] = useState("");
  const [query, setQuery] = useState("");

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [fontSize, setFontSize] = useState(18);
  const [autoFit, setAutoFit] = useState(true);
  const [containerW, setContainerW] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const [transpose, setTranspose] = useState(0);
  const [capo, setCapo] = useState(0);
  const [popover, setPopover] = useState(null); // {name, left, top, place}
  const [tunerOpen, setTunerOpen] = useState(false);

  // ----- Modo Jogo -----
  const [mode, setMode] = useState("free");                       // "free" | "game"
  const [game, setGame] = useState({ phase: "idle" });            // idle | countdown | playing | finished | denied | unsupported
  const [gScore, setGScore] = useState({ hits: 0, total: 0, status: [] });
  const [gActive, setGActive] = useState(-1);
  const [gFlash, setGFlash] = useState(null);                     // {idx, kind: "hit"|"miss"}

  const scrollRef = useRef(null), rafRef = useRef(null), accRef = useRef(0), fileInputRef = useRef(null);
  const gAudioRef = useRef(null);     // {ctx, stream, analyser, buf}
  const gRafRef = useRef(null);       // requestAnimationFrame do jogo
  const gClockRef = useRef({ t0: 0 }); // relógio (segundos)
  const gRunRef = useRef(0);          // token p/ invalidar loops antigos
  const chartRef = useRef([]);        // snapshot da timeline em jogo
  const targetRef = useRef(0);        // índice do próximo acorde a resolver
  const eventEls = useRef([]);        // refs DOM dos acordes-alvo (p/ medir Y)
  const eventY = useRef([]);          // posição Y medida de cada alvo

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (e) {} };
  }, []);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 760);
    onResize(); window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    (async () => {
      const v = await storageGet(STORAGE_KEY);
      if (v) { try { const lib = JSON.parse(v); setLibrary({ albums: lib.albums || [], favorites: lib.favorites || [], settings: lib.settings || {} }); } catch (e) {} }
      setStorageOK(storageWorks());
      setReady(true);
    })();
  }, []);

  const commit = useCallback((next) => { setLibrary(next); storageSet(STORAGE_KEY, JSON.stringify(next)); }, []);
  const isMobileNow = () => window.innerWidth < 760;

  const favSet = useMemo(() => new Set(library.favorites || []), [library]);
  const favKey = (albumId, idx) => `${albumId}:${idx}`;

  // músicas ativas (álbum normal ou favoritos)
  const activeSongs = useMemo(() => {
    if (currentAlbumId === "__fav__") {
      const out = [];
      for (const key of library.favorites || []) {
        const [aid, i] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
        const al = library.albums.find((a) => a.id === aid);
        if (al && al.songs[i]) out.push({ albumId: aid, idx: i, title: al.songs[i].title, body: al.songs[i].body });
      }
      return out;
    }
    const al = library.albums.find((a) => a.id === currentAlbumId);
    return al ? al.songs.map((s, i) => ({ albumId: al.id, idx: i, title: s.title, body: s.body })) : [];
  }, [library, currentAlbumId]);

  const currentAlbumName = currentAlbumId === "__fav__" ? "Favoritos" : (library.albums.find((a) => a.id === currentAlbumId) || {}).name || "";
  const selectedSong = selected != null && activeSongs[selected] ? activeSongs[selected] : null;

  const selKey = selectedSong ? favKey(selectedSong.albumId, selectedSong.idx) : null;

  // carrega tom/capo/velocidade salvos ao abrir uma música
  useEffect(() => {
    if (!selKey) return;
    const st = (library.settings && library.settings[selKey]) || {};
    setTranspose(st.transpose || 0);
    setCapo(st.capo || 0);
    setSpeed(st.speed || 4);
    setPlaying(false); accRef.current = 0; setPopover(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // salva os ajustes da música atual (limpa quando volta ao padrão)
  const persistSetting = (patch) => {
    if (!selKey) return;
    const settings = { ...(library.settings || {}) };
    const merged = { ...(settings[selKey] || {}), ...patch };
    if (!merged.transpose && !merged.capo && (merged.speed === 4 || merged.speed == null)) delete settings[selKey];
    else settings[selKey] = merged;
    commit({ ...library, settings });
  };
  const changeTranspose = (v) => { setTranspose(v); persistSetting({ transpose: v }); };
  const changeCapo = (v) => { setCapo(v); persistSetting({ capo: v }); };
  const changeSpeed = (v) => { setSpeed(v); persistSetting({ speed: v }); };
  const resetToneCapo = () => { setTranspose(0); setCapo(0); persistSetting({ transpose: 0, capo: 0 }); };

  const displayShift = transpose - capo;
  const renderedLines = useMemo(() => {
    if (!selectedSong) return [];
    return selectedSong.body.split("\n").map((line, i) => {
      const raw = normalizeTimes(line);   // mantém [mm:ss] (usado pelo Modo Jogo)
      const text = stripTimes(raw);        // versão limpa (exibição)
      return { key: i, raw, text, kind: classifyLine(text) };
    });
  }, [selectedSong]);

  // timeline do jogo (acordes com tempo), já com transpose/capo aplicados
  const chart = useMemo(() => (selectedSong ? buildChart(selectedSong.body, displayShift) : []), [selectedSong, displayShift]);
  const hasChart = chart.length > 0;

  const maxChars = useMemo(() => {
    if (!selectedSong) return 0;
    return selectedSong.body.split("\n").reduce((m, l) => Math.max(m, stripTimes(normalizeTimes(l)).length), 1);
  }, [selectedSong]);
  const fitSize = useMemo(() => {
    if (!containerW || !maxChars) return fontSize;
    const fs = Math.floor((containerW - 64) / (maxChars * MONO_RATIO));
    return Math.max(11, Math.min(32, fs));
  }, [containerW, maxChars, fontSize]);
  const effFs = autoFit ? fitSize : fontSize;

  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    setContainerW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setContainerW(e.contentRect.width); });
    ro.observe(el); return () => ro.disconnect();
  }, [view, currentAlbumId, selected]);

  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current; if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) el.scrollTop = 0;
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      accRef.current += ((8 + speed * 12) * dt) / 1000;
      if (accRef.current >= 1) { const inc = Math.floor(accRef.current); el.scrollTop += inc; accRef.current -= inc; }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { setPlaying(false); return; }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed]);

  /* navegação */
  const openAlbum = (id) => { setCurrentAlbumId(id); setSelected(isMobileNow() ? null : 0); setView("album"); resetSongState(); };
  const openSong = (idx) => { setSelected(idx); resetSongState(); };
  const openSongRef = (albumId, idx) => { setCurrentAlbumId(albumId); setView("album"); setQuery(""); setTimeout(() => setSelected(idx), 0); resetSongState(); };
  const resetSongState = () => { setPlaying(false); accRef.current = 0; setPopover(null); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const backToSongs = () => { setPlaying(false); setSelected(null); setPopover(null); };
  const backToAlbums = () => { setPlaying(false); setSelected(null); setCurrentAlbumId(null); setView("albums"); setPopover(null); };
  const resetScroll = () => { setPlaying(false); accRef.current = 0; if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" }); };

  /* importação */
  const goImport = () => { setView("import"); setPreview(null); setImportErr(""); setLibMsg(""); };
  const processImport = () => {
    const parsed = parseSongs(raw);
    if (!parsed.length) { setImportErr("Não encontrei nenhuma música. Confira se cada bloco começa com 'Título:' ou tem 'Tuning:' (Ultimate Guitar)."); setPreview(null); return; }
    setImportErr(""); setPreview(parsed);
    if (!albumName.trim()) setAlbumName(`Álbum ${library.albums.length + 1}`);
  };
  const saveNewAlbum = () => {
    if (!preview) return;
    const album = { id: `al_${Date.now()}`, name: albumName.trim() || `Álbum ${library.albums.length + 1}`, createdAt: Date.now(), songs: preview.map((s) => ({ title: s.title, body: s.body })) };
    commit({ ...library, albums: [...library.albums, album] });
    setRaw(""); setPreview(null); setAlbumName(""); setCurrentAlbumId(album.id); setSelected(isMobileNow() ? null : 0); setView("album"); resetSongState();
  };
  const appendToAlbum = (id) => {
    if (!preview) return;
    const next = { ...library, albums: library.albums.map((a) => a.id === id ? { ...a, songs: [...a.songs, ...preview.map((s) => ({ title: s.title, body: s.body }))] } : a) };
    commit(next); setRaw(""); setPreview(null); setAlbumName(""); setCurrentAlbumId(id); setSelected(isMobileNow() ? null : 0); setView("album"); resetSongState();
  };
  const deleteAlbum = (id) => {
    const favs = (library.favorites || []).filter((k) => !k.startsWith(id + ":"));
    const settings = { ...(library.settings || {}) };
    Object.keys(settings).forEach((k) => { if (k.startsWith(id + ":")) delete settings[k]; });
    commit({ ...library, albums: library.albums.filter((a) => a.id !== id), favorites: favs, settings });
    setPendingDelete(null); if (currentAlbumId === id) backToAlbums();
  };

  /* favoritos */
  const toggleFav = (albumId, idx) => {
    const k = favKey(albumId, idx);
    const has = (library.favorites || []).includes(k);
    const favs = has ? library.favorites.filter((x) => x !== k) : [...(library.favorites || []), k];
    commit({ ...library, favorites: favs });
  };

  /* backup */
  const exportLibrary = () => {
    try {
      const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `palco-biblioteca-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      setLibMsg("Backup gerado — guarde o arquivo .json.");
    } catch (e) { setLibMsg("Não consegui gerar o backup."); }
  };
  const triggerImport = () => fileInputRef.current && fileInputRef.current.click();
  const importLibraryFile = (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.albums)) throw new Error();
        const byId = new Map(library.albums.map((a) => [a.id, a]));
        for (const a of parsed.albums) if (a && a.id && Array.isArray(a.songs)) byId.set(a.id, a);
        const favs = Array.from(new Set([...(library.favorites || []), ...((parsed.favorites) || [])]));
        const settings = { ...(library.settings || {}), ...(parsed.settings || {}) };
        commit({ albums: [...byId.values()], favorites: favs, settings });
        setLibMsg(`Biblioteca restaurada — ${parsed.albums.length} ${parsed.albums.length === 1 ? "álbum" : "álbuns"}.`);
      } catch (err) { setLibMsg("Arquivo inválido. Use um backup .json do Palco."); }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  /* clique no acorde -> popover de diagrama */
  const onChordTap = (name, e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const place = r.top < 230 ? "below" : "above";
    setPopover({ name, left: Math.max(10, Math.min(window.innerWidth - 174, r.left + r.width / 2 - 82)), top: place === "above" ? r.top : r.bottom, place });
  };

  /* busca */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    const out = [];
    for (const al of library.albums) al.songs.forEach((s, i) => { if (s.title.toLowerCase().includes(q) || al.name.toLowerCase().includes(q)) out.push({ albumId: al.id, albumName: al.name, idx: i, title: s.title }); });
    return out.slice(0, 60);
  }, [query, library]);

  /* ===================== Modo Jogo: controle ===================== */
  const stopGameAudio = () => {
    if (gRafRef.current) { cancelAnimationFrame(gRafRef.current); gRafRef.current = null; }
    const a = gAudioRef.current;
    if (a) {
      try { a.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      try { if (a.ctx.state !== "closed") a.ctx.close(); } catch (e) {}
    }
    gAudioRef.current = null;
  };
  const stopGame = () => { gRunRef.current++; stopGameAudio(); setGame({ phase: "idle" }); setGActive(-1); setGFlash(null); targetRef.current = 0; };
  const switchMode = (m) => {
    if (m === mode) return;
    gRunRef.current++; stopGameAudio(); setTunerOpen(false); setPlaying(false);
    setGame({ phase: "idle" }); setGActive(-1); setGFlash(null); targetRef.current = 0;
    setMode(m);
  };

  // mede a posição vertical (Y) de cada acorde-alvo dentro da área de rolagem
  const measureEvents = () => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTop = 0;
    const cTop = el.getBoundingClientRect().top;
    eventY.current = chartRef.current.map((_, i) => {
      const node = eventEls.current[i];
      return node ? node.getBoundingClientRect().top - cTop : 0;
    });
  };

  const markResult = (idx, hit) => {
    setGScore((s) => { const status = s.status.slice(); status[idx] = hit ? "hit" : "miss"; return { ...s, hits: s.hits + (hit ? 1 : 0), status }; });
    setGFlash({ idx, kind: hit ? "hit" : "miss" });
    setTimeout(() => setGFlash((f) => (f && f.idx === idx ? null : f)), 350);
  };

  const finishGame = (myRun) => {
    if (myRun !== gRunRef.current) return;
    gRunRef.current++; stopGameAudio(); setGame({ phase: "finished" });
  };

  // loop principal do jogo: scroll por tempo + detecção de pitch + colisão
  const runGameFrame = (myRun) => {
    const el = scrollRef.current, audio = gAudioRef.current, cs = chartRef.current;
    let lastDetect = 0;
    const frame = () => {
      if (myRun !== gRunRef.current) return;
      const now = performance.now() / 1000;
      const t = now - gClockRef.current.t0;
      // --- rolagem sincronizada rigidamente ao cronômetro (segundos) ---
      if (el && eventY.current.length) {
        const H = el.clientHeight * 0.38, ys = eventY.current; let y;
        if (t <= cs[0].t) y = ys[0];
        else if (t >= cs[cs.length - 1].t) y = ys[ys.length - 1];
        else {
          let k = 0; while (k < cs.length - 1 && cs[k + 1].t <= t) k++;
          const span = (cs[k + 1].t - cs[k].t) || 1;
          const p = Math.max(0, Math.min(1, (t - cs[k].t) / span));
          y = ys[k] + (ys[k + 1] - ys[k]) * p;
        }
        el.scrollTop = Math.max(0, y - H);
      }
      // --- detecção da frequência do microfone (reusa o afinador) ---
      let pc = null;
      if (audio && (now - lastDetect) > 0.07) {
        lastDetect = now;
        audio.analyser.getFloatTimeDomainData(audio.buf);
        const freq = autoCorrelate(audio.buf, audio.ctx.sampleRate);
        if (freq > 0) { const nn = freqToNote(freq); pc = NOTE_TO_I[nn.name]; }
      }
      // --- colisão de tempo: acerto / perda do acorde atual ---
      const ti = targetRef.current;
      if (ti < cs.length) {
        const ev = cs[ti];
        if (t > ev.t + HIT_POST) { markResult(ti, false); targetRef.current = ti + 1; setGActive(targetRef.current); }
        else if (t >= ev.t - HIT_PRE && pc != null && pc === ev.pc) { markResult(ti, true); targetRef.current = ti + 1; setGActive(targetRef.current); }
      }
      if (targetRef.current >= cs.length) { finishGame(myRun); return; }
      gRafRef.current = requestAnimationFrame(frame);
    };
    gRafRef.current = requestAnimationFrame(frame);
  };

  const startClockAndLoop = (myRun) => {
    if (myRun !== gRunRef.current) return;
    gClockRef.current = { t0: performance.now() / 1000 };
    setGame({ phase: "playing" });
    runGameFrame(myRun);
  };
  const beginCountdown = (myRun) => {
    let n = 3; setGame({ phase: "countdown", n });
    const tick = () => {
      if (myRun !== gRunRef.current) return;
      n -= 1;
      if (n <= 0) startClockAndLoop(myRun);
      else { setGame({ phase: "countdown", n }); setTimeout(tick, 800); }
    };
    setTimeout(tick, 800);
  };

  const startGame = async () => {
    if (!chart.length) return;
    gRunRef.current++; const myRun = gRunRef.current;
    stopGameAudio(); setTunerOpen(false); setPlaying(false);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setGame({ phase: "unsupported" }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
      gAudioRef.current = { ctx, stream, analyser, buf: new Float32Array(analyser.fftSize) };
    } catch (e) { setGame({ phase: "denied" }); return; }
    if (myRun !== gRunRef.current) { stopGameAudio(); return; }
    chartRef.current = chart; targetRef.current = 0;
    setGScore({ hits: 0, total: chart.length, status: new Array(chart.length).fill(null) });
    setGActive(0); setGFlash(null);
    requestAnimationFrame(() => { if (myRun !== gRunRef.current) return; measureEvents(); beginCountdown(myRun); });
  };

  // limpeza ao desmontar e ao trocar de música (não interfere no Modo Livre)
  useEffect(() => () => { gRunRef.current++; stopGameAudio(); }, []);
  useEffect(() => {
    gRunRef.current++; stopGameAudio();
    setMode("free"); setGame({ phase: "idle" }); setGActive(-1); setGFlash(null); targetRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  if (!ready) {
    return (
      <div className="palco-root" style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{CSS}</style>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.textFaint }}>
          <Disc3 size={22} strokeWidth={1.8} /><span style={{ fontFamily: FONT_UI, fontSize: 15 }}>Carregando biblioteca…</span>
        </div>
      </div>
    );
  }

  /* ----------------------------- ALBUMS ---------------------------- */
  if (view === "albums") {
    const favCount = (library.favorites || []).filter((k) => { const aid = k.slice(0, k.lastIndexOf(":")); const i = Number(k.slice(k.lastIndexOf(":") + 1)); const al = library.albums.find((a) => a.id === aid); return al && al.songs[i]; }).length;
    return (
      <div className="palco-root" style={S.page}>
        <style>{CSS}</style>
        <div style={S.glow} />
        <div className="palco-scroll" style={S.albumsWrap}>
          <div style={S.albumsHead}>
            <Wordmark />
            <div style={S.libActions}>
              <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={importLibraryFile} style={{ display: "none" }} />
              <button className="palco-btn palco-ghost" style={S.iconGhost} onClick={triggerImport} title="Restaurar de um backup"><Upload size={16} strokeWidth={2.1} /><span style={S.iconGhostLabel}>Restaurar</span></button>
              <button className="palco-btn palco-ghost" style={S.iconGhost} onClick={exportLibrary} title="Salvar backup"><Download size={16} strokeWidth={2.1} /><span style={S.iconGhostLabel}>Backup</span></button>
              <button className="palco-btn palco-primary" style={S.btnPrimary} onClick={goImport}><FolderPlus size={18} strokeWidth={2.2} /> Importar álbum</button>
            </div>
          </div>

          <div style={S.searchWrap}>
            <Search size={17} color={C.textFaint} strokeWidth={2} />
            <input className="palco-input" style={S.searchInput} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar música ou álbum…" />
            {query && <button className="palco-btn palco-icon" style={S.searchClear} onClick={() => setQuery("")}><X size={15} strokeWidth={2.2} /></button>}
          </div>

          {libMsg && <div style={S.libMsg}>{libMsg}</div>}
          {!storageOK && <div style={S.storageNote}>Este navegador não está guardando os dados entre sessões (comum ao abrir arquivo local). Use <strong>Backup</strong> e <strong>Restaurar</strong>, ou hospede em https.</div>}

          {query ? (
            results.length === 0 ? (
              <div style={S.emptyAlbums}><p style={S.emptySub}>Nenhuma música encontrada para “{query}”.</p></div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {results.map((r, i) => (
                  <button key={i} className="palco-song palco-btn" style={S.resultItem} onClick={() => openSongRef(r.albumId, r.idx)}>
                    <Music2 size={15} color={C.textFaint} strokeWidth={2} />
                    <span style={S.resultMeta}><span style={S.resultTitle}>{r.title}</span><span style={S.resultAlbum}>{r.albumName}</span></span>
                    <span className="palco-chev" style={S.songChev}>›</span>
                  </button>
                ))}
              </div>
            )
          ) : library.albums.length === 0 ? (
            <div style={S.emptyAlbums}>
              <div style={S.emptyIcon}><Disc3 size={28} color={C.textFaint} strokeWidth={1.5} /></div>
              <p style={S.emptyTitle}>Nenhum álbum ainda</p>
              <p style={S.emptySub}>Importe um álbum colando as cifras. Ele fica salvo aqui.</p>
              <button className="palco-btn palco-ghost" style={{ ...S.btnGhost, marginTop: 18 }} onClick={goImport}><FolderPlus size={17} strokeWidth={2} /> Importar o primeiro álbum</button>
            </div>
          ) : (
            <div style={S.albumGrid}>
              {favCount > 0 && (
                <div className="palco-album palco-btn" style={{ ...S.albumCard, borderColor: "rgba(240,168,51,.35)" }} onClick={() => openAlbum("__fav__")} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openAlbum("__fav__")}>
                  <div style={S.albumTop}><div style={{ ...S.albumIcon, background: "rgba(240,168,51,.12)", borderColor: "rgba(240,168,51,.4)" }}><Star size={22} color={C.amber} fill={C.amber} strokeWidth={1.6} /></div></div>
                  <div style={S.albumName}>Favoritos</div>
                  <div style={S.albumCount}>{favCount} {favCount === 1 ? "música" : "músicas"}</div>
                </div>
              )}
              {library.albums.map((a) => (
                <div key={a.id} className="palco-album palco-btn" style={S.albumCard} onClick={() => openAlbum(a.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openAlbum(a.id)}>
                  <div style={S.albumTop}>
                    <div style={S.albumIcon}><Disc3 className="palco-disc" size={22} color={C.textDim} strokeWidth={1.8} /></div>
                    {pendingDelete === a.id ? (
                      <div style={S.confirmRow} onClick={(e) => e.stopPropagation()}>
                        <button className="palco-btn" style={S.confirmYes} onClick={() => deleteAlbum(a.id)}><Check size={14} strokeWidth={2.6} /></button>
                        <button className="palco-btn" style={S.confirmNo} onClick={() => setPendingDelete(null)}><Minus size={14} strokeWidth={2.6} /></button>
                      </div>
                    ) : (
                      <button className="palco-btn palco-trash" style={S.albumTrash} onClick={(e) => { e.stopPropagation(); setPendingDelete(a.id); }} title="Apagar álbum"><Trash2 size={15} strokeWidth={2} /></button>
                    )}
                  </div>
                  <div style={S.albumName}>{a.name}</div>
                  <div style={S.albumCount}>{a.songs.length} {a.songs.length === 1 ? "música" : "músicas"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ----------------------------- IMPORT ---------------------------- */
  if (view === "import") {
    return (
      <div className="palco-root" style={S.page}>
        <style>{CSS}</style>
        <div style={S.glow} />
        <div className="palco-scroll" style={S.importWrap}>
          <button className="palco-btn palco-icon" style={S.importBack} onClick={() => (library.albums.length ? backToAlbums() : null)}><ChevronLeft size={18} strokeWidth={2.2} /><span style={{ marginLeft: 4 }}>Álbuns</span></button>
          <h1 style={S.importTitle}>Importar álbum</h1>
          <p style={S.tagline}>Cole as cifras de um álbum inteiro. Reconheço o formato manual (<code style={S.code}>Título:</code> / <code style={S.code}>---</code>) e o texto bruto do Ultimate Guitar.</p>
          {!preview ? (
            <>
              <textarea className="palco-textarea" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"Cole o álbum aqui…\n\nTítulo: Minha música\n[Intro] C  G  Am  F\n\nC           G\nLetra..."} style={S.textarea} spellCheck={false} />
              {importErr && <div style={S.errorBox}>{importErr}</div>}
              <div style={S.importActions}>
                <button className="palco-btn palco-primary" style={{ ...S.btnPrimary, opacity: raw.trim() ? 1 : 0.45, cursor: raw.trim() ? "pointer" : "not-allowed" }} onClick={processImport} disabled={!raw.trim()}><ListMusic size={18} strokeWidth={2.2} /> Processar</button>
                <button className="palco-btn palco-ghost" style={S.btnGhost} onClick={() => setRaw(SAMPLE)}><FileText size={17} strokeWidth={2} /> Usar exemplo</button>
              </div>
            </>
          ) : (
            <>
              <div style={S.previewHead}><Check size={16} color={C.teal} strokeWidth={2.6} /><span>{preview.length} {preview.length === 1 ? "música encontrada" : "músicas encontradas"}</span></div>
              <div className="palco-scroll" style={S.previewList}>
                {preview.map((s, i) => (<div key={i} style={S.previewItem}><span style={S.previewNum}>{String(i + 1).padStart(2, "0")}</span><span style={S.previewTitle}>{s.title}</span></div>))}
              </div>
              <label style={S.fieldLabel}>Nome do álbum</label>
              <input className="palco-input" style={S.input} value={albumName} onChange={(e) => setAlbumName(e.target.value)} placeholder="Ex.: MTV Unplugged in New York" />
              <div style={S.importActions}>
                <button className="palco-btn palco-primary" style={S.btnPrimary} onClick={saveNewAlbum}><FolderPlus size={18} strokeWidth={2.2} /> Salvar como novo álbum</button>
                <button className="palco-btn palco-ghost" style={S.btnGhost} onClick={() => setPreview(null)}>Editar texto</button>
              </div>
              {library.albums.length > 0 && (
                <div style={S.appendRow}><span style={S.appendLabel}>ou adicionar a:</span>
                  <div style={S.chipWrap}>{library.albums.map((a) => (<button key={a.id} className="palco-btn palco-chip" style={S.chip} onClick={() => appendToAlbum(a.id)}><Disc3 size={14} strokeWidth={2} /> {a.name}</button>))}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  /* ----------------------------- ALBUM + PLAYER -------------------- */
  const showSidebar = !isMobile || selected === null;
  const showMain = !isMobile || selected !== null;
  const isFav = selectedSong ? favSet.has(favKey(selectedSong.albumId, selectedSong.idx)) : false;

  return (
    <div className="palco-root" style={S.page}>
      <style>{CSS}</style>
      <div style={S.appShell}>
        {showSidebar && (
          <aside style={{ ...S.sidebar, width: isMobile ? "100%" : 320, borderRight: isMobile ? "none" : `1px solid ${C.borderSoft}` }}>
            <div style={S.sidebarHead}>
              <button className="palco-btn palco-icon" style={S.sideBack} onClick={backToAlbums}><ChevronLeft size={17} strokeWidth={2.2} /><span style={{ marginLeft: 3 }}>Álbuns</span></button>
              <button className="palco-btn palco-ghost" style={S.newBtn} onClick={goImport}><Plus size={16} strokeWidth={2.4} /> Importar</button>
            </div>
            <div style={S.repHeader}><span style={S.albumNameSide}>{currentAlbumName}</span><span style={S.repCount}>{activeSongs.length} {activeSongs.length === 1 ? "música" : "músicas"}</span></div>
            <div className="palco-scroll" style={S.songList}>
              {activeSongs.length === 0 && <div style={{ padding: "20px 14px", color: C.textFaint, fontSize: 13.5 }}>{currentAlbumId === "__fav__" ? "Nenhum favorito ainda. Toque na estrela de uma música." : "Álbum vazio."}</div>}
              {activeSongs.map((s, i) => {
                const active = i === selected;
                const fav = favSet.has(favKey(s.albumId, s.idx));
                return (
                  <div key={i} className="palco-song palco-btn" style={{ ...S.songItem, background: active ? C.surface2 : "transparent", borderColor: active ? C.border : "transparent" }} onClick={() => openSong(i)} role="button" tabIndex={0}>
                    <span style={{ ...S.songNum, color: active ? C.amber : C.textFaint, borderColor: active ? C.amberDeep : C.borderSoft }}>{String(i + 1).padStart(2, "0")}</span>
                    <span style={S.songMeta}><span style={{ ...S.songTitle, color: active ? C.text : C.textDim }}>{s.title}</span><span style={S.songSub}>{(s.body ? s.body.split("\n").filter((l) => l.trim()).length : 0)} linhas</span></span>
                    <button className="palco-btn palco-star" style={{ ...S.starBtn, color: fav ? C.amber : C.textFaint }} onClick={(e) => { e.stopPropagation(); toggleFav(s.albumId, s.idx); }} title={fav ? "Remover dos favoritos" : "Favoritar"}><Star size={15} fill={fav ? C.amber : "none"} strokeWidth={2} /></button>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {showMain && (
          <main style={S.main}>
            {!selectedSong ? (
              <div style={S.empty}><div style={S.emptyIcon}><Music2 size={26} color={C.textFaint} strokeWidth={1.6} /></div><p style={S.emptyTitle}>Selecione uma música</p><p style={S.emptySub}>Escolha um título na lista para abrir a cifra.</p></div>
            ) : (
              <>
                <header style={S.viewerHead}>
                  <button className="palco-btn palco-icon" style={S.backBtn} onClick={isMobile ? backToSongs : resetScroll} title={isMobile ? "Voltar à lista" : "Voltar ao topo"}><ArrowLeft size={18} strokeWidth={2.2} /><span style={{ marginLeft: 7 }}>{isMobile ? "Lista" : "Topo"}</span></button>
                  <h1 style={S.viewerTitle}>{selectedSong.title}</h1>
                  <button className="palco-btn palco-star" style={{ ...S.headStar, color: isFav ? C.amber : C.textDim }} onClick={() => toggleFav(selectedSong.albumId, selectedSong.idx)} title={isFav ? "Remover dos favoritos" : "Favoritar"}><Star size={18} fill={isFav ? C.amber : "none"} strokeWidth={2} /></button>
                  <div style={S.headControls}>
                    <button className="palco-btn" style={{ ...S.autoBtn, background: autoFit ? C.amber : C.surface, color: autoFit ? "#1a140a" : C.textDim, borderColor: autoFit ? C.amber : C.borderSoft }} onClick={() => setAutoFit((v) => !v)} title="Ajustar fonte à largura"><Maximize2 size={14} strokeWidth={2.4} /><span style={{ marginLeft: 6, fontWeight: 600, fontSize: 12.5 }}>Ajustar</span></button>
                    {!autoFit && (<div style={S.fontControls}><button className="palco-btn palco-icon" style={S.fontBtn} onClick={() => setFontSize((f) => Math.max(11, f - 1))}><Minus size={15} strokeWidth={2.4} /></button><span style={S.fontVal}>{fontSize}</span><button className="palco-btn palco-icon" style={S.fontBtn} onClick={() => setFontSize((f) => Math.min(40, f + 1))}><Plus size={15} strokeWidth={2.4} /></button></div>)}
                  </div>
                </header>

                {/* barra de ferramentas: transpor / capo / afinador */}
                <div className="palco-scroll" style={S.toolsBar}>
                  <div style={S.modeSeg}>
                    <button className="palco-btn" style={mode === "free" ? S.segActive : S.seg} onClick={() => switchMode("free")}>Livre</button>
                    <button className="palco-btn" style={mode === "game" ? S.segActive : S.seg} onClick={() => switchMode("game")}>Jogo</button>
                  </div>
                  <div style={S.toolGroup}>
                    <span style={S.toolLabel}>Tom</span>
                    <button className="palco-btn palco-icon" style={S.toolBtn} onClick={() => changeTranspose(Math.max(-11, transpose - 1))}><Minus size={14} strokeWidth={2.5} /></button>
                    <span style={{ ...S.toolVal, color: transpose ? C.amber : C.textDim }}>{transpose > 0 ? "+" : ""}{transpose}</span>
                    <button className="palco-btn palco-icon" style={S.toolBtn} onClick={() => changeTranspose(Math.min(11, transpose + 1))}><Plus size={14} strokeWidth={2.5} /></button>
                  </div>
                  <div style={S.toolGroup}>
                    <span style={S.toolLabel}>Capo</span>
                    <button className="palco-btn palco-icon" style={S.toolBtn} onClick={() => changeCapo(Math.max(0, capo - 1))}><Minus size={14} strokeWidth={2.5} /></button>
                    <span style={{ ...S.toolVal, color: capo ? C.amber : C.textDim }}>{capo === 0 ? "—" : `${capo}ª`}</span>
                    <button className="palco-btn palco-icon" style={S.toolBtn} onClick={() => changeCapo(Math.min(11, capo + 1))}><Plus size={14} strokeWidth={2.5} /></button>
                  </div>
                  {(transpose !== 0 || capo !== 0) && <button className="palco-btn palco-icon" style={S.toolReset} onClick={resetToneCapo} title="Zerar tom e capo"><RotateCcw size={13} strokeWidth={2.3} /></button>}
                  {mode === "free" && <button className="palco-btn palco-ghost" style={S.tunerBtn} onClick={() => setTunerOpen(true)} title="Afinador"><Mic size={15} strokeWidth={2.1} /> Afinar</button>}
                </div>

                <div style={S.cifraWrap}>
                  <div ref={scrollRef} className="palco-scroll" style={S.cifraScroll} onScroll={() => popover && setPopover(null)}>
                    <div style={{ ...S.cifra, fontSize: effFs, lineHeight: 1.5 }}>
                      {mode === "game"
                        ? (() => {
                            const ctr = { n: 0, pending: false };
                            return renderedLines.map((ln) => {
                              if (ln.kind === "blank") return <div key={ln.key} style={{ height: effFs * 0.7 }} />;
                              if (ln.kind === "section") return <div key={ln.key} style={{ color: C.teal, fontWeight: 600, whiteSpace: "pre" }}>{ln.text}</div>;
                              if (ln.kind === "chord") return <div key={ln.key} style={{ whiteSpace: "pre", letterSpacing: "0.04em" }}>{renderGameChordLine(ln.raw, displayShift, ctr, gScore.status, gActive, eventEls, onChordTap)}</div>;
                              return <div key={ln.key} style={{ color: C.text, whiteSpace: "pre" }}>{ln.text || " "}</div>;
                            });
                          })()
                        : renderedLines.map((ln) => {
                            if (ln.kind === "blank") return <div key={ln.key} style={{ height: effFs * 0.7 }} />;
                            if (ln.kind === "section") return <div key={ln.key} style={{ color: C.teal, fontWeight: 600, whiteSpace: "pre" }}>{ln.text}</div>;
                            if (ln.kind === "chord") return <div key={ln.key} style={{ color: C.amber, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "pre" }}>{renderChordLine(ln.text, displayShift, onChordTap)}</div>;
                            return <div key={ln.key} style={{ color: C.text, whiteSpace: "pre" }}>{ln.text || " "}</div>;
                          })}
                      <div style={{ height: mode === "game" ? 260 : 140 }} />
                    </div>
                  </div>
                  {mode === "game" && game.phase === "playing" && <div style={S.hitLine} />}
                </div>

                {mode === "free" ? (
                  <div style={S.transportZone}>
                    <div style={S.transport}>
                      <button className="palco-btn palco-play" style={{ ...S.playBtn, background: playing ? C.amber : C.surface2, color: playing ? "#1a140a" : C.amber, borderColor: playing ? C.amber : C.border }} onClick={() => setPlaying((p) => !p)} title={playing ? "Pausar" : "Tocar"}>{playing ? <Pause size={22} strokeWidth={2.4} fill="#1a140a" /> : <Play size={22} strokeWidth={2.2} fill={C.amber} style={{ marginLeft: 2 }} />}</button>
                      <div style={S.speedBlock}>
                        <div style={S.speedTop}><span style={S.speedLabel}>Velocidade</span><span style={S.speedVal}>{speed}</span></div>
                        <input className="palco-range" type="range" min={1} max={10} step={1} value={speed} onChange={(e) => changeSpeed(Number(e.target.value))} style={{ width: "100%" }} />
                        <div style={S.speedScale}><span>Lento</span><span>Rápido</span></div>
                      </div>
                      <button className="palco-btn palco-icon" style={S.resetBtn} onClick={resetScroll} title="Voltar ao início"><RotateCcw size={18} strokeWidth={2.2} /></button>
                    </div>
                  </div>
                ) : (
                  <div style={S.transportZone}>
                    <div style={S.gamePanel}>
                      {(() => {
                        const resolved = gScore.status.filter(Boolean).length;
                        const bigIdx = gFlash ? gFlash.idx : gActive;
                        const bigChord = (chart[bigIdx] && chart[bigIdx].chord) || "—";
                        const bigColor = gFlash ? (gFlash.kind === "hit" ? C.green : C.red) : C.amber;
                        if (!hasChart) return (
                          <div style={S.gameInfo}>
                            <strong style={{ color: C.text }}>O Modo Jogo precisa de marcações de tempo.</strong>
                            <span>Adicione <code style={S.code}>[mm:ss]</code> antes dos acordes na cifra — ex.: <code style={S.code}>[00:12] Em</code>. Cada acorde marcado vira um alvo no ritmo. Importe o exemplo <em>"Treino de Ritmo"</em> para testar.</span>
                          </div>
                        );
                        if (game.phase === "unsupported") return (<div style={S.gameInfo}><span>Seu navegador não dá acesso ao microfone aqui (comum em arquivo local). Use o app publicado em <strong>https</strong> para jogar.</span></div>);
                        if (game.phase === "denied") return (<div style={S.gameRow}><span style={{ ...S.gameHint, flex: 1 }}>Microfone bloqueado. Autorize o acesso e tente de novo.</span><button className="palco-btn palco-primary" style={S.btnPrimary} onClick={startGame}>Tentar de novo</button></div>);
                        if (game.phase === "countdown") return (<div style={S.gameCountWrap}><div style={S.gameCount}>{game.n}</div><span style={S.gameHint}>Prepare o violão…</span></div>);
                        if (game.phase === "playing") return (
                          <div style={S.gameRow}>
                            <div style={{ ...S.gameBig, color: bigColor }}>{bigChord}</div>
                            <div style={S.gameStats}>
                              <div style={S.gameStatLine}><span style={{ color: C.green }}>● {gScore.hits}</span><span style={{ color: C.red }}>● {resolved - gScore.hits}</span></div>
                              <div style={S.gameHint}>{resolved}/{gScore.total} acordes</div>
                            </div>
                            <button className="palco-btn palco-icon" style={S.resetBtn} onClick={stopGame} title="Parar jogo"><X size={18} strokeWidth={2.2} /></button>
                          </div>
                        );
                        return (
                          <div style={S.gameRow}>
                            <button className="palco-btn palco-play" style={{ ...S.playBtn, background: C.surface2, color: C.amber, borderColor: C.border }} onClick={startGame} title="Iniciar jogo"><Play size={22} strokeWidth={2.2} fill={C.amber} style={{ marginLeft: 2 }} /></button>
                            <div style={S.gameStats}>
                              <div style={{ ...S.gameStatLine, color: C.text, fontWeight: 600, fontSize: 15 }}>Iniciar jogo</div>
                              <div style={S.gameHint}>{chart.length} acordes no ritmo · precisa de microfone</div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
        )}
      </div>

      {popover && <ChordPopover data={popover} onClose={() => setPopover(null)} />}
      {tunerOpen && <Tuner onClose={() => setTunerOpen(false)} />}
      {game.phase === "finished" && (() => {
        const pct = gScore.total ? Math.round((gScore.hits / gScore.total) * 100) : 0;
        const g = gradeFor(pct);
        return (
          <div style={S.tunerOverlay} onClick={stopGame}>
            <div style={S.scoreCard} onClick={(e) => e.stopPropagation()}>
              <div style={S.tunerHead}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Music2 size={18} color={C.amber} strokeWidth={2.2} /><span style={S.tunerTitle}>Resultado</span></div><button className="palco-btn palco-icon" style={S.popClose} onClick={stopGame}><X size={16} strokeWidth={2.3} /></button></div>
              <div style={S.scoreBody}>
                <div style={{ ...S.scoreGrade, color: g.color }}>{g.letter}</div>
                <div style={{ ...S.scorePct, color: C.text }}>{pct}%</div>
                <div style={{ ...S.scoreLabel, color: g.color }}>Nota {g.letter} — {g.label}</div>
                <div style={S.scoreSub}>Você acertou {gScore.hits} de {gScore.total} acordes no tempo certo</div>
                <div style={S.scoreActions}>
                  <button className="palco-btn palco-primary" style={S.btnPrimary} onClick={startGame}><Play size={17} strokeWidth={2.2} fill="#1a140a" /> Jogar de novo</button>
                  <button className="palco-btn palco-ghost" style={S.btnGhost} onClick={stopGame}>Sair</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ------------------ render de linha de acordes -------------------- */
function renderChordLine(text, shift, onChordTap) {
  const parts = []; const re = /(\s+)|(\S+)/g; let m;
  while ((m = re.exec(text))) parts.push(m[1] !== undefined ? { g: m[1] } : { t: m[2] });
  const nodes = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.g !== undefined) { nodes.push(<span key={i}>{p.g}</span>); continue; }
    const tok = p.t; const isChord = CHORD_RE.test(tok);
    if (isChord && shift) {
      const nt = transposeToken(tok, shift); const diff = tok.length - nt.length;
      if (i + 1 < parts.length && parts[i + 1].g !== undefined) {
        let g = parts[i + 1].g;
        if (diff > 0) g = g + " ".repeat(diff); else if (diff < 0) g = g.slice(0, Math.max(1, g.length + diff));
        parts[i + 1] = { g };
      }
      nodes.push(<span key={i} className="palco-chord" onClick={(e) => onChordTap(nt, e)}>{nt}</span>);
      if ((i + 1 >= parts.length || parts[i + 1].g === undefined) && diff > 0) nodes.push(<span key={i + "p"}>{" ".repeat(diff)}</span>);
    } else if (isChord) {
      nodes.push(<span key={i} className="palco-chord" onClick={(e) => onChordTap(tok, e)}>{tok}</span>);
    } else {
      nodes.push(<span key={i}>{tok}</span>);
    }
  }
  return nodes;
}

/* ----- render de linha de acordes no Modo Jogo (com alvos) -------- */
function renderGameChordLine(text, shift, ctr, statusArr, activeIdx, elsRef, onChordTap) {
  const parts = []; const re = /(\s+)|(\S+)/g; let m;
  while ((m = re.exec(text))) parts.push(m[1] !== undefined ? { g: m[1] } : { t: m[2] });
  const nodes = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.g !== undefined) { nodes.push(<span key={i}>{p.g}</span>); continue; }
    const tok = p.t;
    if (TIME_TOKEN_RE.test(tok)) {                 // marcador [mm:ss]: não exibe
      if (i + 1 < parts.length && parts[i + 1].g !== undefined) parts[i + 1] = { g: "" };
      ctr.pending = true;
      continue;
    }
    const isChord = CHORD_RE.test(tok);
    if (ctr.pending) {
      ctr.pending = false;
      if (isChord) {                                // este acorde é um alvo do jogo
        const evIdx = ctr.n++;
        const disp = transposeToken(tok, shift);
        const st = statusArr[evIdx];
        const color = st === "hit" ? C.green : st === "miss" ? C.red : evIdx === activeIdx ? C.amber : C.amberDeep;
        const cls = "palco-chord palco-ev" + (evIdx === activeIdx ? " palco-ev-active" : "") + (st === "hit" ? " palco-ev-hit" : st === "miss" ? " palco-ev-miss" : "");
        nodes.push(<span key={i} ref={(el) => { elsRef.current[evIdx] = el; }} className={cls} style={{ color, fontWeight: 700 }} onClick={(e) => onChordTap(disp, e)}>{disp}</span>);
        continue;
      }
    }
    if (isChord) {
      const disp = transposeToken(tok, shift);
      nodes.push(<span key={i} className="palco-chord" style={{ color: C.amber, fontWeight: 700 }} onClick={(e) => onChordTap(disp, e)}>{disp}</span>);
    } else {
      nodes.push(<span key={i}>{tok}</span>);
    }
  }
  return nodes;
}

/* ------------------------ popover de diagrama --------------------- */
function ChordPopover({ data, onClose }) {
  const d = chordDiagram(data.name);
  const style = { position: "fixed", left: data.left, width: 164, zIndex: 50,
    ...(data.place === "above" ? { top: data.top, transform: "translateY(calc(-100% - 10px))" } : { top: data.top + 10 }) };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
      <div style={{ ...style, ...S.popCard }}>
        <div style={S.popHead}><span style={S.popName}>{data.name}</span><button className="palco-btn palco-icon" style={S.popClose} onClick={onClose}><X size={14} strokeWidth={2.4} /></button></div>
        {d ? (<><ChordDiagram frets={d.frets} /><div style={S.popHint}>{d.approx ? "forma aproximada" : "violão · destro"}</div></>) : (<div style={S.popNone}>Diagrama indisponível para este acorde.</div>)}
      </div>
    </>
  );
}
function ChordDiagram({ frets }) {
  const positives = frets.filter((f) => f > 0);
  const maxF = positives.length ? Math.max(...positives) : 0;
  const minF = positives.length ? Math.min(...positives) : 0;
  const base = maxF <= 4 ? 1 : minF;
  const W = 132, H = 150, padX = 16, padTop = 26, gridW = W - padX * 2, FRETS = 5;
  const sx = gridW / 5, fy = (H - padTop - 12) / FRETS;
  const stringX = (s) => padX + s * sx;
  const dark = C.text, faint = C.textFaint;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {base === 1 && <rect x={padX - 1} y={padTop - 3} width={gridW + 2} height={4} fill={dark} rx={1} />}
      {base > 1 && <text x={padX - 6} y={padTop + fy * 0.7} fontSize="11" fill={faint} textAnchor="end" fontFamily={FONT_MONO}>{base}ª</text>}
      {Array.from({ length: FRETS + 1 }).map((_, r) => <line key={"h" + r} x1={padX} y1={padTop + r * fy} x2={padX + gridW} y2={padTop + r * fy} stroke={C.border} strokeWidth={1} />)}
      {Array.from({ length: 6 }).map((_, s) => <line key={"v" + s} x1={stringX(s)} y1={padTop} x2={stringX(s)} y2={padTop + FRETS * fy} stroke={C.border} strokeWidth={1} />)}
      {frets.map((f, s) => {
        const x = stringX(s);
        if (f === -1) return <text key={"x" + s} x={x} y={padTop - 8} fontSize="13" fill={faint} textAnchor="middle">×</text>;
        if (f === 0) return <circle key={"o" + s} cx={x} cy={padTop - 12} r={4} fill="none" stroke={C.textDim} strokeWidth={1.5} />;
        const row = f - base;
        return <circle key={"d" + s} cx={x} cy={padTop + row * fy + fy / 2} r={6.5} fill={C.amber} />;
      })}
    </svg>
  );
}

/* ----------------------------- afinador --------------------------- */
function Tuner({ onClose }) {
  const [state, setState] = useState("idle"); // idle | listening | denied | unsupported
  const [note, setNote] = useState(null); // {name, octave, cents}
  const ctxRef = useRef(null), streamRef = useRef(null), rafRef = useRef(null);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (ctxRef.current && ctxRef.current.state !== "closed") ctxRef.current.close();
  };
  useEffect(() => () => stop(), []);

  const start = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setState("unsupported"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      setState("listening");
      let lastT = 0;
      const loop = (t) => {
        rafRef.current = requestAnimationFrame(loop);
        if (t - lastT < 80) return; lastT = t;
        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, ctx.sampleRate);
        if (freq > 0) setNote(freqToNote(freq));
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) { setState("denied"); }
  };

  const cents = note ? note.cents : 0;
  const inTune = note && Math.abs(cents) <= 5;
  const color = !note ? C.textFaint : inTune ? C.green : Math.abs(cents) <= 15 ? C.amber : C.red;

  return (
    <div style={S.tunerOverlay} onClick={onClose}>
      <div style={S.tunerCard} onClick={(e) => e.stopPropagation()}>
        <div style={S.tunerHead}><div style={{ display: "flex", alignItems: "center", gap: 9 }}><Mic size={18} color={C.amber} strokeWidth={2.2} /><span style={S.tunerTitle}>Afinador</span></div><button className="palco-btn palco-icon" style={S.popClose} onClick={onClose}><X size={16} strokeWidth={2.3} /></button></div>

        {state === "idle" && (
          <div style={S.tunerBody}>
            <Guitar size={40} color={C.textFaint} strokeWidth={1.4} />
            <p style={S.tunerMsg}>Toque uma corda de cada vez. O afinador mostra a nota e se está alta ou baixa.</p>
            <button className="palco-btn palco-primary" style={S.btnPrimary} onClick={start}><Mic size={17} strokeWidth={2.2} /> Permitir microfone</button>
            <p style={S.tunerFine}>Precisa de permissão do microfone. Em página aberta como arquivo local (file://) o navegador costuma bloquear — funciona ao hospedar em https.</p>
          </div>
        )}
        {(state === "denied" || state === "unsupported") && (
          <div style={S.tunerBody}>
            <p style={S.tunerMsg}>{state === "denied" ? "Microfone bloqueado. Autorize o acesso nas permissões do navegador e tente de novo." : "Este navegador não dá acesso ao microfone aqui (comum em arquivo local). Hospede em https para usar o afinador."}</p>
            <button className="palco-btn palco-ghost" style={S.btnGhost} onClick={start}>Tentar de novo</button>
          </div>
        )}
        {state === "listening" && (
          <div style={S.tunerBody}>
            <div style={{ ...S.tunerNote, color }}>{note ? note.name : "—"}<span style={S.tunerOct}>{note ? note.octave : ""}</span></div>
            <div style={S.tunerMeter}>
              <div style={S.tunerCenter} />
              <div style={{ ...S.tunerNeedle, left: `calc(50% + ${Math.max(-50, Math.min(50, cents)) * 0.9}%)`, background: color }} />
            </div>
            <div style={S.tunerScale}><span>♭ baixo</span><span style={{ color: inTune ? C.green : C.textFaint, fontWeight: 600 }}>{note ? (inTune ? "afinado" : `${cents > 0 ? "+" : ""}${cents}`) : "ouvindo…"}</span><span>alto ♯</span></div>
            <p style={S.tunerFine}>Cordas (padrão): E2 · A2 · D3 · G3 · B3 · E4</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------- wordmark ----------------------------- */
function Wordmark({ small }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: small ? 9 : 12 }}>
      <div style={{ width: small ? 30 : 42, height: small ? 30 : 42, borderRadius: small ? 9 : 12, background: `linear-gradient(150deg, ${C.amber}, ${C.amberDeep})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 18px rgba(240,168,51,.28)", flexShrink: 0 }}>
        <Music2 size={small ? 17 : 23} color="#1a140a" strokeWidth={2.4} />
      </div>
      <div style={{ lineHeight: 1 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: small ? 19 : 28, color: C.text, letterSpacing: "0.02em" }}>PALCO</div>
        {!small && <div style={{ fontFamily: FONT_UI, fontSize: 12, color: C.textFaint, letterSpacing: "0.14em", marginTop: 3 }}>CIFRAS AO VIVO</div>}
      </div>
    </div>
  );
}

/* ----------------------------- styles ----------------------------- */
const S = {
  page: { minHeight: "100dvh", height: "100dvh", background: C.bg, color: C.text, fontFamily: FONT_UI, position: "relative", overflow: "hidden" },
  glow: { position: "absolute", top: -200, left: "50%", transform: "translateX(-50%)", width: 700, height: 500, background: `radial-gradient(ellipse at center, ${C.bgGlow} 0%, transparent 70%)`, pointerEvents: "none" },
  albumsWrap: { position: "relative", maxWidth: 980, margin: "0 auto", padding: "calc(44px + env(safe-area-inset-top)) 24px 64px", height: "100%", overflowY: "auto", zIndex: 1 },
  albumsHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 },
  libActions: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" },
  iconGhost: { display: "inline-flex", alignItems: "center", gap: 7, background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "9px 13px", fontFamily: FONT_UI, fontWeight: 500, fontSize: 13.5, cursor: "pointer" },
  iconGhostLabel: { fontSize: 13.5 },
  searchWrap: { display: "flex", alignItems: "center", gap: 9, background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 12, padding: "0 12px", marginBottom: 18 },
  searchInput: { flex: 1, background: "transparent", color: C.text, border: "none", outline: "none", padding: "13px 0", fontFamily: FONT_UI, fontSize: 15 },
  searchClear: { width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", color: C.textFaint, border: "none", borderRadius: 7, cursor: "pointer" },
  libMsg: { padding: "11px 15px", background: "rgba(121,183,166,.10)", border: `1px solid rgba(121,183,166,.3)`, borderRadius: 11, color: C.teal, fontSize: 13.5, marginBottom: 18 },
  storageNote: { padding: "11px 15px", background: "rgba(224,104,60,.10)", border: `1px solid rgba(224,104,60,.3)`, borderRadius: 11, color: C.textDim, fontSize: 13, marginBottom: 18 },
  albumGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 },
  albumCard: { textAlign: "left", display: "flex", flexDirection: "column", gap: 4, background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 16, padding: "18px 18px 20px", cursor: "pointer" },
  albumTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, minHeight: 46 },
  albumIcon: { width: 46, height: 46, borderRadius: 12, background: C.surface2, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" },
  albumTrash: { width: 32, height: 32, borderRadius: 9, background: "transparent", color: C.textFaint, border: `1px solid transparent`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  confirmRow: { display: "flex", gap: 6 },
  confirmYes: { width: 32, height: 32, borderRadius: 9, background: "rgba(224,104,60,.18)", color: C.red, border: `1px solid ${C.red}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  confirmNo: { width: 32, height: 32, borderRadius: 9, background: C.surface2, color: C.textDim, border: `1px solid ${C.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  albumName: { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 17, color: C.text, lineHeight: 1.25 },
  albumCount: { fontSize: 12.5, color: C.textFaint },
  emptyAlbums: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "60px 24px", gap: 7 },
  resultItem: { width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: "12px 14px", border: `1px solid ${C.borderSoft}`, borderRadius: 11, cursor: "pointer", background: C.surface, marginBottom: 8 },
  resultMeta: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 14.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  resultAlbum: { fontSize: 12, color: C.textFaint },
  importWrap: { position: "relative", maxWidth: 720, margin: "0 auto", padding: "calc(32px + env(safe-area-inset-top)) 24px 64px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", zIndex: 1 },
  importBack: { alignSelf: "flex-start", display: "inline-flex", alignItems: "center", background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "8px 13px 8px 9px", fontFamily: FONT_UI, fontWeight: 500, fontSize: 13.5, cursor: "pointer", marginBottom: 22 },
  importTitle: { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, color: C.text, margin: 0 },
  tagline: { color: C.textDim, fontSize: 15, lineHeight: 1.6, margin: "12px 0 0", maxWidth: 600 },
  code: { fontFamily: FONT_MONO, fontSize: 12.5, background: C.surface2, color: C.text, padding: "2px 7px", borderRadius: 6, border: `1px solid ${C.border}` },
  textarea: { marginTop: 20, width: "100%", minHeight: 280, flex: "1 1 auto", resize: "vertical", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px", fontFamily: FONT_MONO, fontSize: 14, lineHeight: 1.6 },
  errorBox: { marginTop: 14, padding: "12px 15px", background: "rgba(224,104,60,.10)", border: `1px solid rgba(224,104,60,.35)`, borderRadius: 11, color: "#eaa389", fontSize: 13.5, lineHeight: 1.5 },
  importActions: { display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 9, background: C.amberDeep, color: "#1a140a", border: "none", borderRadius: 11, padding: "13px 22px", fontFamily: FONT_UI, fontWeight: 600, fontSize: 15, cursor: "pointer" },
  btnGhost: { display: "inline-flex", alignItems: "center", gap: 8, background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 11, padding: "13px 18px", fontFamily: FONT_UI, fontWeight: 500, fontSize: 14, cursor: "pointer" },
  previewHead: { display: "flex", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12, fontFamily: FONT_UI, fontWeight: 600, fontSize: 15, color: C.text },
  previewList: { maxHeight: 280, overflowY: "auto", border: `1px solid ${C.borderSoft}`, borderRadius: 12, background: C.surface, padding: 6 },
  previewItem: { display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 8 },
  previewNum: { fontFamily: FONT_MONO, fontSize: 12, color: C.textFaint, width: 22, flexShrink: 0 },
  previewTitle: { fontFamily: FONT_UI, fontSize: 14.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  fieldLabel: { display: "block", marginTop: 22, marginBottom: 8, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint, fontWeight: 600 },
  input: { width: "100%", background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 11, padding: "13px 15px", fontFamily: FONT_UI, fontSize: 15 },
  appendRow: { marginTop: 26 },
  appendLabel: { fontSize: 13.5, color: C.textDim },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 9, marginTop: 11 },
  chip: { display: "inline-flex", alignItems: "center", gap: 7, background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 99, padding: "8px 14px", fontFamily: FONT_UI, fontWeight: 500, fontSize: 13.5, cursor: "pointer" },
  appShell: { position: "relative", display: "flex", height: "100%", zIndex: 1 },
  sidebar: { display: "flex", flexDirection: "column", height: "100%", background: C.bg, flexShrink: 0 },
  sidebarHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(18px + env(safe-area-inset-top)) 16px 14px" },
  sideBack: { display: "inline-flex", alignItems: "center", background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 9, padding: "7px 12px 7px 8px", fontFamily: FONT_UI, fontWeight: 500, fontSize: 13, cursor: "pointer" },
  newBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 9, padding: "7px 12px", fontFamily: FONT_UI, fontWeight: 500, fontSize: 13, cursor: "pointer" },
  repHeader: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "6px 20px 12px", borderBottom: `1px solid ${C.borderSoft}` },
  albumNameSide: { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  repCount: { fontSize: 12, color: C.textFaint, flexShrink: 0 },
  songList: { flex: 1, overflowY: "auto", padding: "10px 12px 24px" },
  songItem: { width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: "11px 12px", border: "1px solid transparent", borderRadius: 11, cursor: "pointer", background: "transparent", marginBottom: 2 },
  songNum: { fontFamily: FONT_MONO, fontSize: 12, fontWeight: 500, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid", flexShrink: 0 },
  songMeta: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 },
  songTitle: { fontFamily: FONT_UI, fontWeight: 500, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  songSub: { fontSize: 11.5, color: C.textFaint },
  songChev: { color: C.textFaint, fontSize: 22, lineHeight: 1, transition: "all .15s ease" },
  starBtn: { width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 7, cursor: "pointer", flexShrink: 0 },
  main: { flex: 1, display: "flex", flexDirection: "column", height: "100%", minWidth: 0, background: C.bg, borderLeft: `1px solid ${C.borderSoft}` },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, textAlign: "center" },
  emptyIcon: { width: 64, height: 64, borderRadius: 18, background: C.surface, border: `1px solid ${C.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyTitle: { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 19, color: C.textDim, margin: 0 },
  emptySub: { fontSize: 14, color: C.textFaint, margin: 0, maxWidth: 360, lineHeight: 1.5 },
  viewerHead: { display: "flex", alignItems: "center", gap: 10, padding: "calc(14px + env(safe-area-inset-top)) 16px 14px", borderBottom: `1px solid ${C.borderSoft}`, flexShrink: 0 },
  backBtn: { display: "inline-flex", alignItems: "center", background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "8px 13px 8px 10px", fontFamily: FONT_UI, fontWeight: 500, fontSize: 13.5, cursor: "pointer", flexShrink: 0 },
  viewerTitle: { flex: 1, fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, color: C.text, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  headStar: { width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 10, cursor: "pointer", flexShrink: 0 },
  headControls: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  autoBtn: { display: "inline-flex", alignItems: "center", border: "1px solid", borderRadius: 10, padding: "8px 12px", cursor: "pointer" },
  fontControls: { display: "flex", alignItems: "center", gap: 4, background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: 4 },
  fontBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, background: "transparent", color: C.textDim, border: "none", borderRadius: 7, cursor: "pointer" },
  fontVal: { fontFamily: FONT_MONO, fontSize: 12.5, color: C.textDim, width: 22, textAlign: "center" },
  toolsBar: { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${C.borderSoft}`, flexShrink: 0, overflowX: "auto" },
  toolGroup: { display: "flex", alignItems: "center", gap: 4, background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "4px 6px 4px 10px", flexShrink: 0 },
  toolLabel: { fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint, fontWeight: 600, marginRight: 2 },
  toolBtn: { width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", color: C.textDim, border: "none", borderRadius: 7, cursor: "pointer" },
  toolVal: { fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, minWidth: 26, textAlign: "center" },
  toolReset: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 9, cursor: "pointer", flexShrink: 0 },
  tunerBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: C.surface, color: C.textDim, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "8px 14px", fontFamily: FONT_UI, fontWeight: 600, fontSize: 13.5, cursor: "pointer", flexShrink: 0, marginLeft: "auto" },
  cifraScroll: { flex: 1, overflowY: "auto", overflowX: "auto", scrollBehavior: "auto" },
  cifra: { fontFamily: FONT_MONO, padding: "24px 26px 0", maxWidth: 900, margin: "0 auto" },
  transportZone: { padding: "0 18px calc(18px + env(safe-area-inset-bottom))", flexShrink: 0, background: `linear-gradient(to top, ${C.bg} 60%, transparent)` },
  transport: { display: "flex", alignItems: "center", gap: 18, maxWidth: 720, margin: "0 auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: "14px 18px", boxShadow: "0 12px 40px rgba(0,0,0,.45)" },
  playBtn: { width: 56, height: 56, borderRadius: "50%", border: "1px solid", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "all .15s ease" },
  speedBlock: { flex: 1, minWidth: 0 },
  speedTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 },
  speedLabel: { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint, fontWeight: 600 },
  speedVal: { fontFamily: FONT_MONO, fontSize: 14, color: C.amber, fontWeight: 600 },
  speedScale: { display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 11, color: C.textFaint },
  resetBtn: { width: 44, height: 44, borderRadius: 12, background: C.surface2, color: C.textDim, border: `1px solid ${C.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
  popCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, boxShadow: "0 16px 50px rgba(0,0,0,.6)" },
  popHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  popName: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: 700, color: C.amber },
  popClose: { width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", color: C.textFaint, border: "none", borderRadius: 7, cursor: "pointer" },
  popHint: { fontSize: 10.5, color: C.textFaint, textAlign: "center", marginTop: 4, letterSpacing: "0.04em" },
  popNone: { fontSize: 12.5, color: C.textDim, padding: "10px 4px", textAlign: "center" },
  tunerOverlay: { position: "fixed", inset: 0, background: "rgba(8,6,4,.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 },
  tunerCard: { width: "100%", maxWidth: 380, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: 20, boxShadow: "0 24px 70px rgba(0,0,0,.6)" },
  tunerHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  tunerTitle: { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 18, color: C.text },
  tunerBody: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "18px 6px 6px", textAlign: "center" },
  tunerMsg: { fontSize: 14, color: C.textDim, lineHeight: 1.55, margin: 0, maxWidth: 300 },
  tunerFine: { fontSize: 11.5, color: C.textFaint, lineHeight: 1.5, margin: 0, maxWidth: 320 },
  tunerNote: { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 76, lineHeight: 1 },
  tunerOct: { fontSize: 22, marginLeft: 4, opacity: 0.7 },
  tunerMeter: { position: "relative", width: "100%", height: 10, background: C.surface2, borderRadius: 99, overflow: "hidden" },
  tunerCenter: { position: "absolute", left: "50%", top: -3, width: 2, height: 16, background: C.textFaint, transform: "translateX(-50%)" },
  tunerNeedle: { position: "absolute", top: -2, width: 6, height: 14, borderRadius: 3, transform: "translateX(-50%)", transition: "left .08s linear, background .1s" },
  tunerScale: { display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, color: C.textFaint },
  // ----- Modo Jogo -----
  modeSeg: { display: "flex", background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: 3, gap: 3, flexShrink: 0 },
  seg: { border: "none", background: "transparent", color: C.textDim, fontFamily: FONT_UI, fontWeight: 600, fontSize: 12.5, padding: "6px 12px", borderRadius: 8, cursor: "pointer" },
  segActive: { border: "none", background: C.amber, color: "#1a140a", fontFamily: FONT_UI, fontWeight: 700, fontSize: 12.5, padding: "6px 12px", borderRadius: 8, cursor: "pointer" },
  cifraWrap: { position: "relative", flex: 1, minHeight: 0, display: "flex" },
  hitLine: { position: "absolute", left: 0, right: 0, top: "38%", borderTop: `2px dashed ${C.amber}`, opacity: 0.45, pointerEvents: "none" },
  gamePanel: { maxWidth: 720, margin: "0 auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: "12px 16px", boxShadow: "0 12px 40px rgba(0,0,0,.45)" },
  gameInfo: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: C.textDim, lineHeight: 1.5 },
  gameRow: { display: "flex", alignItems: "center", gap: 16 },
  gameHint: { fontSize: 12, color: C.textFaint },
  gameBig: { fontFamily: FONT_MONO, fontWeight: 700, fontSize: 34, minWidth: 70, textAlign: "center", transition: "color .12s" },
  gameStats: { flex: 1, minWidth: 0 },
  gameStatLine: { display: "flex", gap: 14, fontFamily: FONT_MONO, fontSize: 15, fontWeight: 600 },
  gameCountWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  gameCount: { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 44, color: C.amber, lineHeight: 1 },
  scoreCard: { width: "100%", maxWidth: 380, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: 20, boxShadow: "0 24px 70px rgba(0,0,0,.6)" },
  scoreBody: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 6px 6px", textAlign: "center" },
  scoreGrade: { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 72, lineHeight: 1 },
  scorePct: { fontFamily: FONT_MONO, fontWeight: 700, fontSize: 30 },
  scoreLabel: { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 17 },
  scoreSub: { fontSize: 13, color: C.textFaint, marginTop: 2, maxWidth: 300, lineHeight: 1.5 },
  scoreActions: { display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", justifyContent: "center" },
};
