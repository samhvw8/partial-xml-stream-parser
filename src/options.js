// Default options relevant to the lenient streaming parser
const DEFAULT_STREAM_OPTIONS = {
  textNodeName: "#text", // Key for text content when a tag has other children or for consistency
  attributeNamePrefix: "@", // Prefix for attribute names in the parsed object
  stopNodes: [], // Array of tag names that should not have their children parsed
  alwaysCreateTextNode: true, // If true, text content is always in a #text node. Changed default for performance.
  parsePrimitives: false, // If true, attempts to parse numbers and booleans
};

module.exports = {
  DEFAULT_STREAM_OPTIONS,
};