/**
 * chq — CHQ API (chq-api.ddns.me)
 * Port of providers_native.py::chq. Direct JSON, no scraping, no auth.
 * Endpoint returns { streams: [ { url, provider, title } ] }.
 */

"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

var API = "https://chq-api.ddns.me/api/streams/";
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
  var init = { method: "GET", headers: { "User-Agent": UA, Accept: "*/*" } };
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
  if (t.indexOf("1080") !== -1 || t.indexOf("fhd") !== -1) return "1080p";
  if (t.indexOf("720") !== -1) return "720p";
  if (t.indexOf("480") !== -1 || t.indexOf("sd") !== -1) return "480p";
  if (t.indexOf("360") !== -1) return "360p";
  return "Auto";
}

// CHQ mirrors include download-only file hosts (10Gbps, PixelDrain, FSL).
// They stall the player, so they are filtered here rather than in the player.
var DOWNLOAD_ONLY = ["10gbps", "pixeldrain", "fsl.", "gofile", "1fichier", "buzzheavier"];

function isDownloadOnly(url) {
  var u = String(url || "").toLowerCase();
  for (var i = 0; i < DOWNLOAD_ONLY.length; i++) {
    if (u.indexOf(DOWNLOAD_ONLY[i]) !== -1) return true;
  }
  return false;
}

function getStreams(tmdbId, mediaType, season, episode) {
  var path = String(tmdbId);
  if (mediaType === "tv" && season != null && episode != null) {
    path += "/" + season + "/" + episode;
  }

  return request(API + path).then(function (r) {
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
      var url = s.url;
      if (!url || String(url).indexOf("http") !== 0) continue;
      if (isDownloadOnly(url)) continue;
      var title = String(s.title || "").replace(/\n/g, " ").trim();
      var prov = s.provider || "chq";
      var label = title || prov;
      out.push({
        name: "CHQ",
        title: label,
        url: url,
        quality: qualityFrom(title),
        headers: { "User-Agent": UA }
      });
    }
    return out;
  }).catch(function (e) {
    console.error("[CHQ] " + (e && e.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };
