# Partial XML Stream Parser

A lenient, streaming XML parser for Node.js. This parser is designed to handle XML data that may be incomplete or not perfectly well-formed, making it suitable for processing streams of XML where the entire document might not be available at once.

## Features

- **Streaming Parser**: Processes XML data in chunks.
- **Lenient**: Attempts to parse malformed or incomplete XML.
- **Object Output**: Converts XML to a JavaScript object structure.
- **Attribute Handling**: Parses XML attributes with a configurable prefix.
- **Text Node Handling**: Manages text content within tags.
- **Entity Decoding**: Decodes basic XML entities (`<`, `>`, `&`, `"`, `'`).

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
  textNodeName: "#text", // Optional: Default is "#text"
  attributeNamePrefix: "@", // Optional: Default is "@"
});

let result;

result = parser.parseStream('<root><item id="1">Te');
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "root": {
//     "item": {
//       "@id": "1",
//       "#text": "Te"
//     }
//   },
//   "_partial": true
// }

result = parser.parseStream("st</item>");
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "root": {
//     "item": {
//       "@id": "1",
//       "#text": "Test"
//     }
//   },
//   "_partial": true
// }

result = parser.parseStream("</root>");
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "root": {
//     "item": "Test" // Simplified if only text content
//   },
//   "_partial": true
// }

result = parser.parseStream(null); // Signal end of stream
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "root": {
//     "item": "Test"
//   },
//   "_partial": false
// }
```

## API

### `new PartialXMLStreamParser(options)`

Creates a new parser instance.

- `options` (Object, Optional):
  - `textNodeName` (String): The key to use for text content. Defaults to `"#text"`.
  - `attributeNamePrefix` (String): The prefix for attribute names. Defaults to `"@"`.

### `parser.parseStream(xmlChunk)`

Parses a chunk of XML.

- `xmlChunk` (String | Buffer | null | undefined): The XML chunk to process.
  - Pass a string or Buffer containing XML data.
  - Pass `null` or `undefined` to signal the end of the stream.
  - Passing an empty string `""` indicates an empty chunk but not necessarily the end of the stream.
- Returns (Object): The partially or fully parsed JavaScript object. The object will have a `_partial` boolean property indicating if the stream is considered ongoing (`true`) or complete (`false`).

### `parser.addEntity(key, value)`

(Note: This method is present for conceptual API consistency but is not currently used by the internal parsing logic for custom entities. Basic entities are hardcoded.)

Adds a custom entity.

- `key` (String): The entity name (without `&` and `;`).
- `value` (String): The entity value.

## License

ISC
