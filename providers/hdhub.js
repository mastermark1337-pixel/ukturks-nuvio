/**
 * hdhub — HdHub Stremio-protocol upstream (hdhub.thevolecitor.qzz.io)
 * Port of providers_native.py::hdhub_stremio.
 *
 * Upstream already answers in Stremio stream JSON, so this is a pass-through
 * that re-labels and keeps the per-host proxyHeaders. It keys on IMDb ids;
 * Nuvio hands us TMDB ids, so one external_ids lookup is done first.
 *
 * TorBox config block in the path is the app's own default:
 * {"torbox":"unset","qualities":"2160p,1080p,720p","sort":"desc"}
 */

"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

var BASE = "https://hdhub.thevolecitor.qzz.io/" +
  "eyJ0b3Jib3giOiJ1bnNldCIsInF1YWxpdGllcyI6IjIxNjBwLDEwODBwLDcyMHAiLCJzb3J0IjoiZGVzYyJ9";
var TMDB_KEY = "f090bb54758cabf231fb605d3e3e0468";
var TIMEOUT = 14000;

function request(url, ms) {
  var timer = null;
  var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () {
      if (ctrl) { try { ctrl.abort(); } catch (e) { /* settled */ } }
      resolve({ ok: false, status: 0, text: "" });
    }, ms || TIMEOUT);
  });
  var init = {
    method: "GET",
    headers: { "User-Agent": UA, Accept: "*/*" }
  };
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
  if (t.indexOf("2160") !== -1 || t.indexOf("4k") !== -1 || t.indexOf("uhd") !== -1) return "4K";
  if (t.indexOf("1080") !== -1) return "1080p";
  if (t.indexOf("720") !== -1) return "720p";
  if (t.indexOf("480") !== -1) return "480p";
  return "Auto";
}

function imdbFrom(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId +
    "/external_ids?api_key=" + TMDB_KEY;
  return request(url, 8000).then(function (r) {
    if (!r.ok) return null;
    try {
      return (JSON.parse(r.text) || {}).imdb_id || null;
    } catch (e) {
      return null;
    }
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  return imdbFrom(tmdbId, mediaType).then(function (imdb) {
    if (!imdb) return [];

    var path;
    if (mediaType === "tv") {
      path = "series/" + imdb + ":" + season + ":" + episode + ".json";
    } else {
      path = "movie/" + imdb + ".json";
    }

    return request(BASE + "/stream/" + path).then(function (r) {
      if (!r.ok) return [];
      var data;
      try {
        data = JSON.parse(r.text);
      } catch (e) {
        return [];
      }
      var list = (data && data.streams) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i] || {};
        if (!s.url) continue;
        var hints = s.behaviorHints || {};
        var proxy = (hints.proxyHeaders || {}).request || null;
        out.push({
          name: s.name || "HdHub",
          title: s.title || s.name || "HdHub",
          url: s.url,
          quality: qualityFrom(String(s.name || "") + " " + String(s.title || "")),
          headers: proxy || { "User-Agent": UA }
        });
      }
      return out;
    });
  }).catch(function (e) {
    console.error("[HdHub] " + (e && e.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };
