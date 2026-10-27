# UKTurks → Nuvio provider set

The UK Turks app's stream pipeline, reimplemented as **Nuvio plugins** — JavaScript
that runs **inside the Nuvio app** in the Hermes runtime. No server, no PC, nothing
running at home.

```
manifest.json          plugin repository manifest (array of provider entries)
providers/chq.js       CHQ API (chq-api.ddns.me), direct JSON
providers/vidsrc.js    vsembed.ru -> vs_src.php -> player -> stream list
providers/twoembed.js  2embed.online -> 2embed.stream sources payload
providers/multiembed.js getsuperembed.link -> streamingnow.mov
providers/primesrc.js  primesrc.me server keys
providers/hdhub.js     HdHub Stremio-protocol pass-through (disabled: mirror dead)
providers/_shared.js   canonical helper source — inlined per provider, never imported
test.js                Node smoke test (local proof only)
```

Every provider is a **single self-contained file**: no `import`, no `require` of
local files, no `async/await` (Hermes rejects it in dynamically loaded code), no
Node builtins. Paste-ready for the app's loader.

## Install — no hosting required beyond a static file

Nuvio stores the **manifest URL**, not a copy of the repo. A raw Git file is enough;
there is no always-on process anywhere.

1. Push this folder to a public repo (or a gist with the same tree).
2. Take the raw manifest URL:
   ```
   https://raw.githubusercontent.com/<you>/<repo>/main/manifest.json
   ```
3. Nuvio → **Settings → Content & Discovery → Plugins → Add Repository** → paste → Refresh.
4. Enable the individual providers. Adding the repo does not enable any of them.

**Sideloaded builds only.** Store builds have the plugin runtime compiled out.

Alternative with no GitHub account: any static host that serves raw files (a
public gist, a Cloudflare Pages drop, a file on a NAS exposed over HTTPS). The app
only ever does two GETs — the manifest, then each provider `.js`.

## Local testing before you publish

```bash
node test.js 550 movie
node test.js 1399 tv 1 1
```

Node verifies the scrape logic only. Hermes differs — the real gate is
**Settings → Developer Section → Plugin Tester** in a debug Nuvio build, which can
load a single provider by URL or the whole repo manifest.

## Port map — Python addon → these plugins

| Python (`providers_native.py`) | Plugin | Change needed |
|---|---|---|
| `chq` | `chq.js` | none; same endpoint, download-only mirrors filtered, no `/proxy` hop so the player gets the CDN URL directly |
| `primesrc` | `primesrc.js` | API now returns `{info, servers}`, not a bare array — fixed |
| `vidsrc` | `vidsrc.js` | page no longer uses `prorcp`; chain is now `data-api` → `/vs_src.php` → `window.CFG.playerUrl` → `window.CONFIG.api` |
| `twoembed` | `twoembed.js` | `data-encrypted` + POST `action=decrypt` is gone; the page sets `srcUrl` and the player ships a plain `sources` JSON block — fixed |
| `multiembed` | `multiembed.js` | response body is now the playback URL itself, unquoted — fixed |
| `hdhub_stremio` | `hdhub.js` | upstream mirror `hdhub.thevolecitor.qzz.io` refuses connections; kept, disabled. Rotate from `raw.githubusercontent.com/phisher98/TVVVV/…/domains.json` |
| `pyembed/*` (15 resolvers) | **not ported** | each needs an AES-capable JS rewrite; `crypto` is unavailable in Hermes, so key schedules are pure JS |

## Verified

`node test.js 550 movie` → **43 streams**

```
chq        24   (mirrors + 4K remux entries; download-only hosts filtered)
primesrc   12   (Filemoon / hubcloud keys)
twoembed    6   (upcloud.2embed.stream HLS, per-server labels)
multiembed  1   (streamingnow.mov, token resolved server-side)
vidsrc      0   (final stream_urls call is bot-gated: 403 on this network)
hdhub       0   (upstream mirror offline; disabled in manifest)
```

## Constraints worth knowing before editing

- **Hermes, not Node.** No `async/await` in loaded code, no `crypto`, no `Buffer`.
  Promise chains only. If you add a provider built with modern syntax, transpile it
  (`node build.js --transpile provider.js` from the upstream template repo).
- **`fetch` exists, `AbortController` may not.** Every provider guards it and adds a
  `Promise.race` timeout, so a dead host costs seconds, not the whole request.
- **No proxy layer.** The Python addon routed streams through its own `/proxy` to
  attach Referers. Plugins hand the app a URL plus `headers`, so hosts that gate on
  a server-side hop (PrimeSrc link decode, VidSrc `stream_urls`) stay unresolved.
- **Streams only.** Nuvio plugins cannot provide catalogs, so the ~16k-channel live
  TV catalog from the addon has no equivalent here. Keep the addon for that.
- **CORS is not a factor.** Requests are native, not browser XHR.

## Trust note

A plugin is code executed on the device — a different trust boundary from an addon,
which only returns data. This set is small enough to read end to end: every file is
one `getStreams` function plus a regex or a JSON parse.
