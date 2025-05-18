# Partial XML Stream Parser

A lenient, streaming XML parser for Node.js. This parser is designed to handle XML data that may be incomplete or not perfectly well-formed, making it suitable for processing streams of XML where the entire document might not be available at once.

## Features

- **Streaming Parser**: Processes XML data in chunks.
- **Lenient**: Attempts to parse malformed or incomplete XML.
- **Object Output**: Converts XML to a JavaScript object structure.
- **Attribute Handling**: Parses XML attributes with a configurable prefix.
- **Text Node Handling**: Manages text content within tags.
- **Entity Decoding**: Decodes basic XML entities (`<`, `>`, `&`, `"`, `'`) and numeric entities.
- **CDATA Support**: Properly handles CDATA sections.
- **Stop Nodes**: Ability to specify tags whose content should not be parsed.
- **Primitive Type Parsing**: Optional conversion of string values to numbers and booleans.
- **Multiple Root Elements**: Supports XML with multiple root elements.

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
//   "metadata": {
//     "partial": true
//   },
//   "xml": {
//     "root": {
//       "item": {
//         "@id": "1",
//         "#text": "Te"
//       }
//     }
//   }
// }

result = parser.parseStream("st</item>");
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": true
//   },
//   "xml": {
//     "root": {
//       "item": {
//         "@id": "1",
//         "#text": "Test"
//       }
//     }
//   }
// }

result = parser.parseStream("</root>");
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": {
//     "root": {
//       "item": "Test" // Simplified if only text content
//     }
//   }
// }

result = parser.parseStream(null); // Signal end of stream
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": {
//     "root": {
//       "item": "Test"
//     }
//   }
// }
```

### Advanced Usage Examples

#### Stop Nodes

Stop nodes are tags whose content is not parsed as XML, but treated as raw text:

```javascript
const parser = new PartialXMLStreamParser({
  stopNodes: ["script", "style"] // Don't parse content inside script or style tags
});

const result = parser.parseStream('<root><script type="text/javascript">if (x < y && z > 0) { alert("Hello!"); }</script></root>');
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": {
//     "root": {
//       "script": {
//         "@type": "text/javascript",
//         "#text": "if (x < y && z > 0) { alert(\"Hello!\"); }"
//       }
//     }
//   }
// }
```

#### Primitive Type Parsing

Convert string values to appropriate primitive types:

```javascript
const parser = new PartialXMLStreamParser({
  parsePrimitives: true
});

const result = parser.parseStream('<data><number>42</number><boolean>true</boolean></data>');
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": {
//     "data": {
//       "number": 42,
//       "boolean": true
//     }
//   }
// }
```

#### Always Create Text Node

Force text content to always be in a text node, even for elements with only text:

```javascript
const parser = new PartialXMLStreamParser({
  alwaysCreateTextNode: true
});

const result = parser.parseStream('<root><item>text</item></root>');
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": {
//     "root": {
//       "item": {
//         "#text": "text"
//       }
//     }
//   }
// }
```

## API

### `new PartialXMLStreamParser(options)`

Creates a new parser instance.

- `options` (Object, Optional):
  - `textNodeName` (String): The key to use for text content. Defaults to `"#text"`.
  - `attributeNamePrefix` (String): The prefix for attribute names. Defaults to `"@"`.
  - `stopNodes` (Array|String): Tag names that should not have their children parsed. Defaults to `[]`.
  - `alwaysCreateTextNode` (Boolean): If true, text content is always in a text node. Defaults to `false`.
  - `parsePrimitives` (Boolean): If true, attempts to parse numbers and booleans. Defaults to `false`.

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
    xml: any | null // The parsed XML content, or null if no valid XML was found
  }
  ```

### `parser.reset()`

Resets the parser state, allowing it to be reused for parsing a new XML stream.

## Parser Behavior

### Text Nodes

- By default, elements with only text content are simplified to just the text value.
- Elements with both attributes and text content will have the text in a property named by `textNodeName`.
- Elements with both child elements and text content will have the text in a property named by `textNodeName`.
- Whitespace-only text nodes are ignored.

### Multiple Occurrences

- If the same tag appears multiple times at the same level, they are automatically converted to an array.
- If a tag has multiple text segments, they are concatenated unless `alwaysCreateTextNode` is true.

### Special XML Structures

- **CDATA Sections**: Content is preserved exactly as is, including special characters.
- **Comments**: XML comments are ignored.
- **XML Declaration**: XML declarations like `<?xml version="1.0"?>` are ignored.
- **DOCTYPE**: DOCTYPE declarations are ignored.
- **Multiple Root Elements**: Each root element becomes an entry in an array.

### Lenient Parsing

The parser attempts to handle various imperfect XML scenarios:
- Incomplete tags
- Malformed tags
- Unterminated CDATA sections
- Unterminated comments
- Text outside of any element

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
