// Host half — browser-only plugin.
// This entry exists so the Loader can mount a row for the package; the real
// behaviour lives in the client half (lib/client.js), composed into the web
// application through the `dsh.client` declaration in package.json.
export function apply() {}
