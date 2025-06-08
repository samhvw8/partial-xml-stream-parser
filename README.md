# Partial XML Stream Parser

[![npm version](https://badge.fury.io/js/partial-xml-stream-parser.svg)](https://badge.fury.io/js/partial-xml-stream-parser)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/samhvw8/partial-xml-stream-parser/actions)
[![npm downloads](https://img.shields.io/npm/dm/partial-xml-stream-parser.svg)](https://www.npmjs.com/package/partial-xml-stream-parser)

A lenient, streaming XML parser for Node.js. This parser is designed to handle XML data that may be incomplete or not perfectly well-formed, making it suitable for processing streams of XML where the entire document might not be available at once. It's particularly optimized for handling mixed content with both XML elements and plain text, making it ideal for parsing LLM outputs that contain tool calls embedded in natural language.

## Features

- **Streaming Parser**: Processes XML data in chunks.
- **Lenient**: Attempts to parse malformed or incomplete XML.
- **Object Output**: Converts XML to a JavaScript object structure.
- **Attribute Handling**: Parses XML attributes with a configurable prefix.
- **Text Node Handling**: Manages text content within tags. Text content is always placed in a specified text node (e.g., `"#text"`), as `alwaysCreateTextNode` defaults to `true`.
- **Entity Decoding**: Decodes basic XML entities (`<`, `>`, `&`, `"`, `'`) and numeric entities.
- **CDATA Support**: Properly handles CDATA sections and automatically wraps XML-like content in CDATA for serialization.
- **XML Serialization**: Convert parsed XML objects back to XML strings with `xmlObjectToString`.
- **Round-trip Parsing**: Full support for parsing → serializing → parsing workflows.
- **Stop Nodes**: Ability to specify tags whose content should not be parsed.
- **Max Depth Control**: Limit XML parsing depth with the `maxDepth` option - tags beyond the specified depth are treated as stop nodes.
- **Primitive Type Parsing**: Optional conversion of string values to numbers and booleans.
- **Enhanced Conditional Root Node Parsing**: Improved handling of XML content when using the `allowedRootNodes` option, with better detection and processing of allowed root elements.
- **Multiple Root Elements**: Supports XML with multiple root elements, returned as an array.
- **Mixed Content Handling**: Optimized for processing streams that contain both XML elements and plain text, making it ideal for parsing LLM outputs with embedded tool calls.
- **Robust Partial State Management**: Better handling of incomplete XML structures at stream boundaries.

## What's New in v1.9.0

This minor release introduces powerful wildcard pattern support for stopNodes:

- **Wildcard Pattern Support**: StopNodes now support glob-style patterns with asterisks (`*`) for flexible path matching:
  - **Prefix matching**: `app.*` matches `app.config`, `app.settings`, etc.
  - **Suffix matching**: `*.suggest` matches `follow_up.suggest`, `other.suggest`, etc.
  - **Middle wildcards**: `app.*.value` matches `app.config.value`, `app.settings.value`, etc.
  - **Multiple wildcards**: `*.config.*` matches any path with `config` in the middle
- **Enhanced Path Matching**: Combines wildcard patterns with existing exact and suffix matching for maximum flexibility
- **Comprehensive Test Coverage**: Added 9 new test cases covering all wildcard pattern scenarios and edge cases

### Previous Release (v1.8.2)

This patch release fixed a critical issue with path-based stopnode matching:

- **Fixed Path-based Stopnode Suffix Matching**: Path-based stopnodes now support suffix matching in addition to exact matching. For example, `follow_up.suggest` will now correctly match nodes with the full path `ask_followup_question.follow_up.suggest`.
- **Enhanced Stopnode Behavior**: Stopnodes now correctly parse and include the specified nodes in results while treating their content as raw text, instead of stopping before the nodes.
- **Comprehensive Test Coverage**: Added new test suite specifically for stopnode suffix matching scenarios.

### Previous Release (v1.8.1)

This patch release fixes a critical bug in the `maxDepth` feature:

- **Fixed maxDepth Logic**: Corrected the depth checking condition from `>=` to `>` to properly implement depth limits. Previously, tags were being treated as text one level earlier than intended.
- **Updated Test Suite**: Fixed all test expectations to match the corrected behavior.
- **Improved Documentation**: Clarified the correct behavior of `maxDepth` with accurate examples.

### Previous Release (v1.8.0)

This release introduced depth control and enhanced XML processing capabilities:

- **Max Depth Control**: New `maxDepth` option allows limiting XML parsing depth. Tags beyond the specified depth are treated as stop nodes, with their content preserved as raw text.
- **Enhanced CDATA Handling**: Improved CDATA detection and processing for better round-trip parsing reliability.
- **Comprehensive Test Coverage**: Added extensive tests for depth control scenarios and edge cases.

### Previous Release (v1.7.0)

This release introduced CDATA support for XML serialization and round-trip parsing:

- **XML Serialization with CDATA Support**: New `xmlObjectToString` function that converts parsed XML objects back to XML strings with automatic CDATA wrapping for content containing XML-like characters.
- **Round-trip Parsing**: Full support for parsing XML, serializing it back to a string, and parsing it again with consistent results.
- **Automatic CDATA Detection**: Text content containing `<`, `>`, or `&` characters is automatically wrapped in CDATA sections to prevent parsing conflicts.
- **Enhanced Module Exports**: The module now exports both `PartialXMLStreamParser` and `xmlObjectToString` for complete XML processing workflows.
- **Comprehensive Test Coverage**: Added 600+ new tests covering serialization, round-trip parsing, and edge cases.

### Previous Release (v1.6.0)

- **Enhanced Mixed Content Processing**: Better handling of streams that contain both XML elements and plain text, particularly useful for parsing LLM outputs with embedded tool calls.
- **Improved Conditional Root Node Parsing**: The `allowedRootNodes` feature has been completely reworked to provide more reliable detection and processing of allowed root elements, with better handling of text content before, between, and after XML elements.
- **Robust Partial State Management**: Better handling of incomplete XML structures at stream boundaries, ensuring more consistent parsing results across chunk boundaries.
- **Optimized Buffer Management**: More efficient handling of streaming buffers, reducing memory usage and improving performance.
- **Fixed Edge Cases**: Resolved several edge cases related to partial XML parsing and mixed content handling.

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
const { PartialXMLStreamParser, xmlObjectToString } = require("partial-xml-stream-parser");

// Or if you only need the parser:
// const { PartialXMLStreamParser } = require("partial-xml-stream-parser");

const parser = new PartialXMLStreamParser({
  textNodeName: "#text", // Default is "#text"
  attributeNamePrefix: "@", // Default is "@"
  alwaysCreateTextNode: true, // Default is true
  // parsePrimitives: false, // Default is false
  // stopNodes: [], // Default is empty
  // maxDepth: null, // Default is null (no depth limit)
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

## XML Serialization and Round-trip Parsing

The `xmlObjectToString` function allows you to convert parsed XML objects back to XML strings, with automatic CDATA support for content containing XML-like characters:

```javascript
const { PartialXMLStreamParser, xmlObjectToString } = require("partial-xml-stream-parser");

// Example 1: Basic serialization
const xmlObject = {
  document: {
    "@version": "1.0",
    header: { title: "Test Document" },
    body: {
      section: [
        { "@id": "s1", p: "Paragraph 1" },
        { "@id": "s2", p: "Paragraph 2 with <special> chars" }
      ]
    }
  }
};

const xmlString = xmlObjectToString(xmlObject);
console.log(xmlString);
// Output:
// <document version="1.0"><header><title>Test Document</title></header><body><section id="s1"><p>Paragraph 1</p></section><section id="s2"><p><![CDATA[Paragraph 2 with <special> chars]]></p></section></body></document>

// Example 2: Round-trip parsing
const parser = new PartialXMLStreamParser({
  textNodeName: "#text",
  attributeNamePrefix: "@"
});

// Parse the serialized XML back
const parsed = parser.parseStream(xmlString);
console.log(JSON.stringify(parsed.xml[0], null, 2));

// Serialize again - should be identical to original
const reserialized = xmlObjectToString(parsed.xml[0]);
console.log("Round-trip successful:", xmlString === reserialized);
// Output: Round-trip successful: true

// Example 3: CDATA handling
const textWithXml = "This contains <tags> and & entities";
const simpleObject = { message: textWithXml };

const serialized = xmlObjectToString(simpleObject);
console.log(serialized);
// Output: <message><![CDATA[This contains <tags> & entities]]></message>

// Parse it back
const reparsed = parser.parseStream(serialized);
console.log(reparsed.xml[0].message["#text"]);
// Output: This contains <tags> & entities
```

### Key Features of XML Serialization:

- **Automatic CDATA Wrapping**: Text content containing `<`, `>`, or `&` characters is automatically wrapped in CDATA sections
- **Attribute Handling**: Supports custom attribute prefixes (default: `@`)
- **Text Node Support**: Handles custom text node names (default: `#text`)
- **Array Support**: Properly serializes arrays as multiple elements with the same tag name
- **Round-trip Compatibility**: Ensures that parsed XML can be serialized and parsed again with identical results

### Advanced Usage Examples

#### Max Depth Control

The `maxDepth` option allows you to limit the nesting depth of XML parsing. Tags beyond the specified depth are treated as stop nodes, with their content preserved as raw text:

```javascript
const parser = new PartialXMLStreamParser({
  maxDepth: 2, // Allow depths 0, 1, and 2 - treat depth 3+ as text
  textNodeName: "#text",
});

const result = parser.parseStream(
  '<root><level1><level2><level3>deep content</level3></level2></level1></root>',
);
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": {
//     "partial": false
//   },
//   "xml": [
//     {
//       "root": {           // depth 0 - parsed
//         "level1": {       // depth 1 - parsed
//           "level2": {     // depth 2 - parsed
//             "#text": "<level3>deep content</level3>"  // depth 3+ - treated as text
//           }
//         }
//       }
//     }
//   ]
// }
```

**Important Note**: The depth counting is 0-based:
- `maxDepth: 1` allows depths 0 and 1 (root + 1 level)
- `maxDepth: 2` allows depths 0, 1, and 2 (root + 2 levels)
- `maxDepth: 3` allows depths 0, 1, 2, and 3 (root + 3 levels)

This feature is particularly useful for:
- **Preventing excessive nesting**: Limiting parsing depth in deeply nested XML structures
- **Performance optimization**: Reducing processing overhead for complex XML documents
- **Content preservation**: Maintaining raw XML content beyond a certain depth for later processing
- **Security**: Preventing potential issues with maliciously deep XML structures

#### Stop Nodes

Stop nodes are tags whose content is not parsed as XML, but treated as raw text. StopNodes support both exact tag names and flexible wildcard patterns:

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

##### Wildcard Pattern Support

StopNodes now support glob-style patterns with asterisks (`*`) for flexible path matching:

```javascript
// Prefix matching: matches any child of 'app'
const parser1 = new PartialXMLStreamParser({
  stopNodes: ["app.*"],
  textNodeName: "#text",
});

const result1 = parser1.parseStream(
  '<root><app><config><item>not parsed</item></config><settings><option>also not parsed</option></settings></app></root>'
);
console.log(JSON.stringify(result1, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": [{
//     "root": {
//       "app": {
//         "config": { "#text": "<item>not parsed</item>" },
//         "settings": { "#text": "<option>also not parsed</option>" }
//       }
//     }
//   }]
// }

// Suffix matching: matches any path ending with 'suggest'
const parser2 = new PartialXMLStreamParser({
  stopNodes: ["*.suggest"],
  textNodeName: "#text",
});

const result2 = parser2.parseStream(
  '<root><follow_up><suggest><option>Option 1</option></suggest></follow_up><other><suggest><item>not parsed</item></suggest></other></root>'
);
console.log(JSON.stringify(result2, null, 2));
// Output:
// {
//   "metadata": { "partial": false },
//   "xml": [{
//     "root": {
//       "follow_up": { "suggest": { "#text": "<option>Option 1</option>" } },
//       "other": { "suggest": { "#text": "<item>not parsed</item>" } }
//     }
//   }]
// }

// Middle wildcards: matches paths like 'app.config.value', 'app.settings.value'
const parser3 = new PartialXMLStreamParser({
  stopNodes: ["app.*.value"],
  textNodeName: "#text",
});

// Multiple wildcards: matches any path with 'config' in the middle
const parser4 = new PartialXMLStreamParser({
  stopNodes: ["*.config.*"],
  textNodeName: "#text",
});

// Mixed patterns: combine wildcards with regular stopNodes
const parser5 = new PartialXMLStreamParser({
  stopNodes: ["script", "app.*", "*.config"],
  textNodeName: "#text",
});
```

**Wildcard Pattern Rules:**
- `*` matches any sequence of characters except dots (`.`)
- Patterns support exact matching, suffix matching, and wildcard matching
- Multiple wildcards can be used in a single pattern
- Wildcard patterns work alongside regular stopNode names
- Patterns are matched against the full path from root to the current element

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

In v1.6.0, this feature has been significantly improved:
- Better detection of allowed root elements in mixed content
- More consistent handling of text content before, between, and after XML elements
- Improved partial state management when streaming with allowed root nodes
- Optimized buffer processing for better performance

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

### Mixed Content with Tool Calls

A common use case for this parser is handling LLM outputs that contain both natural language text and structured XML tool calls. The v1.6.0 release significantly improves handling of this scenario:

```javascript
// Example: Parsing LLM output with mixed content and tool calls
const parser = new PartialXMLStreamParser({
  allowedRootNodes: ["read_file", "write_to_file", "execute_command"] // Only parse these as XML
});

// Simulating an LLM response with mixed content
const llmResponse = "I'll help you with that task.\n\n" +
                   "<read_file><path>src/index.ts</path></read_file>\n\n" +
                   "Now let's modify the file:\n\n" +
                   "<write_to_file><path>src/index.ts</path><content>\n" +
                   "// Updated content\n" +
                   "console.log(\"Hello world\");\n" +
                   "</content><line_count>2</line_count></write_to_file>\n\n" +
                   "Let's run the code:\n\n" +
                   "<execute_command><command>node src/index.ts</command></execute_command>";

// Parse the entire response at once
let result = parser.parseStream(llmResponse);
console.log("--- Mixed Content with Tool Calls ---");
console.log(JSON.stringify(result, null, 2));
// Output:
// {
//   "metadata": { "partial": true },
//   "xml": [
//     "I'll help you with that task.\n\n",
//     {
//       "read_file": {
//         "path": { "#text": "src/index.ts" }
//       }
//     },
//     "\n\nNow let's modify the file:\n\n",
//     {
//       "write_to_file": {
//         "path": { "#text": "src/index.ts" },
//         "content": { "#text": "\n// Updated content\nconsole.log(\"Hello world\");\n" },
//         "line_count": { "#text": "2" }
//       }
//     },
//     "\n\nLet's run the code:\n\n",
//     {
//       "execute_command": {
//         "command": { "#text": "node src/index.ts" }
//       }
//     }
//   ]
// }

// You can also stream the content in chunks
parser.reset();
const chunks = [
  "I'll help you with that task.\n\n<read",
  "_file><path>src/index.ts</path></read_file>\n\n",
  "Now let's modify the file:\n\n<write_to_file>"
];

chunks.forEach((chunk, i) => {
  console.log(`Processing chunk ${i + 1}:`);
  const result = parser.parseStream(chunk);
  console.log(JSON.stringify(result, null, 2));
});

// Final result after all chunks and EOF
const finalResult = parser.parseStream(null);
console.log("Final result:");
console.log(JSON.stringify(finalResult, null, 2));
```

The key improvements in v1.6.0 for mixed content handling include:

1. **Better text preservation**: Text between XML elements is properly preserved
2. **Improved element detection**: More reliable detection of allowed root elements in a stream of mixed content
3. **Consistent partial state**: Better handling of partial state when streaming chunks that contain both text and XML
4. **Optimized buffer management**: More efficient handling of text and XML content in the same stream

This makes the parser ideal for applications that need to extract structured tool calls from natural language text, such as AI assistants that embed XML commands within their responses.
