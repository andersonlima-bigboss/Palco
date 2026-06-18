# Palco — Cifras ao Vivo

Visualizador de cifras com rolagem automática, pensado para tocar ao vivo (palco, ensaio, ambientes escuros). App **offline**, empacotado num **único `index.html`** que abre por um endereço `https://` ou na tela inicial do celular como um app.

> **Para o Claude Code / quem for editar:** edite sempre o código-fonte em `src/`, nunca o `index.html`/`dist/index.html` (que são gerados e minificados pelo build).

---

## Estrutura

```
palco/
├── src/
│   ├── Palco.jsx        → componente principal (TODA a lógica e UI estão aqui)
│   └── main.jsx         → ponto de entrada (monta o React no #root)
├── assets/              → ícones do app (gerados por generate-icons.mjs)
├── dist/index.html      → cópia do build
├── index.html           → arquivo FINAL publicado pelo GitHub Pages (gerado)
├── generate-icons.mjs   → cria ícones provisórios sem dependências
├── build.mjs            → script de build/dev (esbuild)
└── package.json
```

Tudo é um componente React só (`src/Palco.jsx`), com estilos inline. As fontes vêm do Google Fonts (Inter, Space Grotesk, JetBrains Mono) com fallback, então funciona offline.

---

## Como rodar (desenvolvimento)

Pré-requisito: **Node.js 18+**.

```bash
npm install        # instala React e esbuild (uma vez)
npm run icons      # gera os ícones (uma vez)
npm run dev        # servidor local em http://localhost:8000
```

Edite `src/Palco.jsx`, salve e **atualize a página** no navegador.

- `npm run build` — gera `index.html` (raiz) e `dist/index.html`, uma vez.

---

## Como publicar (GitHub Pages)

1. `npm run build` — gera o `index.html` na raiz.
2. Faça commit e push para o GitHub.
3. No GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. O site fica em `https://SEU-USUARIO.github.io/SEU-REPO/` — abre no celular e dá pra compartilhar.
5. No Chrome do celular: menu **⋮ → Instalar app / Adicionar à tela inicial**.

Em `https://` (ou no ícone instalado), a persistência dos álbuns funciona e o microfone do afinador é liberado.
