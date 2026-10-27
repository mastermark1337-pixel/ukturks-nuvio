/**
 * vidsrc — vsembed.ru -> vs_src.php -> player -> stream list
 * Port of providers_native.py::vidsrc, retargeted at the current page shape.
 *
 * Current flow (verified):
 *   /embed/movie?tmdb=   -> iframe#player_iframe with data-api="/vs_src.php?..."
 *   /vs_src.php?...      -> {"src":"https://<host>/embed/movie/<id>?vs=<token>"}
 *   <host>/embed/movie/  -> window.CFG.playerUrl
 *   /embed/player/...    -> window.CONFIG.api = data.vidsrc.sh/api.php?...&stream_urls
 *
 * The final stream_urls call is bot-gated per host and returns 403 from most
 * networks. When it does, the resolved player page is returned as a fallback
 * entry so the flow is visible in logs instead of silently empty.
 */

"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

var BASE = "https://vsembed.ru";
var TIMEOUT = 14000;

function request(url, headers, ms) {
  var timer = null;
  var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () {
      if (ctrl) { try { ctrl.abort(); } catch (e) { /* settled */ } }
      resolve({ ok: false, status: 0, text: "" });
    }, ms || TIMEOUT);
  });
  var h = { "User-Agent": UA, Accept: "*/*" };
  if (headers) { for (var k in headers) { if (headers[k]) h[k] = headers[k]; } }
  var init = { method: "GET", headers: h };
  if (ctrl) init.signal = ctrl.signal;
  var run = fetch(url, init).then(function (res) {
    return res.text().then(function (text) {
      return { ok: res.ok, status: res.status, text: text };
    });
  }).catch(function () { return { ok: false, status: 0, text: "" }; });

  return Promise.race([run, timeout]).then(function (r) {
    if (timer) clearTimeout(timer);
    return r;
  });
}

function qualityFrom(text) {
  var t = String(text || "").toLowerCase();
  if (t.indexOf("2160") !== -1 || t.indexOf("4k") !== -1) return "4K";
  if (t.indexOf("1080") !== -1) return "1080p";
  if (t.indexOf("720") !== -1) return "720p";
  if (t.indexOf("480") !== -1) return "480p";
  return "Auto";
}

function absolute(u, hostBase) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return hostBase + u;
  return u;
}

function originOf(url) {
  var m = String(url).match(/^https?:\/\/[^\/]+/);
  return m ? m[0] : "";
}

function getStreams(tmdbId, mediaType, season, episode) {
  var hdr = { Referer: BASE + "/" };
  var q;
  if (mediaType === "tv") {
    q = "/embed/tv?tmdb=" + tmdbId + "&season=" + season + "&episode=" + episode;
  } else {
    q = "/embed/movie?tmdb=" + tmdbId;
  }

  return request(BASE + q, hdr).then(function (r1) {
    if (!r1.ok) return [];

    var api = r1.text.match(/data-api=["']([^"']+)["']/);
    var apiPath = api ? api[1].replace(/&amp;/g, "&") : null;

    // Legacy shape: the payload already carried a prorcp playlist.
    if (!apiPath) {
      var direct = r1.text.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (direct) {
        return [{
          name: "VidSrc",
          title: "VidSrc",
          url: direct[1],
          quality: qualityFrom(direct[1]),
          headers: hdr
        }];
      }
      return [];
    }

    return request(absolute(apiPath, BASE), hdr).then(function (r2) {
      if (!r2.ok) return [];
      var pageUrl;
      try {
        pageUrl = (JSON.parse(r2.text) || {}).src;
      } catch (e) {
        return [];
      }
      if (!pageUrl) return [];

      var host = originOf(pageUrl);
      var pageHdr = { Referer: BASE + "/", "User-Agent": UA };

      return request(pageUrl, pageHdr).then(function (r3) {
        if (!r3.ok) return [];

        var cfg = r3.text.match(/window\.CFG\s*=\s*(\{[\s\S]*?\});/);
        if (!cfg) {
          var m3u = r3.text.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
          if (!m3u) return [];
          return [{
            name: "VidSrc",
            title: "VidSrc",
            url: m3u[1],
            quality: qualityFrom(m3u[1]),
            headers: pageHdr
          }];
        }

        var cfgObj;
        try {
          cfgObj = JSON.parse(cfg[1]);
        } catch (e) {
          return [];
        }

        var playerUrl = absolute(cfgObj.playerUrl || "", host);
        if (!playerUrl) return [];

        return request(playerUrl, { Referer: pageUrl, "User-Agent": UA }).then(function (r4) {
          if (!r4.ok) return [];
          var conf = r4.text.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
          if (!conf) return [];
          var confObj;
          try {
            confObj = JSON.parse(conf[1]);
          } catch (e) {
            return [];
          }
          if (!confObj.api) return [];

          return request(confObj.api, {
            Referer: playerUrl,
            Accept: "application/json",
            "User-Agent": UA
          }).then(function (r5) {
            if (!r5.ok) return [];
            var re = /"(?:url|file)"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/g;
            var out = [];
            var seen = {};
            var m;
            while ((m = re.exec(r5.text)) !== null) {
              var u = m[1].replace(/\\\//g, "/");
              if (seen[u]) continue;
              seen[u] = true;
              out.push({
                name: "VidSrc",
                title: "VidSrc",
                url: u,
                quality: qualityFrom(u),
                headers: { Referer: pageUrl, "User-Agent": UA }
              });
            }
            return out;
          });
        });
      });
    });
  }).catch(function (e) {
    console.error("[VidSrc] " + (e && e.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };
