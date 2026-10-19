// Minimal CLI arg parser for the analysis scripts. Flags with values: `--name value`. Bare flags:
// `--name` -> true. Everything else is a positional, returned on `_`.
//
//   parseArgs(argv, ["labels", "min-n"]) -> { _: [...positionals], labels, "min-n", ...bareFlags:true }
function parseArgs(argv, valueFlags = []) {
  const withValue = new Set(valueFlags);
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (withValue.has(name)) {
        out[name] = argv[i + 1];
        i += 1;
      } else {
        out[name] = true;
      }
    } else if (a.startsWith("-") && a.length === 2) {
      out[a.slice(1)] = argv[i + 1];
      i += 1;
    } else {
      out._.push(a);
    }
  }
  return out;
}

module.exports = { parseArgs };
