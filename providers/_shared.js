/**
 * Shared helpers for the UKTurks Nuvio provider set.
 *
 * Constraint: this file is never imported at runtime. Every provider is a
 * single self-contained bundle because the Nuvio loader cannot resolve local
 * imports. Copy the helpers you need into the provider file, or keep this file
 * as the canonical source and inline it (see build.js).
 *
 * Runtime: React Native + Hermes.
 *   - no async/await (transpiled or hand-written promise chains only)
 *   - no Node builtins (crypto, buffer)
 *   - global fetch, setTimeout/clearTimeout, console
 */

"use strict";

exports.UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

exports.UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

/** GET/POST with a hard timeout. Resolves { ok, status, text } — never rejects. */
exports.request = function (url, opts, timeoutMs) {
  var options = opts || {};
  var ms = timeoutMs || 14000;
  var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer = null;

  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () {
      if (ctrl) {
        try { ctrl.abort(); } catch (e) { /* already settled */ }
      }
      resolve({ ok: false, status: 0, text: "", timeout: true });
    }, ms);
  });

  var headers = { "User-Agent": exports.UA, Accept: "*/*" };
  if (options.headers) {
    for (var k in options.headers) {
      if (Object.prototype.hasOwnProperty.call(options.headers, k)) {
        headers[k] = options.headers[k];
      }
    }
  }

  var init = {
    method: options.method || "GET",
    headers: headers,
    redirect: "follow"
  };
  if (options.body != null) init.body = options.body;
  if (ctrl) init.signal = ctrl.signal;

  var run = fetch(url, init).then(function (res) {
    return res.text().then(function (text) {
      return { ok: res.ok, status: res.status, text: text };
    });
  }).catch(function () {
    return { ok: false, status: 0, text: "" };
  });

  return Promise.race([run, timeout]).then(function (result) {
    if (timer) clearTimeout(timer);
    return result;
  });
};

exports.formBody = function (obj) {
  var parts = [];
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
    }
  }
  return parts.join("&");
};

exports.qualityFrom = function (text) {
  var t = String(text || "").toLowerCase();
  if (t.indexOf("2160") !== -1 || t.indexOf("4k") !== -1 || t.indexOf("uhd") !== -1) return "4K";
  if (t.indexOf("1080") !== -1 || t.indexOf("fhd") !== -1) return "1080p";
  if (t.indexOf("720") !== -1) return "720p";
  if (t.indexOf("480") !== -1 || t.indexOf("sd") !== -1) return "480p";
  if (t.indexOf("360") !== -1) return "360p";
  return "Auto";
};

exports.typeFrom = function (url) {
  var u = String(url || "").toLowerCase();
  if (u.indexOf(".m3u8") !== -1) return "hls";
  if (u.indexOf(".mp4") !== -1) return "mp4";
  return "hls";
};

/** TMDB external ids -> imdb id. Only needed by upstreams that speak IMDb. */
exports.imdbFromTmdb = function (tmdbId, mediaType, apiKey) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId +
    "/external_ids?api_key=" + apiKey;
  return exports.request(url, {}, 8000).then(function (r) {
    if (!r.ok) return null;
    try {
      var j = JSON.parse(r.text);
      return j.imdb_id || null;
    } catch (e) {
      return null;
    }
  });
};
