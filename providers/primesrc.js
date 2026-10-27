/**
 * primesrc — primesrc.me
 * Port of providers_native.py::primesrc.
 *
 * GET /api/v1/s?tmdb=..&type=movie  ->  [ { name, key, file_name } ]
 * Embed page: https://primesrc.me/embed/{key}
 * The link decode behind /api/v1/l is Cloudflare-gated, so the embed page is
 * handed to the player with the Referer the site requires. Same behaviour as
 * the Python addon.
 */

"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

var API = "https://primesrc.me/api/v1";
var TIMEOUT = 14000;
var MAX_SERVERS = 12;

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

function getStreams(tmdbId, mediaType, season, episode) {
  var q;
  if (mediaType === "tv" && season != null && episode != null) {
    q = "?tmdb=" + tmdbId + "&season=" + season + "&episode=" + episode + "&type=tv";
  } else {
    q = "?tmdb=" + tmdbId + "&type=movie";
  }

  var hdr = { Referer: "https://primesrc.me/" };

  return request(API + "/s" + q, hdr).then(function (r) {
    if (!r.ok) return [];
    var data;
    try {
      data = JSON.parse(r.text);
    } catch (e) {
      return [];
    }
    // Current shape: { info: {...}, servers: [...] }. Older shape: a bare array.
    var servers = data && data.servers ? data.servers : data;
    if (!servers || typeof servers.length !== "number") return [];
    var out = [];
    for (var i = 0; i < servers.length && out.length < MAX_SERVERS; i++) {
      var s = servers[i] || {};
      if (!s.key) continue;
      out.push({
        name: "PrimeSrc",
        title: (s.name || "PrimeSrc") + (s.file_name ? " " + s.file_name : ""),
        url: "https://primesrc.me/embed/" + s.key,
        quality: qualityFrom(s.file_name || ""),
        headers: hdr
      });
    }
    return out;
  }).catch(function (e) {
    console.error("[PrimeSrc] " + (e && e.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };
