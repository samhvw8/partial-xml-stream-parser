# Partial XML Stream Parser

[![npm version](https://badge.fury.io/js/partial-xml-stream-parser.svg)](https://badge.fury.io/js/partial-xml-stream-parser)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/USERNAME/REPOSITORY/actions) <!-- Replace USERNAME/REPOSITORY with actual GitHub repo -->
[![npm downloads](https://img.shields.io/npm/dm/partial-xml-stream-parser.svg)](https://www.npmjs.com/package/partial-xml-stream-parser)

A lenient, streaming XML parser for Node.js. This parser is designed to handle XML data that may be incomplete or not perfectly well-formed, making it suitable for processing streams of XML where the entire document might not be available at once.

## Features

- **Streaming Parser**: Processes XML data in chunks.
- **Lenient**: Attempts to parse malformed or incomplete XML.
- **Object Output**: Converts XML to a JavaScript object structure.
- **Attribute Handling**: Parses XML attributes with a configurable prefix.
- **Text Node Handling**: Manages text content within tags. Text content is always placed in a specified text node (e.g., `"#text"`), as `alwaysCreateTextNode` defaults to `true`.
- **Entity Decoding**: Decodes basic XML entities (`<`, `>`, `&`, `"`, `'`) and numeric entities.
- **CDATA Support**: Properly handles CDATA sections.
- **Stop Nodes**: Ability to specify tags whose content should not be parsed.
- **Primitive Type Parsing**: Optional conversion of string values to numbers and booleans.
- **Conditional Root Node Parsing**: Optionally parse XML only if the root element name is in an allowed list, otherwise treat input as plain text using the `allowedRootNodes` option.
- **Multiple Root Elements**: Supports XML with multiple root elements, returned as an array.

## Use Cases

### Streaming LLM (Large Language Model) Responses

When working with Large Language Models that stream XML-based responses (e.g., an AI assistant providing structured data in XML format incrementally), `partial-xml-stream-parser` can be invaluable. It allows you to parse and process the XML as it arrives, without waiting for the entire response to complete. This is particularly useful for:

- **Real-time UI updates**: Displaying parts of the LLM's response as soon as they are available.
- **Early data extraction**: Acting on structured data within the XML stream before the full response is received.
- **Handling potentially very large or unterminated streams**: Gracefully parsing what's available even if the stream is cut off or extremely long.

```javascript
// Example: Simulating an LLM streaming XML
const llmStream = [
  "<response><status>thinking</status><data>",
  '<item id="1">First part of data...</item>',
  '<item id="2">Second part, still thinking...',
  " still processing...</item></data><status>partial</status>",
  "</response>", // Let's imagine the stream ends here, maybe prematurely
];

const parser = new PartialXMLStreamParser(); // alwaysCreateTextNode is true by default

llmStream.forEach((chunk) => {
  const result = parser.parseStream(chunk);
  if (result && result.xml && result.xml.length > 0) {
    console.log("--- Partial LLM XML ---");
    console.log(JSON.stringify(result.xml, null, 2));
    // Example access, assuming result.xml is an array with one root object
    // With alwaysCreateTextNode: true (default), structure is consistent:
    // responseObj.status will be { "#text": "thinking" } or { "#text": "partial" }
    // responseObj.data.item will be an array of objects like { "@id": "1", "#text": "..." }
    const responseObj = result.xml[0].response;
    if (responseObj && responseObj.data && responseObj.data.item) {
      const items = Array.isArray(responseObj.data.item)
        ? responseObj.data.item
        : [responseObj.data.item];
      items.forEach((item) => {
        if (item["#text"] && item["#text"].includes("still processing...")) {
          console.log(`Item ${item["@id"]} is still processing.`);
        }
      });
    }
  }
});

const finalResult = parser.parseStream(null); // Signal end of stream
console.log("--- Final LLM XML ---");
console.log(JSON.stringify(finalResult.xml, null, 2));
// Expected final output would show items with "#text" nodes, e.g.,
// "item": [ { "@id": "1", "#text": "First part of data..." }, { "@id": "2", "#text": "Second part, still thinking... still processing..." } ]
// "status": [ { "#text": "thinking" }, { "#text": "partial" } ]
```
### Handling Plain Text Input (No XML Tags)

The parser is also capable of handling input streams that do not contain any XML tags, essentially treating them as plain text. This can be useful in scenarios where the input might sometimes be XML and sometimes just text, or if you need to process raw text through the same pipeline.

- **Non-Whitespace Text**: If the input chunk is plain text (and not just whitespace), it will be returned as a string element in the `xml` array in the result. Any leading/trailing whitespace in the input string will be preserved.
- **Whitespace-Only Text**: If the input chunk consists solely of whitespace, it is typically ignored, and the `xml` array will be empty (or `null` if it's the only content and the stream ends).
- **Empty String Input**: Passing an empty string `""` indicates an empty chunk but not the end of the stream; `metadata.partial` will be `true` and `xml` will be `null` until more data or `null` is passed.

```javascript
const parser = new PartialXMLStreamParser();

// Example 1: Input with non-whitespace text
let result1 = parser.parseStream("  This is some plain text.  ");
console.log("--- Plain Text Input ---");
console.log(JSON.stringify(result1, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": [ "  This is some plain text.  " ]
// }
result1 = parser.parseStream(null); // End stream
console.log(JSON.stringify(result1, null, 2));
// Output (remains the same after null if no new data):
// {
//   "metadata": { "partial": false },
//   "xml": [ "  This is some plain text.  " ]
// }

parser.reset();

// Example 2: Input with only whitespace
let result2 = parser.parseStream("   \t  \n  ");
console.log("--- Whitespace-Only Input ---");
console.log(JSON.stringify(result2, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": []
// }
result2 = parser.parseStream(null); // End stream
console.log(JSON.stringify(result2, null, 2));
// Output (xml becomes null if only whitespace was processed and stream ends):
// {
//   "metadata": { "partial": false },
//   "xml": null
// }

parser.reset();

// Example 3: Empty string input
let result3 = parser.parseStream("");
console.log("--- Empty String Input ---");
console.log(JSON.stringify(result3, null, 2));
// Output:
// {
//   "metadata": { "partial": true },
//   "xml": null
// }
result3 = parser.parseStream(null); // End stream
console.log(JSON.stringify(result3, null, 2));
// Output (xml remains null if only empty string was passed):
// {
//   "metadata": { "partial": false },
//   "xml": null
// }
```

## Installation

```bash
npm install partial-xml-stream-parser
# or
yarn add partial-xml-stream-parser
```

(Note: This package is not yet published to npm. This is a placeholder for installation instructions.)

## Usage

```javascript
const PartialXMLStreamParser = require("partial-xml-stream-parser");

const parser = new PartialXMLStreamParser({
  textNodeName: "#text", // Default is "#text"
  attributeNamePrefix: "@", // Default is "@"
  alwaysCreateTextNode: true, // Default is true
  // parsePrimitives: false, // Default is false
  // stopNodes: [], // Default is empty
  // allowedRootNodes: [], // Default is empty (parse all XML unconditionally)
});

let result;

result = parser.parseStream('<root><item id="1">Te');
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": true
//   },
//   "xml": [
//     {
//       "root": {
//         "item": {
//           "@id": "1",
//           "#text": "Te"
//         }
//       }
//     }
//   ]
// }

result = parser.parseStream("st</item>");
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": true
//   },
//   "xml": [
//     {
//       "root": {
//         "item": {
//           "@id": "1",
//           "#text": "Test"
//         }
//       }
//     }
//   ]
// }

result = parser.parseStream("</root>");
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": [
//     {
//       "root": {
//         "item": {
//           "@id": "1", // Attributes are preserved
//           "#text": "Test"
//         }
//       }
//     }
//   ]
// }

result = parser.parseStream(null); // Signal end of stream
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": [
//     {
//       "root": {
//         "item": {
//           "@id": "1",
//           "#text": "Test"
//         }
//       }
//     }
//   ]
// }
```

### Advanced Usage Examples

#### Stop Nodes

Stop nodes are tags whose content is not parsed as XML, but treated as raw text:

```javascript
const parser = new PartialXMLStreamParser({
  stopNodes: ["script", "style"], // Don't parse content inside script or style tags
});

const result = parser.parseStream(
  '<root><script type="text/javascript">if (x < y && z > 0) { alert("Hello!"); }</script></root>',
);
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": [
//     {
//       "root": {
//         "script": {
//           "@type": "text/javascript",
//           "#text": "if (x < y && z > 0) { alert(\"Hello!\"); }"
//         }
//       }
//     }
//   ]
// }
```

#### Primitive Type Parsing

Convert string values to appropriate primitive types:

```javascript
const parser = new PartialXMLStreamParser({
  parsePrimitives: true,
});

const result = parser.parseStream(
  "<data><number>42</number><boolean>true</boolean></data>",
);
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": [
//     {
//       "data": {
//         "number": {
//           "#text": 42 // alwaysCreateTextNode is true by default
//         },
//         "boolean": {
//           "#text": true // alwaysCreateTextNode is true by default
//         }
//       }
//     }
//   ]
// }
```

#### `alwaysCreateTextNode` (Default: `true`)

The `alwaysCreateTextNode` option is `true` by default. This ensures text content is always placed in a text node (e.g., `"#text"` as per `textNodeName`), even for elements that only contain text or are mixed with attributes. This provides a consistent structure for accessing text.

If you were to set `alwaysCreateTextNode: false` (not the default), the parser would simplify text-only elements:

```javascript
// Example with alwaysCreateTextNode: false (NOT THE DEFAULT)
const parserOldBehavior = new PartialXMLStreamParser({
  alwaysCreateTextNode: false,
  textNodeName: "#text",
});
const resultOld = parserOldBehavior.parseStream("<root><item>text</item></root>");
console.log(JSON.stringify(resultOld, null, 2));
// Output (if alwaysCreateTextNode were false):
// {
//   "metadata": { "partial": false },
//   "xml": [ { "root": { "item": "text" } } ]
// }

// Default behavior (alwaysCreateTextNode: true):
const parserDefault = new PartialXMLStreamParser({ textNodeName: "#myText" });
const resultDefault = parserDefault.parseStream("<root><item>text</item></root>");
console.log(JSON.stringify(resultDefault, null, 2));
// Output (default behavior):
// {
//   "metadata": { "partial": false },
//   "xml": [ { "root": { "item": { "#myText": "text" } } } ]
// }
```

#### Conditional Root Node Parsing (`allowedRootNodes`)

The `allowedRootNodes` option allows you to specify a list of root element names. If the incoming stream's root element is in this list (or matches the string, if a string is provided), it will be parsed as XML. Otherwise, the entire stream will be treated as plain text. This is useful when you expect XML only of a certain type and want to gracefully handle other inputs as raw text.

- If `allowedRootNodes` is an empty array (default) or `undefined`, all XML will be parsed.
- If `allowedRootNodes` is a non-empty array of strings, only XML whose root tag is one of those strings will be parsed.
- If `allowedRootNodes` is a single string, only XML whose root tag matches that string will be parsed.

```javascript
// Example 1: Allowed root node
const parserAllowed = new PartialXMLStreamParser({ allowedRootNodes: ["message"] });
let resultAllowed = parserAllowed.parseStream("<message><content>Hello</content></message>");
console.log("--- Allowed Root ---");
console.log(JSON.stringify(resultAllowed, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": [ { "message": { "content": { "#text": "Hello" } } } ]
// }
resultAllowed = parserAllowed.parseStream(null); // End stream
console.log(JSON.stringify(resultAllowed, null, 2));


// Example 2: Not an allowed root node
const parserNotAllowed = new PartialXMLStreamParser({ allowedRootNodes: ["message"] });
let resultNotAllowed = parserNotAllowed.parseStream("<alert><text>Warning</text></alert>");
console.log("--- Not Allowed Root (treated as plain text) ---");
console.log(JSON.stringify(resultNotAllowed, null, 2));
// Output:
// {
//   "metadata": { "partial": true },
//   "xml": [ "<alert><text>Warning</text></alert>" ]
// }
resultNotAllowed = parserNotAllowed.parseStream(null); // End stream
console.log(JSON.stringify(resultNotAllowed, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": [ "<alert><text>Warning</text></alert>" ]
// }

// Example 3: allowedRootNodes active, but input is plain text from the start
const parserPlainText = new PartialXMLStreamParser({ allowedRootNodes: ["message"] });
let resultPlainText = parserPlainText.parseStream("This is just simple text.");
console.log("--- Plain text with allowedRootNodes active ---");
console.log(JSON.stringify(resultPlainText, null, 2));
// Output:
// {
//   "metadata": { "partial": true },
//   "xml": [ "This is just simple text." ]
// }
resultPlainText = parserPlainText.parseStream(null); // End stream
console.log(JSON.stringify(resultPlainText, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": [ "This is just simple text." ]
// }

// Example 4: allowedRootNodes not provided or empty (default behavior - parse all XML)
const parserDefaultBehavior = new PartialXMLStreamParser(); // or { allowedRootNodes: [] }
let resultDefaultBehav = parserDefaultBehavior.parseStream("<anyRoot><data>info</data></anyRoot>");
console.log("--- Default (no allowedRootNodes restriction) ---");
console.log(JSON.stringify(resultDefaultBehav, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": [ { "anyRoot": { "data": { "#text": "info" } } } ]
// }
resultDefaultBehav = parserDefaultBehavior.parseStream(null);
console.log(JSON.stringify(resultDefaultBehav, null, 2));

```

## API

### `new PartialXMLStreamParser(options)`

Creates a new parser instance.

- `options` (Object, Optional):
  - `textNodeName` (String): The key to use for text content. Defaults to `"#text"`.
  - `attributeNamePrefix` (String): The prefix for attribute names. Defaults to `"@"`.
  - `stopNodes` (Array|String): Tag names (e.g., `script`) or paths (e.g., `parent.child.tag`) that should not have their children parsed. Defaults to `[]`.
  - `alwaysCreateTextNode` (Boolean): If true, text content is always in a text node. Defaults to `true`.
  - `parsePrimitives` (Boolean): If true, attempts to parse numbers and booleans from text and attribute values. Defaults to `false`.
  - `allowedRootNodes` (Array<String>|String): Optional. If provided and not empty, the parser will only treat the input as XML if the root element's name is in this list (or matches the string, if a string is provided). Otherwise, the input is treated as plain text. Defaults to `[]` (parse all XML unconditionally).

### `parser.parseStream(xmlChunk)`

Parses a chunk of XML.

- `xmlChunk` (String | Buffer | null | undefined): The XML chunk to process.
  - Pass a string or Buffer containing XML data.
  - Pass `null` or `undefined` to signal the end of the stream.
  - Passing an empty string `""` indicates an empty chunk but not necessarily the end of the stream.
- Returns (Object): The parsing result with the following structure:
  ```javascript
  {
    metadata: {
      partial: boolean // Indicates if the parsing is incomplete (true) or complete (false)
    },
    xml: Array<any> | null // The parsed XML content as an array of root elements/text, or null if no valid XML was found and stream ended.
  }
  ```

### `parser.reset()`

Resets the parser state, allowing it to be reused for parsing a new XML stream.

## Parser Behavior

### Text Nodes

- With `alwaysCreateTextNode: true` (the default), text content is consistently placed within a property named by `textNodeName` (e.g., `"#text"`).
- This applies to elements that are text-only, elements with attributes and text, and elements with mixed content (child elements and text).
- Whitespace-only text nodes that appear between elements are generally ignored and do not create a `textNodeName` property.

### Multiple Occurrences

- If the same tag appears multiple times as a child of the same parent, they are automatically collected into an array under that tag name.
- If a tag has multiple distinct text segments (e.g., interspersed with child elements), these text segments are collected under the `textNodeName` property. If `alwaysCreateTextNode` is true, adjacent text segments are concatenated into a single string value for that `textNodeName`; if there are intervening non-text children, multiple text segments might result in an array of strings under `textNodeName` if the logic for `addValueToObject` determines it (though current behavior aims to concatenate).

### Special XML Structures

- **CDATA Sections**: Content is preserved exactly as is, including special characters, and placed in the `textNodeName` property.
- **Comments**: XML comments are ignored.
- **XML Declaration**: XML declarations like `<?xml version="1.0"?>` are ignored.
- **DOCTYPE**: DOCTYPE declarations are ignored.
- **Multiple Root Elements**: If the XML stream contains multiple root-level elements or text nodes, the `xml` property in the result will be an array containing each of these root items in order.

### Lenient Parsing

The parser attempts to handle various imperfect XML scenarios:

- **Incomplete tags**: Fragments at the end of a chunk are carried over. If the stream ends (is `null`-terminated) with an incomplete tag (e.g., `<tag` or `</tag`), this fragment is generally treated as text content of its last open parent element. The `metadata.partial` flag will be `true` in such EOF scenarios to indicate the input ended with an unclosed structure treated as text.
- Malformed tags (may be treated as text)
- Unterminated CDATA sections (content parsed up to the end of chunk, marked as partial)
- Unterminated comments, DOCTYPEs, XML declarations (ignored if unterminated at stream end)
- Text outside of any element (becomes a root-level text item in the result array)

## Performance

The parser is designed to be efficient for streaming scenarios. You can run the benchmarks to test performance:

```bash
npm run bench
```

This will test various parsing scenarios including:

- Simple and complex XML
- Single chunk vs multiple chunks
- Large XML documents
- Special XML features (CDATA, stop nodes, etc.)

## License

MIT
