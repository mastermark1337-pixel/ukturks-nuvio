/**
 * Repository lint. Verifies the manifest parses, every provider file exists,
 * and no provider uses syntax the Hermes plugin loader rejects.
 *
 *   node lint.js
 */

"use strict";

var fs = require("fs");
var path = require("path");

var root = __dirname;
var manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

var banned = [
  { re: /\basync\b/, why: "async keyword — Hermes rejects it in loaded code" },
  { re: /\bawait\b/, why: "await keyword — transpile or rewrite as promise chains" },
  { re: /^\s*import\s/m, why: "ES import — loader cannot resolve local files" },
  { re: /require\(\s*["']\.[^"']*["']\s*\)/, why: "local require — must be self-contained" },
  { re: /\brequire\(\s*["'](crypto|buffer|fs|path)["']\s*\)/, why: "Node builtin — unavailable on device" }
];

var problems = 0;

manifest.forEach(function (p) {
  var file = path.join(root, p.filename);
  if (!fs.existsSync(file)) {
    console.log("MISSING  " + p.filename);
    problems++;
    return;
  }
  var src = fs.readFileSync(file, "utf8");
  var hits = banned.filter(function (b) { return b.re.test(src); });

  if (!/module\.exports\s*=\s*\{[^}]*getStreams/.test(src)) {
    hits.push({ why: "no module.exports = { getStreams }" });
  }

  var status = hits.length ? "FAIL" : "ok  ";
  console.log(
    status + "  " + p.id.padEnd(16) +
    (p.enabled ? "enabled " : "disabled") +
    "  " + p.filename
  );
  hits.forEach(function (h) {
    console.log("        - " + h.why);
    problems++;
  });
});

console.log("\n" + manifest.length + " providers, " + problems + " problem(s)");
process.exit(problems ? 1 : 0);
