// Runs the browser copy of the backlink filter from the Python tests, so both copies can be compared.
const fs = require("fs");
const path = require("path");
const cleaner = require(path.join(__dirname, "..", "..", "design", "mockups", "cleaner.js"));

const [command, file, knownJson] = process.argv.slice(2);

if (command === "suffixes") {
  process.stdout.write(JSON.stringify(cleaner.MULTI_SUFFIXES));
} else if (command === "domains") {
  const values = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(JSON.stringify(values.map(cleaner.rootDomain)));
} else {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const known = new Map(Object.entries(JSON.parse(knownJson || "{}")));
  try {
    process.stdout.write(JSON.stringify(cleaner.cleanCsv(bytes, known)));
  } catch (err) {
    if (!err.code) throw err;
    process.stdout.write(JSON.stringify({ error: { code: err.code, missing: err.missing, headers: err.headers, message: err.message } }));
  }
}
