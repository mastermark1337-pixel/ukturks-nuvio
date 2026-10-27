/**
 * Node smoke test. Not shipped to the device — Node has fetch (18+) and this
 * only verifies the scrape logic. Hermes behaves differently; the Plugin
 * Tester in a debug Nuvio build is the real gate.
 *
 *   node test.js 550 movie
 *   node test.js 1399 tv 1 1
 */

"use strict";

var path = require("path");

var tmdbId = process.argv[2] || "550";
var mediaType = process.argv[3] || "movie";
var season = process.argv[4] ? Number(process.argv[4]) : null;
var episode = process.argv[5] ? Number(process.argv[5]) : null;

var providers = [
  "chq",
  "vidsrc",
  "twoembed",
  "multiembed",
  "primesrc",
  "hdhub"
];

function run() {
  var results = [];
  var queue = providers.slice();

  function next() {
    if (!queue.length) {
      var total = 0;
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        total += r.streams.length;
        console.log("\n== " + r.id + " (" + r.ms + "ms) — " + r.streams.length + " streams");
        for (var j = 0; j < r.streams.length; j++) {
          var s = r.streams[j];
          console.log("   [" + s.quality + "] " + s.name + " — " + s.title);
          console.log("      " + s.url);
          if (s.headers) console.log("      hdr: " + JSON.stringify(s.headers));
        }
        if (r.error) console.log("   error: " + r.error);
      }
      console.log("\ntotal streams: " + total);
      return;
    }

    var id = queue.shift();
    var mod = require(path.join(__dirname, "providers", id + ".js"));
    var t0 = Date.now();
    mod.getStreams(tmdbId, mediaType, season, episode).then(function (streams) {
      results.push({ id: id, streams: streams || [], ms: Date.now() - t0 });
      next();
    }).catch(function (e) {
      results.push({ id: id, streams: [], ms: Date.now() - t0, error: e.message });
      next();
    });
  }

  next();
}

run();
