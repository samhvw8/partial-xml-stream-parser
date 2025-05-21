const STATIC_OPENING_TAG_REGEX =
  /<\s*([\w:-]+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*\s*)?(\/?)\>/;
const STATIC_CLOSING_TAG_REGEX = /<\/\s*([\w:-]+)\s*>/;

const COMMON_ENTITIES = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

module.exports = {
  STATIC_OPENING_TAG_REGEX,
  STATIC_CLOSING_TAG_REGEX,
  COMMON_ENTITIES,
};