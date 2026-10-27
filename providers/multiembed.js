/**
 * multiembed — getsuperembed.link -> streamingnow.mov
 * Port of providers_native.py::multiembed, corrected for the current response.
 *
 * getsuperembed.link now answers with the playback URL as a plain text body
 * (no HTML wrapper, no quotes), so the old streamingnow regex matched nothing.
 * The site resolves the hunter-pack token server-side; nothing to decode here.
 */

"use strict";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

var EMBED = "https://getsuperembed.link/";
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

function getStreams(tmdbId, mediaType, season, episode) {
  var link = EMBED + "?video_id=" + tmdbId + "&tmdb=1";
  if (mediaType === "tv") {
    link += "&s=" + season + "&e=" + episode;
  }

  var hdr = { Referer: "https://multiembed.mov/" };
  var playHdr = { Referer: "https://streamingnow.mov/", "User-Agent": UA };

  return request(link, hdr).then(function (r) {
    if (!r.ok) return [];
    var body = String(r.text || "").trim();
    var urls = [];

    // Current shape: the body is the URL itself.
    if (body.indexOf("http") === 0 && body.indexOf("\n") === -1 && body.length < 2048) {
      urls.push(body);
    }

    // Older shape: URLs quoted inside HTML/JSON.
    if (!urls.length) {
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
        headers: playHdr
      });
    }
    return out;
  }).catch(function (e) {
    console.error("[MultiEmbed] " + (e && e.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };
