// src/utils.js

// Precompiled regex patterns for better performance
const XML_ENTITY_REGEX = /&(lt|gt|amp|quot|apos|#(\d+)|#x([\da-fA-F]+));/g;

/**
 * Decodes XML entities in a text string
 * @param {string} text - The text containing XML entities
 * @param {Object<string, string>} commonEntities - Map of entity names to their values
 * @returns {string} The decoded text
 */
export function decodeXmlEntities(text, commonEntities) {
  if (typeof text !== "string") return text;
  
  return text.replace(
    XML_ENTITY_REGEX,
    (match, name, dec, hex) => {
      if (commonEntities[name]) return commonEntities[name];
      if (dec) return String.fromCharCode(parseInt(dec, 10));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      return match;
    }
  );
}

// Lookup table for boolean values
const BOOLEAN_VALUES = {
  'true': true,
  'false': false,
  'True': true,
  'False': false,
  'TRUE': true,
  'FALSE': false
};

/**
 * Optimized primitive type parser with lookup tables
 * @param {string} value - The value to parse
 * @returns {boolean|number|string} The parsed primitive value or original string
 */
export function tryParsePrimitive(value) {
  if (typeof value !== "string") return value;

  // Fast boolean lookup
  if (value.length <= 5) {
    const boolResult = BOOLEAN_VALUES[value];
    if (boolResult !== undefined) return boolResult;
  }

  // Fast number check - avoid trim() if possible
  if (value.charAt(0) === '-' || (value.charAt(0) >= '0' && value.charAt(0) <= '9')) {
    const num = Number(value);
    if (!isNaN(num) && String(num) === value) {
      return num;
    }
  }

  return value;
}

/**
 * Parses XML attributes string into an object with optimized value extraction
 * @param {string} attributesString - The raw attributes string
 * @param {string} attributeNamePrefix - Prefix to add to attribute names
 * @param {Object} customOptions - Parser options
 * @param {RegExp} attrRegexInstance - Regex for matching attributes
 * @param {Function} decodeXmlEntitiesFn - Function to decode XML entities
 * @param {Function} tryParsePrimitiveFn - Function to parse primitive values
 * @param {Object} commonEntitiesForDecode - Common XML entities map
 * @returns {Object} Parsed attributes object
 */
export function parseAttributes(
  attributesString,
  attributeNamePrefix,
  customOptions,
  attrRegexInstance,
  decodeXmlEntitiesFn,
  tryParsePrimitiveFn,
  commonEntitiesForDecode
) {
  if (!attributesString) return {};
  
  const attrs = {};
  attrRegexInstance.lastIndex = 0;
  let match;

  while ((match = attrRegexInstance.exec(attributesString)) !== null) {
    const attrName = match[1];
    const prefixedName = attributeNamePrefix + attrName;
    
    // Find first defined value group
    const valueGroup = match[2] || match[3] || match[4];
    const attrValue = valueGroup !== undefined
      ? decodeXmlEntitiesFn(valueGroup, commonEntitiesForDecode)
      : true;

    // Set attribute value with optional primitive parsing
    attrs[prefixedName] = customOptions.parsePrimitives && typeof attrValue === "string"
      ? tryParsePrimitiveFn(attrValue)
      : attrValue;
  }

  return attrs;
}