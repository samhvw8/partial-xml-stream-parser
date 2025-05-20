// CJS wrapper for the ESM module
// This will make require('partial-xml-stream-parser') return a Promise.
module.exports = (async () => {
  const { default: PartialXMLStreamParser } = await import('./index.mjs');
  return PartialXMLStreamParser;
})();