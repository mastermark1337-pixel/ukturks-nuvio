/**
 * dmmplus — Debrid Media Manager (TorBox) + UKTurks scrapers, merged on device.
 *
 * Port of dmm-plus/addon.py. No server, no PC: every request is made from the
 * Nuvio app in Hermes. Same merge rules — dedupe, quality sort, smaller-first.
 *
 * DMM caps its own addon at 5 file entries + 1 "cast" entry and ignores every
 * pagination parameter, so the only way past five is to merge, which is what
 * this does.
 *
 * Runtime: Hermes. Promise chains only, no async/await, no Node builtins.
 */

"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

// The segment after /api/stremio-tb/ in your DMM addon URL.
var DMM_TOKEN = "_oKCkbeH_FFa";
var DMM_BASE = "https://debridmediamanager.com/api/stremio-tb/" + DMM_TOKEN;

var TMDB_KEY = "f090bb54758cabf231fb605d3e3e0468";
var TIMEOUT = 14000;
var MAX_STREAMS = 60;

var CHQ_API = "https://chq-api.ddns.me/api/streams/";
var PRIMESRC_API = "https://primesrc.me/api/v1";
var VSEMBED = "https://vsembed.ru";
var TWOEMBED = "https://www.2embed.online";

// CHQ returns raw file hosts that stall every player. Dropped before the list.
var DOWNLOAD_ONLY = [
  "10gbps", "pixeldrain", "hubcloud.ist", "gofile",
  "1fichier", "buzzheavier", "pixel.hubcloud"
];

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------

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
  if (headers) {
    for (var k in headers) {
      if (headers[k]) h[k] = headers[k];
    }
  }

  var init = { method: "GET", headers: h, redirect: "follow" };
  if (ctrl) init.signal = ctrl.signal;

  var run = fetch(url, init).then(function (res) {
    return res.text().then(function (text) {
      return { ok: res.ok, status: res.status, text: text };
    });
  }).catch(function () {
    return { ok: false, status: 0, text: "" };
  });

  return Promise.race([run, timeout]).then(function (r) {
    if (timer) clearTimeout(timer);
    return r;
  });
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

var QUALITY_ORDER = ["4K", "1080p", "720p", "480p", "360p", "Auto"];

function qualityFrom(text) {
  var t = String(text || "").toLowerCase();
  if (t.indexOf("2160") !== -1 || t.indexOf("4k") !== -1 || t.indexOf("uhd") !== -1) return "4K";
  if (t.indexOf("1080") !== -1 || t.indexOf("fhd") !== -1) return "1080p";
  if (t.indexOf("720") !== -1) return "720p";
  if (t.indexOf("480") !== -1) return "480p";
  if (t.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function sizeGb(title) {
  var m = String(title || "").match(/(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
  if (!m) return 0;
  var value = parseFloat(m[1]);
  return m[2].toUpperCase() === "GB" ? value : value / 1024;
}

function origin(url) {
  var m = String(url || "").match(/^https?:\/\/[^\/]+/);
  return m ? m[0] : "";
}

function absolute(url, base) {
  if (!url) return "";
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.charAt(0) === "/" && base) return String(base).replace(/\/+$/, "") + url;
  return url;
}

// ---------------------------------------------------------------------------
// DMM — passthrough, entries kept verbatim
// ---------------------------------------------------------------------------

function dmm(imdbId, mediaType, season, episode) {
  var path = mediaType === "tv"
    ? "/stream/series/" + imdbId + ":" + season + ":" + episode + ".json"
    : "/stream/movie/" + imdbId + ".json";

  return request(DMM_BASE + path).then(function (r) {
    if (!r.ok) return [];
    var data = json(r.text);
    if (!data || !data.streams) return [];

    var out = [];
    for (var i = 0; i < data.streams.length; i++) {
      var s = data.streams[i] || {};
      var entry = {
        name: s.name || "DMM",
        title: s.title || "",
        source: "DMM"
      };
      if (s.url) entry.url = s.url;
      if (s.externalUrl) entry.externalUrl = s.externalUrl;
      if (s.behaviorHints) entry.behaviorHints = s.behaviorHints;
      if (s.infoHash) entry.infoHash = s.infoHash;
      out.push(entry);
    }
    return out;
  }).catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// CHQ
// ---------------------------------------------------------------------------

function chq(tmdb, mediaType, season, episode) {
  var path = String(tmdb);
  if (mediaType === "tv" && season != null && episode != null) {
    path += "/" + season + "/" + episode;
  }

  return request(CHQ_API + path).then(function (r) {
    if (!r.ok) return [];
    var data = json(r.text);
    if (!data || !data.streams) return [];

    var out = [];
    for (var i = 0; i < data.streams.length; i++) {
      var s = data.streams[i] || {};
      var url = s.url || "";
      if (url.indexOf("http") !== 0) continue;

      var dl = false;
      for (var d = 0; d < DOWNLOAD_ONLY.length; d++) {
        if (url.toLowerCase().indexOf(DOWNLOAD_ONLY[d]) !== -1) { dl = true; break; }
      }
      if (dl) continue;

      var title = String(s.title || "").replace(/\n/g, " ").trim();
      out.push({
        name: "CHQ - " + qualityFrom(title),
        title: title || s.provider || "CHQ",
        url: url,
        quality: qualityFrom(title),
        source: "CHQ",
        headers: { "User-Agent": UA }
      });
    }
    return out;
  }).catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// PrimeSrc — API returns {info, servers}
// ---------------------------------------------------------------------------

function primesrc(tmdb, mediaType, season, episode) {
  var q;
  if (mediaType === "tv" && season != null && episode != null) {
    q = "?tmdb=" + tmdb + "&season=" + season + "&episode=" + episode + "&type=tv";
  } else {
    q = "?tmdb=" + tmdb + "&type=movie";
  }

  var hdr = { Referer: "https://primesrc.me/" };

  return request(PRIMESRC_API + "/s" + q, hdr).then(function (r) {
    if (!r.ok) return [];
    var data = json(r.text);
    if (!data) return [];

    var servers = data.servers && data.servers.length != null ? data.servers : data;
    if (!servers || servers.length == null) return [];

    var out = [];
    for (var i = 0; i < servers.length && out.length < 20; i++) {
      var s = servers[i] || {};
      if (!s.key) continue;
      out.push({
        name: "PrimeSrc - " + (s.name || "hoster"),
        title: s.file_name || "PrimeSrc",
        url: "https://primesrc.me/embed/" + s.key,
        quality: qualityFrom(s.file_name),
        source: "PrimeSrc",
        headers: hdr
      });
    }
    return out;
  }).catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// 2Embed — page sets srcUrl, player ships a plain sources JSON block
// ---------------------------------------------------------------------------

function twoembed(tmdb, mediaType, season, episode) {
  var embed = mediaType === "tv"
    ? TWOEMBED + "/embed/tv/" + tmdb + "/" + season + "/" + episode
    : TWOEMBED + "/embed/movie/" + tmdb;

  return request(embed, { Referer: TWOEMBED + "/" }).then(function (r1) {
    if (!r1.ok) return [];
    var m = r1.text.match(/srcUrl\s*=\s*["']([^"']+)["']/);
    if (!m) return [];
    var player = m[1].replace(/\\\//g, "/");

    return request(player, { Referer: TWOEMBED + "/" }).then(function (r2) {
      if (!r2.ok) return [];
      var re = /"url":"(https?:\/\/[^"]+?)","file":"[^"]*","type":"([^"]*)","label":"([^"]*)"/g;
      var out = [];
      var mm;
      while ((mm = re.exec(r2.text)) !== null) {
        out.push({
          name: "2Embed - " + (mm[3] || "hoster"),
          title: mm[3] || "2Embed",
          url: mm[1].replace(/\\\//g, "/"),
          quality: qualityFrom(mm[3]),
          source: "2Embed",
          headers: { Referer: TWOEMBED + "/", "User-Agent": UA }
        });
      }
      return out;
    });
  }).catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// MultiEmbed — body is the playback URL itself
// ---------------------------------------------------------------------------

function multiembed(tmdb, mediaType, season, episode) {
  var link = "https://getsuperembed.link/?video_id=" + tmdb + "&tmdb=1";
  if (mediaType === "tv") link += "&s=" + season + "&e=" + episode;

  return request(link, { Referer: "https://multiembed.mov/" }).then(function (r) {
    if (!r.ok) return [];
    var body = String(r.text || "").trim();
    var urls = [];

    if (body.indexOf("http") === 0 && body.indexOf("\n") === -1 && body.length < 2048) {
      urls.push(body);
    } else {
      var re = /["'](https?:\/\/(?:streamingnow\.mov|getsuperembed\.link)[^"']+)["']/g;
      var m;
      while ((m = re.exec(body)) !== null) urls.push(m[1]);
    }

    var out = [];
    for (var i = 0; i < urls.length; i++) {
      out.push({
        name: "MultiEmbed",
        title: "MultiEmbed",
        url: urls[i].replace(/\\\//g, "/"),
        quality: "Auto",
        source: "MultiEmbed",
        headers: { Referer: "https://streamingnow.mov/", "User-Agent": UA }
      });
    }
    return out;
  }).catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// VidSrc — data-api -> vs_src.php -> CFG.playerUrl -> CONFIG.api
// Final call is bot-gated on many networks; returns [] there.
// ---------------------------------------------------------------------------

function vidsrc(tmdb, mediaType, season, episode) {
  var hdr = { Referer: VSEMBED + "/" };
  var start = mediaType === "tv"
    ? VSEMBED + "/embed/tv?tmdb=" + tmdb + "&season=" + season + "&episode=" + episode
    : VSEMBED + "/embed/movie?tmdb=" + tmdb;

  return request(start, hdr).then(function (r1) {
    if (!r1.ok) return [];

    var api = r1.text.match(/data-api=["']([^"']+)["']/);
    if (!api) {
      var direct = r1.text.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (!direct) return [];
      return [{
        name: "VidSrc", title: "VidSrc", url: direct[1],
        quality: qualityFrom(direct[1]), source: "VidSrc", headers: hdr
      }];
    }

    var apiPath = api[1].replace(/&amp;/g, "&");

    return request(absolute(apiPath, VSEMBED), hdr).then(function (r2) {
      if (!r2.ok) return [];
      var j = json(r2.text);
      if (!j || !j.src) return [];
      var pageUrl = j.src;
      var host = origin(pageUrl);

      return request(pageUrl, { Referer: VSEMBED + "/", "User-Agent": UA }).then(function (r3) {
        if (!r3.ok) return [];

        var cfg = r3.text.match(/window\.CFG\s*=\s*(\{[\s\S]*?\});/);
        if (!cfg) {
          var m3u = r3.text.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
          if (!m3u) return [];
          return [{
            name: "VidSrc", title: "VidSrc", url: m3u[1],
            quality: qualityFrom(m3u[1]), source: "VidSrc",
            headers: { Referer: pageUrl, "User-Agent": UA }
          }];
        }

        var cfgObj = json(cfg[1]);
        if (!cfgObj) return [];
        var player = absolute(cfgObj.playerUrl || "", host);
        if (!player) return [];

        return request(player, { Referer: pageUrl, "User-Agent": UA }).then(function (r4) {
          if (!r4.ok) return [];
          var conf = r4.text.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
          if (!conf) return [];
          var confObj = json(conf[1]);
          if (!confObj || !confObj.api) return [];

          return request(confObj.api, {
            Referer: player, Accept: "application/json", "User-Agent": UA
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
                name: "VidSrc", title: "VidSrc", url: u,
                quality: qualityFrom(u), source: "VidSrc",
                headers: { Referer: pageUrl, "User-Agent": UA }
              });
            }
            return out;
          });
        });
      });
    });
  }).catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// IMDb -> TMDB (hosters key on TMDB; DMM keys on IMDb)
// ---------------------------------------------------------------------------

function tmdbFromImdb(imdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv_results" : "movie_results";
  var url = "https://api.themoviedb.org/3/find/" + imdbId +
    "?external_source=imdb_id&api_key=" + TMDB_KEY;

  return request(url, null, 8000).then(function (r) {
    if (!r.ok) return null;
    var j = json(r.text);
    if (!j) return null;
    var results = j[kind] || [];
    return results.length ? results[0].id : null;
  }).catch(function () { return null; });
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

function rank(s) {
  var q = s.quality || qualityFrom(String(s.name || "") + String(s.title || ""));
  var idx = QUALITY_ORDER.indexOf(q);
  if (idx === -1) idx = QUALITY_ORDER.length - 1;
  // Quality first, playable before metadata-only, then smaller file first.
  return [idx, s.url ? 0 : 1, sizeGb(s.title)];
}

function compare(a, b) {
  var ra = rank(a);
  var rb = rank(b);
  for (var i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i];
  }
  return 0;
}

function getStreams(tmdbId, mediaType, season, episode) {
  // Nuvio passes a TMDB id; DMM needs IMDb, so both are resolved here.
  var imdbUrl = "https://api.themoviedb.org/3/" +
    (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
    "/external_ids?api_key=" + TMDB_KEY;

  return request(imdbUrl, null, 8000).then(function (r) {
    var imdbId = null;
    if (r.ok) {
      var j = json(r.text);
      if (j && j.imdb_id) imdbId = j.imdb_id;
    }

    var jobs = [chq(tmdbId, mediaType, season, episode),
                primesrc(tmdbId, mediaType, season, episode),
                twoembed(tmdbId, mediaType, season, episode),
                multiembed(tmdbId, mediaType, season, episode),
                vidsrc(tmdbId, mediaType, season, episode)];

    if (imdbId) {
      jobs.push(dmm(imdbId, mediaType, season, episode));
    }

    return Promise.all(jobs).then(function (groups) {
      var merged = [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g] || [];
        for (var i = 0; i < group.length; i++) merged.push(group[i]);
      }

      var seen = {};
      var deduped = [];
      for (var k = 0; k < merged.length; k++) {
        var s = merged[k];
        var ident = s.url || s.infoHash || s.externalUrl || "";
        if (!ident || seen[ident]) continue;
        seen[ident] = true;
        deduped.push(s);
      }

      deduped.sort(compare);
      return deduped.slice(0, MAX_STREAMS);
    });
  }).catch(function (e) {
    console.error("[DMMPlus] " + (e && e.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };
