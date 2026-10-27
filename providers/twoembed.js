/**
 * 2embed — www.2embed.online
 * Port of providers_native.py::twoembed, retargeted at the current page shape.
 *
 * Current flow (verified):
 *   /embed/movie/{tmdb}        -> inline script sets srcUrl
 *   https://2embed.stream/...  -> JSON blob with "sources": {Server1:{url:...m3u8}}
 * The old data-encrypted + POST / action=decrypt path is gone; the server list
 * now arrives as a plain JSON payload in the player page.
 */

"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

var BASE = "https://www.2embed.online";
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
  if (t.indexOf("1080") !== -1 || t.indexOf("fhd") !== -1) return "1080p";
  if (t.indexOf("720") !== -1 || t.indexOf(" hd") !== -1) return "720p";
  if (t.indexOf("480") !== -1) return "480p";
  return "Auto";
}

function getStreams(tmdbId, mediaType, season, episode) {
  var hdr = { Referer: BASE + "/" };
  var embed;
  if (mediaType === "tv") {
    embed = BASE + "/embed/tv/" + tmdbId + "/" + season + "/" + episode;
  } else {
    embed = BASE + "/embed/movie/" + tmdbId;
  }

  return request(embed, hdr).then(function (r1) {
    if (!r1.ok) return [];

    var m = r1.text.match(/srcUrl\s*=\s*["']([^"']+)["']/);
    if (!m) return [];
    var player = m[1].replace(/\\\//g, "/");

    return request(player, { Referer: BASE + "/" }).then(function (r2) {
      if (!r2.ok) return [];

      // "Server1":{"url":"https://.../x.m3u8","file":"...","type":"hls","label":"Quercus HD"}
      var re = /"url":"(https?:\/\/[^"]+?)","file":"[^"]*","type":"([^"]*)","label":"([^"]*)"/g;
      var out = [];
      var mm;
      while ((mm = re.exec(r2.text)) !== null) {
        out.push({
          name: "2Embed",
          title: mm[3] || "2Embed",
          url: mm[1].replace(/\\\//g, "/"),
          quality: qualityFrom(mm[3]),
          headers: { Referer: BASE + "/", "User-Agent": UA }
        });
      }
      return out;
    });
  }).catch(function (e) {
    console.error("[2Embed] " + (e && e.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };
