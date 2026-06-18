# -*- coding: utf-8 -*-
"""
Alinhamento de LETRA com áudio (karaokê palavra-por-palavra) para o Palco.

Estratégia:
  1. faster-whisper transcreve a voz cantada -> palavras com tempo (start/end).
  2. A letra "gabarito" vem da cifra (linhas de letra, sem acordes/seções).
  3. Casamos as palavras reconhecidas com as palavras da cifra (difflib) e
     transferimos os tempos. Palavras sem match recebem tempo interpolado.
  4. Saída: JSON { words: [{li, wi, t}], lines: [{li, t0, t1}] } gravado em out.

Uso:
    python tools/align_lyrics.py <audio> <cifra.txt> [saida.json] [modelo]
    (modelo: tiny|base|small|medium  — default: small)
"""
import sys, re, io, json, unicodedata, difflib

CHORD_RE = re.compile(r"^\(?[A-G][#b]?(?:maj7|maj9|maj|min|dim7|dim|aug|sus2|sus4|sus|add9|add11|add|7M|13|11|9|7|6|5|4|2|m|M|°|º|\+)*(?:\([#b]?\d+\))?(?:/[A-G][#b]?)?\)?$")
STRUCT_RE = re.compile(r"^(\||x\d+|%|\(\d+x?\)|N\.?C\.?|–|-|:)$", re.I)
TIME_RE = re.compile(r"\[\d{1,2}:\d{2}(?:\.\d+)?\]\s?")

def is_chord_token(tok):
    return bool(CHORD_RE.match(tok))

def is_chord_line(line):
    t = line.strip()
    if not t:
        return False
    toks = t.split()
    hits = real = 0
    for tk in toks:
        if is_chord_token(tk): hits += 1; real += 1
        elif STRUCT_RE.match(tk): hits += 1
    return real >= 1 and hits / len(toks) >= 0.7

def is_section_line(line):
    t = line.strip()
    if not t: return False
    if re.match(r"^[\[(].+[\])]$", t): return True
    if len(t) <= 24 and re.match(r"^[\wÀ-ÿ ºª.°/-]+:$", t) and not is_chord_line(t): return True
    return False

def norm(w):
    w = unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9']", "", w.lower())

def extract_lyric_words(text):
    """Palavras de letra na ordem: lista de (li, wi, norm) + linhas de letra."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    words = []
    lyric_lines = []
    for li, line in enumerate(lines):
        clean = TIME_RE.sub("", line)
        if not clean.strip() or is_chord_line(clean) or is_section_line(clean):
            continue
        lyric_lines.append(li)
        for mt in re.finditer(r"\S+", clean):
            n = norm(mt.group(0))
            if n:
                words.append([li, len(words), n, mt.start()])  # li, ordinal, norm, char pos
    # reindexa wi por linha
    per_line = {}
    out = []
    for li, _, n, pos in words:
        wi = per_line.get(li, 0); per_line[li] = wi + 1
        out.append({"li": li, "wi": wi, "n": n, "pos": pos})
    return out, lyric_lines

def main():
    if len(sys.argv) < 3:
        print("Uso: python tools/align_lyrics.py <audio> <cifra.txt> [saida.json] [modelo]"); sys.exit(1)
    audio_path = sys.argv[1]
    cifra_path = sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else cifra_path.rsplit(".", 1)[0] + ".sync.json"
    model_name = sys.argv[4] if len(sys.argv) > 4 else "small"

    with io.open(cifra_path, encoding="utf-8") as f:
        cifra = f.read()
    cwords, lyric_lines = extract_lyric_words(cifra)
    if not cwords:
        print("Nenhuma palavra de letra encontrada na cifra."); sys.exit(1)
    print(f"Palavras de letra na cifra: {len(cwords)}")

    import numpy as np, librosa
    from faster_whisper import WhisperModel
    print("Carregando áudio (16kHz mono)...")
    y, sr = librosa.load(audio_path, sr=16000, mono=True)
    print(f"Transcrevendo com Whisper '{model_name}' (pode levar 1-3 min)...")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        y, language="en", word_timestamps=True,
        vad_filter=False,                 # VAD é p/ fala e descarta canto -> desligado
        beam_size=5, best_of=5,
        condition_on_previous_text=False, # evita arrastar erro entre versos repetidos
        no_speech_threshold=0.85,
        temperature=[0.0, 0.2, 0.4],
    )

    awords = []
    for seg in segments:
        for w in (seg.words or []):
            n = norm(w.word)
            if n:
                awords.append({"n": n, "t0": float(w.start), "t1": float(w.end)})
    print(f"Palavras reconhecidas no áudio: {len(awords)}")
    if not awords:
        print("Whisper não reconheceu palavras (voz abafada?). Tente um modelo maior ou isolar o vocal."); sys.exit(1)

    # alinhamento por sequência (difflib) entre normalizados
    A = [w["n"] for w in awords]
    B = [w["n"] for w in cwords]
    sm = difflib.SequenceMatcher(None, A, B, autojunk=False)
    for w in cwords:
        w["t"] = None
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                cwords[j1 + k]["t"] = awords[i1 + k]["t0"]
        elif tag == "replace":
            # distribui os tempos do bloco de áudio sobre as palavras da cifra
            span = awords[i1:i2]
            n = j2 - j1
            if span and n > 0:
                for k in range(n):
                    idx = min(len(span) - 1, int(k * len(span) / n))
                    cwords[j1 + k]["t"] = span[idx]["t0"]

    # interpola palavras sem tempo entre vizinhos com tempo
    known = [(i, w["t"]) for i, w in enumerate(cwords) if w["t"] is not None]
    if known:
        # antes do primeiro conhecido
        first_i, first_t = known[0]
        for i in range(first_i):
            cwords[i]["t"] = first_t
        # entre conhecidos
        for (ia, ta), (ib, tb) in zip(known, known[1:]):
            for i in range(ia + 1, ib):
                frac = (i - ia) / (ib - ia)
                cwords[i]["t"] = ta + (tb - ta) * frac
        # depois do último
        last_i, last_t = known[-1]
        for i in range(last_i + 1, len(cwords)):
            cwords[i]["t"] = last_t
    # monotonia
    last = 0.0
    for w in cwords:
        if w["t"] is None or w["t"] < last:
            w["t"] = last
        last = w["t"]

    # tempos por linha (t0 = 1ª palavra, t1 = última palavra da linha)
    lines = {}
    for w in cwords:
        li = w["li"]
        if li not in lines: lines[li] = [w["t"], w["t"]]
        else:
            lines[li][0] = min(lines[li][0], w["t"])
            lines[li][1] = max(lines[li][1], w["t"])
    sync = {
        "words": [{"li": w["li"], "wi": w["wi"], "t": round(w["t"], 2)} for w in cwords],
        "lines": [{"li": li, "t0": round(v[0], 2), "t1": round(v[1], 2)} for li, v in sorted(lines.items())],
    }
    with io.open(out_path, "w", encoding="utf-8") as f:
        json.dump(sync, f, ensure_ascii=False, indent=0)
    print(f"\nSync salvo em {out_path}  ({len(sync['words'])} palavras, {len(sync['lines'])} linhas)\n")

    # prévia legível
    body_lines = cifra.replace("\r\n", "\n").split("\n")
    print("=== PRÉVIA (primeiras linhas de letra com tempo) ===")
    shown = 0
    for ln in sync["lines"]:
        li = ln["li"]
        txt = TIME_RE.sub("", body_lines[li]).strip()
        m = int(ln["t0"] // 60); s = ln["t0"] - m * 60
        print(f"[{m:02d}:{s:05.2f}] {txt}")
        shown += 1
        if shown >= 18: break

if __name__ == "__main__":
    main()
