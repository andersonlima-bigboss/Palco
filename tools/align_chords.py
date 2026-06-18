# -*- coding: utf-8 -*-
"""
Alinhamento forçado de acordes -> tempos, para o Modo Jogo do Palco.

Ideia: a cifra JÁ tem os acordes na ordem certa. Não precisamos reconhecer
"qual" acorde é — só descobrir "quando" cada um acontece. Fazemos isso casando
a sequência conhecida de acordes ao cromagrama do áudio via programação dinâmica
(alinhamento forçado monotônico, estilo DTW/HMM).

Uso:
    python tools/align_chords.py <audio.mp3|wav> <cifra.txt> [saida.txt]

Saída: a mesma cifra com [mm:ss] inserido antes de cada acorde (pronta pro app),
impressa no terminal e gravada em [saida.txt] (default: <cifra>.timed.txt).
"""
import sys, re, io

CHORD_RE = re.compile(r"^\(?[A-G][#b]?(?:maj7|maj9|maj|min|dim7|dim|aug|sus2|sus4|sus|add9|add11|add|7M|13|11|9|7|6|5|4|2|m|M|°|º|\+)*(?:\([#b]?\d+\))?(?:/[A-G][#b]?)?\)?$")
STRUCT_RE = re.compile(r"^(\||x\d+|%|\(\d+x?\)|N\.?C\.?|–|-|:)$", re.I)
TIME_RE = re.compile(r"\[\d{1,2}:\d{2}(?:\.\d+)?\]\s?")

NOTE_TO_I = {"C":0,"C#":1,"Db":1,"D":2,"D#":3,"Eb":3,"E":4,"F":5,"F#":6,"Gb":6,
             "G":7,"G#":8,"Ab":8,"A":9,"A#":10,"Bb":10,"B":11}

def is_chord_token(tok):
    return bool(CHORD_RE.match(tok))

def is_chord_line(line):
    t = line.strip()
    if not t:
        return False
    toks = t.split()
    hits = real = 0
    for tk in toks:
        if is_chord_token(tk):
            hits += 1; real += 1
        elif STRUCT_RE.match(tk):
            hits += 1
    return real >= 1 and hits / len(toks) >= 0.7

def chord_template(chord):
    """Vetor de 12 classes de altura esperado para o acorde (pesos)."""
    core = chord.lstrip("(").rstrip(")")
    core = core.split("/")[0]
    m = re.match(r"^([A-G][#b]?)(.*)$", core)
    if not m:
        return None
    root = NOTE_TO_I.get(m.group(1))
    if root is None:
        return None
    suf = m.group(2)
    minor = bool(re.match(r"^(m|min)(?!aj)", suf))
    third = 3 if minor else 4
    vec = [0.0] * 12
    vec[root] += 1.0                       # tônica
    vec[(root + third) % 12] += 0.9        # terça
    vec[(root + 7) % 12] += 0.8            # quinta
    if re.search(r"(maj7|7M|M7)", suf):
        vec[(root + 11) % 12] += 0.5
    elif "7" in suf:
        vec[(root + 10) % 12] += 0.5       # 7ª menor (dominante)
    return vec

def parse_cifra(text):
    """Retorna (linhas, lista de acordes na ordem). Cada acorde: (line_idx, tok_start, tok_end, label)."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    chords = []
    for li, line in enumerate(lines):
        clean = TIME_RE.sub("", line)      # remove [mm:ss] que já existam
        lines[li] = clean
        if not is_chord_line(clean):
            continue
        for mt in re.finditer(r"\S+", clean):
            tok = mt.group(0)
            if is_chord_token(tok):
                chords.append((li, mt.start(), mt.end(), tok))
    return lines, chords

def forced_align(chroma, templates):
    """DP monotônico: cada coluna de tempo recebe um índice de acorde não-decrescente.
    Retorna os tempos (em frames) de início de cada acorde."""
    import numpy as np
    T = chroma.shape[1]
    N = len(templates)
    tpl = np.array(templates, dtype=float)                 # N x 12
    tpl /= (np.linalg.norm(tpl, axis=1, keepdims=True) + 1e-9)
    ch = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)  # 12 x T
    sim = tpl @ ch                                         # N x T (cosseno)
    cost = 1.0 - sim                                       # N x T
    INF = 1e18
    dp = np.full((N, T), INF)
    bp = np.zeros((N, T), dtype=np.int8)                  # 0 = mesmo acorde, 1 = veio do anterior
    dp[0, 0] = cost[0, 0]
    for t in range(1, T):
        dp[0, t] = dp[0, t - 1] + cost[0, t]              # acorde 0 ocupa o começo
    for i in range(1, N):
        for t in range(i, T):
            stay = dp[i, t - 1]
            diag = dp[i - 1, t - 1]
            if stay <= diag:
                dp[i, t] = stay + cost[i, t]; bp[i, t] = 0
            else:
                dp[i, t] = diag + cost[i, t]; bp[i, t] = 1
    # backtrack
    starts = [0] * N
    i, t = N - 1, T - 1
    while t >= 0 and i >= 0:
        if bp[i, t] == 1 or t == 0:
            starts[i] = t
            i -= 1
        t -= 1
    starts[0] = 0
    return starts

def fmt_time(sec):
    m = int(sec // 60); s = sec - m * 60
    return f"[{m:02d}:{s:05.2f}]".replace(".00]", "]") if s % 1 else f"[{m:02d}:{int(s):02d}]"

def main():
    if len(sys.argv) < 3:
        print("Uso: python tools/align_chords.py <audio> <cifra.txt> [saida.txt]"); sys.exit(1)
    audio_path, cifra_path = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else cifra_path.rsplit(".", 1)[0] + ".timed.txt"

    with io.open(cifra_path, encoding="utf-8") as f:
        cifra = f.read()
    lines, chords = parse_cifra(cifra)
    if not chords:
        print("Nenhum acorde encontrado na cifra."); sys.exit(1)
    templates = [chord_template(c[3]) or [0.0] * 12 for c in chords]
    print(f"Acordes na cifra: {len(chords)}")

    import numpy as np, librosa
    print("Carregando áudio...")
    y, sr = librosa.load(audio_path, mono=True)
    y = librosa.effects.harmonic(y, margin=3.0)            # tira percussão/voz
    hop = 2048
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    dur = librosa.get_duration(y=y, sr=sr)
    print(f"Duração: {dur:.1f}s  | frames: {chroma.shape[1]}")

    starts = forced_align(chroma, templates)
    times = librosa.frames_to_time(starts, sr=sr, hop_length=hop)

    # insere [mm:ss] antes de cada acorde (de trás pra frente p/ não bagunçar índices)
    for (li, a, b, tok), t in sorted(zip(chords, times), key=lambda z: (z[0][0], z[0][1]), reverse=True):
        lines[li] = lines[li][:a] + fmt_time(t) + " " + lines[li][a:]
    out = "\n".join(lines)

    with io.open(out_path, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"\n=== CIFRA COM TEMPOS (salva em {out_path}) ===\n")
    print(out)

if __name__ == "__main__":
    main()
