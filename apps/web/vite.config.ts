import { execFileSync } from "node:child_process";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { devtools } from "@tanstack/devtools-vite";
import { visualizer } from "rollup-plugin-visualizer";
import UnoCSS from "unocss/vite";
import solid from "vite-plugin-solid";
import type { Plugin } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";
import { unicodeEmojis } from "./emoji-data-plugin";
import { releaseNotes } from "./release-notes-plugin";

const commitSha = (): string => {
  const provided = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (provided) return provided.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
};

/**
 * Sentry へソースマップを送る。送り先の鍵（`SENTRY_AUTH_TOKEN`）が無ければ
 * 何もしない —— 手元のビルドや、鍵を持たない CI でも落ちないようにする。
 * 鍵と組織名は `VITE_` を付けない。付けると画面側へ混ざってしまう。
 */
const sentryUpload = (release: string) => {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!authToken || !org || !project) return [];
  return [
    sentryVitePlugin({
      authToken,
      org,
      project,
      // 画面側が送る `release` と同じ名前にしないと、送ったマップが結び付かない。
      release: { name: release },
      sourcemaps: {
        // 送ったあとは配らない。ソースが誰からでも読めてしまう。
        filesToDeleteAfterUpload: ["./dist/**/*.js.map"],
      },
      // 送れなくてもデプロイは続ける（読みにくいスタックのまま出る）。
      errorHandler: (error) => {
        console.warn("Sentry へソースマップを送れませんでした", error.message);
      },
    }),
  ];
};

/**
 * `vp run @streets/web#build:analyze` のときだけ、チャンクの中身を面積で描いた図を `stats/` に出す。
 * `dist` に置くと、そのまま本番に配られてしまう。
 */
const analyze = (mode: string) =>
  mode === "analyze"
    ? [
        visualizer({
          filename: "stats/chunks.html",
          template: "treemap",
          gzipSize: true,
          brotliSize: true,
        }),
      ]
    : [];

/**
 * 配る JS の頭に、ライセンスの在りかを書く。縮めた後に足すので消えない。
 * 先読みの一覧（`__vite__mapDeps`）を持つチャンクでは、Vite がその前に差し込むので 2 行目になる。
 */
const licenseBanner = (base: string) =>
  `/*! Licenses of bundled dependencies: ${base}license.md */`;

const pagesAssets = (base: string): Plugin => ({
  name: "streets:pages-assets",
  transformIndexHtml(html) {
    return html.replaceAll(
      "https://streets.eyemono.moe/",
      `https://amano-takahisa.github.io${base}`,
    );
  },
  async generateBundle() {
    const manifest = await readFile(
      new URL("./public/manifest.webmanifest", import.meta.url),
      "utf8",
    );
    this.emitFile({
      type: "asset",
      fileName: "manifest.webmanifest",
      source: manifest.replaceAll('"/', `"${base}`),
    });
    this.emitFile({
      type: "asset",
      fileName: "LICENCE",
      source: await readFile(new URL("../../LICENCE", import.meta.url)),
    });
  },
  async writeBundle({ dir }) {
    // GitHub Pages は直に開いた投稿やプロフィールに、この HTML を元の URL のまま返す。
    if (dir) await copyFile(join(dir, "index.html"), join(dir, "404.html"));
  },
});

/**
 * 共有の受け口（Service Worker）を `/sw.js` に出す。Service Worker が受け持てるのは
 * 置いた場所より下だけなので、ほかのチャンクのように `assets/` へ置けず、名前に
 * ハッシュも付けられない（登録する側が名前を知っている必要がある）。
 */
const shareWorker = (): Plugin => ({
  name: "streets:share-worker",
  apply: "build",
  buildStart() {
    this.emitFile({
      type: "chunk",
      id: "/src/share/sw.ts",
      fileName: "sw.js",
    });
  },
});

const commit = commitSha();

/**
 * Sentry の release の名前。タグのビルドは版の名前（`v1.5.1`）にし、Sentry の
 * 画面で版ごとの数字を読めるようにする。それ以外はコミットで区別する。
 */
const release =
  process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME
    ? process.env.GITHUB_REF_NAME
    : commit;

export default defineConfig(({ mode }) => {
  const pages = mode === "pages";
  const base = pages ? "/streets/" : "/";
  const postBanner = licenseBanner(base);

  return {
    base,
    define: {
      "import.meta.env.VITE_PAGES": JSON.stringify(pages),
      ...(pages && {
        "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(""),
        "import.meta.env.VITE_FEEDBACK_URL": JSON.stringify(""),
      }),
      "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(commit),
      "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(release),
      // Sentry から、使っていない機能（デバッグ出力）を落とす。
      __SENTRY_DEBUG__: "false",
    },
    plugins: lazyPlugins(() => [
      ...devtools(),
      UnoCSS(),
      solid(),
      releaseNotes(),
      unicodeEmojis(),
      shareWorker(),
      ...(pages ? [pagesAssets(base)] : sentryUpload(release)),
      ...analyze(mode),
    ]),
    // Worker は別にまとめられ、`build.rolldownOptions` が届かない。
    worker: { rolldownOptions: { output: { postBanner } } },
    build: {
      outDir: pages ? "dist-pages" : "dist",
      // Vite 7 以降の既定（Baseline Widely Available）と同じ。Vite 6 の既定では
      // core のクラスの private フィールド（`#events` など）が WeakMap の呼び出しに
      // 書き換えられ、イベントを読むたびに余計な手間がかかる。
      target: ["chrome107", "edge107", "firefox104", "safari16"],
      // 送るときだけ作る。配らずに消すので、公開されるものは変わらない。
      sourcemap: !pages && Boolean(process.env.SENTRY_AUTH_TOKEN),
      // 同梱した依存のライセンスを、ほかの静的ファイルと並べて `/license.md` で配る。
      license: { fileName: "license.md" },
      rolldownOptions: { output: { postBanner } },
    },
    server: {
      port: 5173,
      // 本番では Worker（workers/app）が受ける /api を、`wrangler dev` へ渡す。
      // ルートの `vp run dev` が両方を立ち上げる。
      proxy: { "/api": "http://localhost:8787" },
    },
  };
});
