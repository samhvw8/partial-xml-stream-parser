import { describe, it, expect, beforeEach } from "vitest";
import PartialXMLStreamParser from "./index.js";

describe("PartialXMLStreamParser", () => {
  let parser;

  beforeEach(() => {
    // Default parser for most tests, now implies alwaysCreateTextNode: true
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
  });

  it("should parse a stream chunk by chunk correctly", () => {
    let streamResult;

    streamResult = parser.parseStream("<read>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ read: {} }],
    });

    streamResult = parser.parseStream("<args>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ read: { args: {} } }],
    });

    streamResult = parser.parseStream("<file><name>as");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ read: { args: { file: { name: { "#text": "as" } } } } }],
    });

    streamResult = parser.parseStream("d</name>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ read: { args: { file: { name: { "#text": "asd" } } } } }],
    });

    streamResult = parser.parseStream("</file></args>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ read: { args: { file: { name: { "#text": "asd" } } } } }],
    });

    streamResult = parser.parseStream("</read>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ read: { args: { file: { name: { "#text": "asd" } } } } }],
    });

    streamResult = parser.parseStream(null); // Signal end of stream
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ read: { args: { file: { name: { "#text": "asd" } } } } }],
    });
  });

  it("should handle a single incomplete chunk, then completion", () => {
    let streamResult;
    const singleChunk = "<request><id>123</id><data>value<da";
    streamResult = parser.parseStream(singleChunk);
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [
        { request: { id: { "#text": "123" }, data: { "#text": "value<da" } } },
      ],
    });

    streamResult = parser.parseStream("ta></request>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [
        {
          request: {
            id: { "#text": "123" },
            data: { "#text": "value", data: {} },
          },
        },
      ],
    });

    streamResult = parser.parseStream(null); // Signal end
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [
        {
          request: {
            id: { "#text": "123" },
            data: { "#text": "value", data: {} },
          },
        },
      ],
    });
  });

  it("should handle a text-only stream", () => {
    let streamResult;
    streamResult = parser.parseStream("Just some text");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Just some text"],
    });

    streamResult = parser.parseStream(null); // End stream
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Just some text"],
    });
  });

  it("should handle self-closing tags and mixed content", () => {
    let streamResult;
    streamResult = parser.parseStream(
      "<root><item/>Text after item<another/></root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: {}, "#text": "Text after item", another: {} } }],
    });

    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: {}, "#text": "Text after item", another: {} } }],
    });
  });

  it("should handle XML entities in text nodes", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" }); // Re-init to be sure about options
    let streamResult = parser.parseStream(
      "<doc>Hello &amp; &quot;World&quot; &apos;Test&apos;</doc>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { "#text": "Hello & \"World\" 'Test'" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { "#text": "Hello & \"World\" 'Test'" } }],
    });
  });

  it("should handle XML entities in attribute values", () => {
    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    let streamResult = parser.parseStream('<doc val="&lt;value&gt;" />');
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { "@val": "<value>" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { "@val": "<value>" } }],
    });
  });

  it("should handle numeric XML entities (decimal and hex)", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<doc>&#60;Hello&#x26;&#32;World&#x3E;</doc>",
    ); // <Hello& World>
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { "#text": "<Hello& World>" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { "#text": "<Hello& World>" } }],
    });
  });

  it("should correctly parse multiple chunks that form a complete XML", () => {
    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    parser.parseStream("<data><item");
    parser.parseStream(' key="value">Te');
    parser.parseStream("st</item><item2");
    let streamResult = parser.parseStream("/></data>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [
        { data: { item: { "@key": "value", "#text": "Test" }, item2: {} } },
      ],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [
        { data: { item: { "@key": "value", "#text": "Test" }, item2: {} } },
      ],
    });
  });

  it("should return empty array xml for empty stream", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream("");
    expect(streamResult).toEqual({ metadata: { partial: true }, xml: null });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: null });
  });

  it("should handle stream with only XML declaration and comments", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream(
      '<?xml version="1.0"?><!-- comment -->',
    );
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: [] });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: null });
  });

  it("should handle custom attributeNamePrefix", () => {
    parser = new PartialXMLStreamParser({ attributeNamePrefix: "_" });
    let streamResult = parser.parseStream('<doc attr="val" />');
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { _attr: "val" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { _attr: "val" } }],
    });

    parser = new PartialXMLStreamParser({ attributeNamePrefix: "" });
    streamResult = parser.parseStream('<doc attr="val" />');
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { attr: "val" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { attr: "val" } }],
    });
  });

  it("should parse CDATA sections correctly", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<root><![CDATA[This is <CDATA> text with & special chars]]></root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { "#text": "This is <CDATA> text with & special chars" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { "#text": "This is <CDATA> text with & special chars" } }],
    });
  });

  it("should handle unterminated CDATA section", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream("<root><![CDATA[Unterminated cdata");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ root: { "#text": "Unterminated cdata" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ root: { "#text": "Unterminated cdata" } }],
    });
  });

  it("should handle CDATA at root level if it is the only content", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream("<![CDATA[Root CDATA]]>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Root CDATA"],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Root CDATA"],
    });
  });

  it("should handle unterminated comments", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream(
      "<root><!-- This is an unterminated comment",
    );
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ root: {} }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ root: {} }],
    });
  });

  it("should handle unterminated DOCTYPE", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"',
    );
    expect(streamResult).toEqual({ metadata: { partial: true }, xml: [] });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: [] });
  });

  it("should handle unterminated XML declaration", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream(
      '<?xml version="1.0" encoding="UTF-8"',
    );
    expect(streamResult).toEqual({ metadata: { partial: true }, xml: [] });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: [] });
  });

  it("should leniently handle mismatched closing tags", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<root><item>text</mismatched></item></root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "#text": "text" } } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "#text": "text" } } }],
    });
  });

  it("should handle attributes without explicit values (boolean attributes) as true", () => {
    parser = new PartialXMLStreamParser({ attributeNamePrefix: "@" });
    let streamResult = parser.parseStream(
      '<input disabled checked="checked" required />',
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [
        {
          input: {
            "@disabled": true,
            "@checked": "checked",
            "@required": true,
          },
        },
      ],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [
        {
          input: {
            "@disabled": true,
            "@checked": "checked",
            "@required": true,
          },
        },
      ],
    });
  });

  it("should correctly simplify text-only elements", () => {
    // This test now reflects alwaysCreateTextNode: true behavior from beforeEach
    let streamResult = parser.parseStream(
      "<parent><child>simple text</child></parent>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ parent: { child: { "#text": "simple text" } } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ parent: { child: { "#text": "simple text" } } }],
    });
  });

  it("should not simplify elements with attributes even if they also have text", () => {
    // This test already aligns with alwaysCreateTextNode: true behavior
    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    let streamResult = parser.parseStream(
      '<parent><child attr="val">text content</child></parent>',
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ parent: { child: { "@attr": "val", "#text": "text content" } } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ parent: { child: { "@attr": "val", "#text": "text content" } } }],
    });
  });

  it("should not simplify elements with child elements", () => {
    // This test's expectation doesn't change with alwaysCreateTextNode
    parser = new PartialXMLStreamParser(); // Uses new default alwaysCreateTextNode: true
    let streamResult = parser.parseStream(
      "<parent><child><grandchild/></child></parent>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ parent: { child: { grandchild: {} } } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ parent: { child: { grandchild: {} } } }],
    });
  });

  it("should ignore text nodes containing only whitespace by default", () => {
    // Expectation changes due to alwaysCreateTextNode: true from beforeEach
    let streamResult = parser.parseStream(
      "<root>  <item>text</item>   </root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "#text": "text" } } }], // Whitespace around item is trimmed, text inside item gets #text
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "#text": "text" } } }],
    });
  });

  it("should omit whitespace text nodes even if alwaysCreateTextNode is true", () => {
    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      alwaysCreateTextNode: true,
    });
    let streamResult = parser.parseStream(
      "<root>  <item>text</item>   </root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "#text": "text" } } }], // Whitespace-only nodes between tags are omitted
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "#text": "text" } } }],
    });
  });

  it("should handle text at root level before any tags", () => {
    parser = new PartialXMLStreamParser(); // Uses new default
    let streamResult = parser.parseStream("Leading text<root/>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Leading text", { root: {} }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Leading text", { root: {} }],
    });
  });

  it("should handle text at root level after all tags are closed", () => {
    parser = new PartialXMLStreamParser(); // Uses new default
    let streamResult = parser.parseStream("<root/>Trailing text");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: {} }, "Trailing text"],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: {} }, "Trailing text"],
    });
  });

  it("should handle multiple root elements", () => {
    // Expectation changes due to alwaysCreateTextNode: true from beforeEach
    let streamResult = parser.parseStream("<rootA/><rootB>text</rootB>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ rootA: {} }, { rootB: { "#text": "text" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ rootA: {} }, { rootB: { "#text": "text" } }],
    });
  });

  it("should handle multiple root elements in specific order", () => {
    // Expectation changes due to alwaysCreateTextNode: true from beforeEach
    const xml = "<thinking>a</thinking><some-tool></some-tool>";
    let streamResult = parser.parseStream(xml);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ thinking: { "#text": "a" } }, { "some-tool": {} }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ thinking: { "#text": "a" } }, { "some-tool": {} }],
    });
  });

  it("should handle Buffer input", () => {
    // Expectation changes due to alwaysCreateTextNode: true from beforeEach
    let streamResult = parser.parseStream(Buffer.from("<data>value</data>"));
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ data: { "#text": "value" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ data: { "#text": "value" } }],
    });
  });

  it("should handle multiple attributes correctly", () => {
    parser = new PartialXMLStreamParser({ attributeNamePrefix: "@" });
    let streamResult = parser.parseStream(
      "<tag attr1=\"val1\" attr2='val2' attr3=val3 />",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ tag: { "@attr1": "val1", "@attr2": "val2", "@attr3": "val3" } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ tag: { "@attr1": "val1", "@attr2": "val2", "@attr3": "val3" } }],
    });
  });

  it("should handle incomplete tags at end of chunk and then completed", () => {
    parser = new PartialXMLStreamParser({
      // Uses new default alwaysCreateTextNode: true
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    parser.parseStream("<root><item");
    let streamResult = parser.parseStream(" attr='1'>Text</item></r");
    expect(streamResult.xml[0].root.item).toEqual({
      "@attr": "1",
      "#text": "Text",
    });
    expect(streamResult.xml[0].root["#text"]).toBe("</r"); // This part becomes text
    expect(streamResult.metadata.partial).toBe(true);

    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    parser.parseStream("<root><item");
    streamResult = parser.parseStream(" attr='1'>Text</item></root>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "@attr": "1", "#text": "Text" } } }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ root: { item: { "@attr": "1", "#text": "Text" } } }],
    });
  });

  it("should handle empty string chunks in midst of stream", () => {
    // Expectation changes due to alwaysCreateTextNode: true from beforeEach
    parser.parseStream("<doc>");
    parser.parseStream("");
    let streamResult = parser.parseStream("<content>Hello</content>");
    expect(streamResult.xml[0].doc.content).toEqual({ "#text": "Hello" });
    expect(streamResult.metadata.partial).toBe(true);

    let finalDocStreamResult = parser.parseStream("</doc>");
    expect(finalDocStreamResult.xml[0].doc.content).toEqual({
      "#text": "Hello",
    });
    expect(finalDocStreamResult.metadata.partial).toBe(false);

    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ doc: { content: { "#text": "Hello" } } }],
    });
  });

  it("should set partial:true when stream ends with an incomplete tag", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream("<root><incompleteTag");
    streamResult = parser.parseStream(null); // End stream
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ root: { "#text": "<incompleteTag" } }], // The fragment is treated as text of parent
    });

    parser.reset();
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    streamResult = parser.parseStream("<root><item>Text</item></incompleteCl");
    streamResult = parser.parseStream(null); // End stream
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ root: { item: { "#text": "Text" }, "#text": "</incompleteCl" } }], // Fragment as text
    });
    
    parser.reset();
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    streamResult = parser.parseStream("<root><item>Text</item><"); // Just '<'
    streamResult = parser.parseStream(null); // End stream
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: [{ root: { item: { "#text": "Text" }, "#text": "<" } }], // Fragment as text
    });

    parser.reset();
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    streamResult = parser.parseStream("<root attr='val");
    streamResult = parser.parseStream(null); // End stream
    expect(streamResult).toEqual({
      metadata: { partial: true },
      // Depending on how strictly attributes are parsed before '>',
      // this might be an empty root or root with partial text.
      // Current behavior treats "<root attr='val" as text if not closed by ">"
      xml: [{ "#text": "<root attr='val" }],
    });
  });

  describe("stopNodes feature", () => {
    it("should treat content of a stopNode as text", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<root><script>let a = 1; console.log(a);</script></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ root: { script: { "#text": "let a = 1; console.log(a);" } } }],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ root: { script: { "#text": "let a = 1; console.log(a);" } } }],
      });
    });

    it("should parse attributes of a stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script"],
        attributeNamePrefix: "@",
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        '<root><script type="text/javascript" src="app.js">let b = 2;</script></root>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: {
              script: {
                "@type": "text/javascript",
                "@src": "app.js",
                "#text": "let b = 2;",
              },
            },
          },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: {
              script: {
                "@type": "text/javascript",
                "@src": "app.js",
                "#text": "let b = 2;",
              },
            },
          },
        ],
      });
    });

    it("should not parse XML tags inside a stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["data"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<root><data><item>one</item><value>100</value></data></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: { data: { "#text": "<item>one</item><value>100</value>" } },
          },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: { data: { "#text": "<item>one</item><value>100</value>" } },
          },
        ],
      });
    });

    it("should handle multiple stopNode types", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script", "style"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<root><script>var c=3;</script><style>.cls{color:red}</style></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: {
              script: { "#text": "var c=3;" },
              style: { "#text": ".cls{color:red}" },
            },
          },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: {
              script: { "#text": "var c=3;" },
              style: { "#text": ".cls{color:red}" },
            },
          },
        ],
      });
    });

    it("should handle self-closing tags within stopNode content", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["htmlData"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        '<doc><htmlData>Some text <br/> and more <img src="test.png"/></htmlData></doc>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            doc: {
              htmlData: {
                "#text": 'Some text <br/> and more <img src="test.png"/>',
              },
            },
          },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            doc: {
              htmlData: {
                "#text": 'Some text <br/> and more <img src="test.png"/>',
              },
            },
          },
        ],
      });
    });

    it("should handle unterminated stopNode at end of stream", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["raw"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<root><raw>This content is not closed",
      );
      expect(streamResult).toEqual({
        metadata: { partial: true },
        xml: [{ root: { raw: { "#text": "This content is not closed" } } }],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: true },
        xml: [{ root: { raw: { "#text": "This content is not closed" } } }],
      });
    });

    it("should correctly handle nested stopNodes of the same name", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["codeblock"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      const xml =
        "<doc><codeblock>Outer <codeblock>Inner</codeblock> Content</codeblock></doc>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            doc: {
              codeblock: {
                "#text": "Outer <codeblock>Inner</codeblock> Content",
              },
            },
          },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            doc: {
              codeblock: {
                "#text": "Outer <codeblock>Inner</codeblock> Content",
              },
            },
          },
        ],
      });
    });

    it("should handle stopNode as the root element", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["rawhtml"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<rawhtml><head></head><body><p>Hello</p></body></rawhtml>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          { rawhtml: { "#text": "<head></head><body><p>Hello</p></body>" } },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          { rawhtml: { "#text": "<head></head><body><p>Hello</p></body>" } },
        ],
      });
    });

    it("should handle empty stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["emptyContent"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<data><emptyContent></emptyContent></data>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ data: { emptyContent: { "#text": "" } } }],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ data: { emptyContent: { "#text": "" } } }],
      });
    });

    it("should handle stopNode with only whitespace content", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["whitespaceNode"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<data><whitespaceNode>   \n\t   </whitespaceNode></data>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ data: { whitespaceNode: { "#text": "   \n\t   " } } }],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ data: { whitespaceNode: { "#text": "   \n\t   " } } }],
      });
    });

    it("should handle stopNode content split across multiple chunks", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["log"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      parser.parseStream("<system><log>Part 1 data ");
      let streamResult = parser.parseStream(
        "Part 2 data <inner>tag</inner> and more",
      );
      expect(streamResult).toEqual({
        metadata: { partial: true },
        xml: [
          {
            system: {
              log: {
                "#text": "Part 1 data Part 2 data <inner>tag</inner> and more",
              },
            },
          },
        ],
      });

      streamResult = parser.parseStream(" final part.</log></system>");
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            system: {
              log: {
                "#text":
                  "Part 1 data Part 2 data <inner>tag</inner> and more final part.",
              },
            },
          },
        ],
      });

      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            system: {
              log: {
                "#text":
                  "Part 1 data Part 2 data <inner>tag</inner> and more final part.",
              },
            },
          },
        ],
      });
    });

    it("should handle stopNode with attributes and content split across chunks", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["customTag"],
        attributeNamePrefix: "@",
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      parser.parseStream('<root><customTag id="123" ');
      parser.parseStream('name="test">This is the ');
      let streamResult = parser.parseStream(
        "content with  wewnętrzny tag <tag/>.</customTag></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: {
              customTag: {
                "@id": "123",
                "@name": "test",
                "#text": "This is the content with  wewnętrzny tag <tag/>.",
              },
            },
          },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: {
              customTag: {
                "@id": "123",
                "@name": "test",
                "#text": "This is the content with  wewnętrzny tag <tag/>.",
              },
            },
          },
        ],
      });
    });

    it("should handle stop node when stopNodes option is a string", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: "script",
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        '<root><script>alert("hello");</script></root>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ root: { script: { "#text": 'alert("hello");' } } }],
      });
    });

    it("should handle path-based stopNode correctly", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["read.file.metadata"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      const xml =
        "<read><metadata><item>one</item></metadata><file><metadata><item>two</item><subitem>three</subitem></metadata><other>data</other></file></read>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            read: {
              metadata: { item: { "#text": "one" } }, // Not a stopNode
              file: {
                metadata: {
                  "#text": "<item>two</item><subitem>three</subitem>",
                }, // Is a stopNode
                other: { "#text": "data" }, // Not a stopNode
              },
            },
          },
        ],
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            read: {
              metadata: { item: { "#text": "one" } },
              file: {
                metadata: {
                  "#text": "<item>two</item><subitem>three</subitem>",
                },
                other: { "#text": "data" },
              },
            },
          },
        ],
      });
    });

    it("should prioritize path-based stopNode over simple name if both could match", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["read.file.metadata", "nomatch.metadata"], // read.file.metadata will match
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      const xml =
        "<read><metadata><item>one</item></metadata><file><metadata><item>two</item></metadata></file></read>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            read: {
              metadata: { item: { "#text": "one" } }, // Not a stopNode
              file: {
                metadata: { "#text": "<item>two</item>" }, // Is a stopNode due to path
              },
            },
          },
        ],
      });
    });

    it("should handle simple stopNode alongside path-based stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script", "app.config.settings.value"],
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      const xml =
        "<app><script>let x=1;</script><config><settings><value>secret</value><other>val</other></settings></config></app>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            app: {
              script: { "#text": "let x=1;" }, // Simple stopNode
              config: {
                settings: {
                  value: { "#text": "secret" }, // Path-based stopNode
                  other: { "#text": "val" }, // Not a stopNode
                },
              },
            },
          },
        ],
      });
    });
  });

  describe("alwaysCreateTextNode option", () => {
    it("should always create #text node when alwaysCreateTextNode is true for non-whitespace text", () => {
      parser = new PartialXMLStreamParser({
        alwaysCreateTextNode: true,
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream("<doc>Text</doc>");
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ doc: { "#text": "Text" } }],
      });
    });

    it("should not simplify text-only elements if alwaysCreateTextNode is true", () => {
      parser = new PartialXMLStreamParser({
        alwaysCreateTextNode: true,
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<parent><child>simple text</child></parent>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [{ parent: { child: { "#text": "simple text" } } }],
      });
    });

    it("should create #text for elements with attributes and text when alwaysCreateTextNode is true", () => {
      parser = new PartialXMLStreamParser({
        alwaysCreateTextNode: true,
        textNodeName: "#text",
        attributeNamePrefix: "@",
      });
      let streamResult = parser.parseStream(
        '<parent><child attr="val">text content</child></parent>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          { parent: { child: { "@attr": "val", "#text": "text content" } } },
        ],
      });
    });

    it("should handle mixed content with alwaysCreateTextNode true, omitting whitespace-only nodes", () => {
      parser = new PartialXMLStreamParser({
        alwaysCreateTextNode: true,
        textNodeName: "#text",
      });
      const xml =
        "<root>text1 <item>itemtext</item> text2 <another/> text3</root>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            root: {
              "#text": "text1  text2  text3",
              item: { "#text": "itemtext" },
              another: {},
            },
          },
        ],
      });
    });
  });

  describe("parsePrimitives option", () => {
    it("should parse numbers and booleans in text nodes if parsePrimitives is true", () => {
      parser = new PartialXMLStreamParser({
        parsePrimitives: true,
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        "<data><num>123</num><bool>true</bool><str>false</str><neg>-45.6</neg><notnum>123a</notnum><strtrue>True</strtrue></data>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            data: {
              num: { "#text": 123 },
              bool: { "#text": true },
              str: { "#text": false },
              neg: { "#text": -45.6 },
              notnum: { "#text": "123a" },
              strtrue: { "#text": true },
            },
          },
        ],
      });
    });

    it("should parse numbers and booleans in attribute values if parsePrimitives is true", () => {
      parser = new PartialXMLStreamParser({
        parsePrimitives: true,
        attributeNamePrefix: "@",
        textNodeName: "#text", // alwaysCreateTextNode is true by default
      });
      let streamResult = parser.parseStream(
        '<data num="456" bool="false" str="true" neg="-0.5" notbool="FALSEY" strbool="True"/>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            data: {
              "@num": 456,
              "@bool": false,
              "@str": true,
              "@neg": -0.5,
              "@notbool": "FALSEY",
              "@strbool": true,
            },
          },
        ],
      });
    });

    it("should not parse primitives if option is false (default behavior)", () => {
      parser = new PartialXMLStreamParser({
        // textNodeName: "#text" is from beforeEach
        attributeNamePrefix: "@",
        // parsePrimitives: false is default in main code
      });
      let streamResult = parser.parseStream(
        '<data num="123" bool="true"><textnum>456</textnum><textbool>false</textbool></data>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: [
          {
            data: {
              "@num": "123",
              "@bool": "true",
              textnum: { "#text": "456" }, // alwaysCreateTextNode: true is default
              textbool: { "#text": "false" }, // alwaysCreateTextNode: true is default
            },
          },
        ],
      });
    });
  });

  it("should handle multiple root elements with text nodes interspersed", () => {
    // Uses parser from beforeEach (alwaysCreateTextNode: true)
    const xml = "text1<tagA>contentA</tagA>text2<tagB/>text3";
    const streamResult = parser.parseStream(xml);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [
        "text1",
        { tagA: { "#text": "contentA" } },
        "text2",
        { tagB: {} },
        "text3",
      ],
    });
  });

  it("should handle a single root text node correctly", () => {
    parser = new PartialXMLStreamParser(); // Uses new default alwaysCreateTextNode: true
    const xml = "Just a root text node";
    const streamResult = parser.parseStream(xml);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Just a root text node"],
    });
  });

  it("should handle input with only text content (no XML tags), including whitespace-only", () => {
    parser = new PartialXMLStreamParser(); // Fresh parser

    // Test with regular text and surrounding whitespace
    let textOnlyInput = "  Some plain text here.  ";
    let streamResult = parser.parseStream(textOnlyInput);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [textOnlyInput],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [textOnlyInput],
    });

    parser.reset(); // Reset for the next sub-test

    // Test with whitespace-only text
    let whitespaceOnlyInput = "   \t  \n  ";
    streamResult = parser.parseStream(whitespaceOnlyInput);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: null,
    });

    parser.reset();

    // Test with empty string input then null
    streamResult = parser.parseStream("");
    expect(streamResult).toEqual({ metadata: { partial: true }, xml: null }); // Empty string is initially partial, no content
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: null }); // Ends as null if only empty string was passed
  });

  it("should handle complex nested structure with attributes and mixed content (alwaysCreateTextNode: true, whitespace omitted)", () => {
    parser = new PartialXMLStreamParser({
      attributeNamePrefix: "@",
      textNodeName: "#text",
      alwaysCreateTextNode: true,
    });
    const xmlData = `
            <root a="nice" checked>
                <a>
                    <b val="1">hello</b>
                    <b val="2" />
                </a>
                <a>
                    <c>world</c>
                </a>
                <b>wow phir se</b>
            </root>
        `;
    let streamResult = parser.parseStream(xmlData);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [
        {
          root: {
            "@a": "nice",
            "@checked": true,
            a: [
              {
                b: [{ "@val": "1", "#text": "hello" }, { "@val": "2" }],
              },
              {
                c: { "#text": "world" },
              },
            ],
            b: { "#text": "wow phir se" },
          },
        },
      ],
    });
  });

  it("should handle complex nested structure with attributes and mixed content - no alwaysCreateTextNode (whitespace omitted)", () => {
    // This test will now behave like alwaysCreateTextNode: true because of the default change
    parser = new PartialXMLStreamParser({
      attributeNamePrefix: "@",
      textNodeName: "#text",
      // alwaysCreateTextNode: false, // To test the old behavior, this would be needed
    });
    const xmlData = `
            <root a="nice" checked>
                <a>
                    <b val="1">hello</b>
                    <b val="2" />
                </a>
                <a>
                    <c>world</c>
                </a>
                <b>wow phir se</b>
            </root>
        `;
    let streamResult = parser.parseStream(xmlData);
    expect(streamResult).toEqual({
      // Expected output now reflects alwaysCreateTextNode: true
      metadata: { partial: false },
      xml: [
        {
          root: {
            "@a": "nice",
            "@checked": true,
            a: [
              {
                b: [{ "@val": "1", "#text": "hello" }, { "@val": "2" }],
              },
              {
                c: { "#text": "world" }, // Changed from "world"
              },
            ],
            b: { "#text": "wow phir se" }, // Changed from "wow phir se"
          },
        },
      ],
    });
  });

  it("should reflect modifications to returned xml object due to direct reference", () => {
    // Uses parser from beforeEach (alwaysCreateTextNode: true)
    let streamResult = parser.parseStream("<root><item>A</item>");
    // Initial state
    expect(streamResult.xml).toEqual([{ root: { item: { "#text": "A" } } }]);
    expect(streamResult.metadata.partial).toBe(true);

    // Modify the returned object (which is now a direct reference)
    if (
      streamResult.xml &&
      streamResult.xml[0] &&
      streamResult.xml[0].root &&
      streamResult.xml[0].root.item
    ) {
      streamResult.xml[0].root.item["#text"] = "B";
    }

    // Continue parsing or finalize
    let finalResult = parser.parseStream("</root>");
    expect(finalResult.xml).toEqual([{ root: { item: { "#text": "B" } } }]); // Expect modification to be reflected
    expect(finalResult.metadata.partial).toBe(false);

    finalResult = parser.parseStream(null); // Signal end of stream
    expect(finalResult.xml).toEqual([{ root: { item: { "#text": "B" } } }]);
    expect(finalResult.metadata.partial).toBe(false);
  });
});
describe("Conditional XML Parsing with allowedRootNodes", () => {
  let parser;

  it("should parse as XML when root node matches allowedRootNodes", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: ["allowedRoot"], textNodeName: "#text" });
    let streamResult = parser.parseStream("<allowedRoot><item>content</item></allowedRoot>");
    expect(streamResult.xml).toEqual([{ allowedRoot: { item: { "#text": "content" } } }]);
    expect(streamResult.metadata.partial).toBe(false); // Assuming complete XML in one chunk
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual([{ allowedRoot: { item: { "#text": "content" } } }]);
    expect(streamResult.metadata.partial).toBe(false);

    parser.reset();
    streamResult = parser.parseStream("<allo");
    expect(streamResult.xml).toEqual([]); // No complete root tag yet, decision pending
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream("wedRoot><item>data</item></allowedRoot>");
    expect(streamResult.xml).toEqual([{ allowedRoot: { item: { "#text": "data" } } }]);
    expect(streamResult.metadata.partial).toBe(false); // Complete XML
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual([{ allowedRoot: { item: { "#text": "data" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should treat as plain text when root node does not match allowedRootNodes", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: ["validRoot"], textNodeName: "#text" });
    let streamResult = parser.parseStream("<notAll");
    expect(streamResult.xml).toEqual(["<notAll"]);
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream("owed><item>text</item></notAllowed>");
    expect(streamResult.xml).toEqual(["<notAllowed><item>text</item></notAllowed>"]);
    expect(streamResult.metadata.partial).toBe(true); // Still partial until null
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual(["<notAllowed><item>text</item></notAllowed>"]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should parse as XML when allowedRootNodes is undefined", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" }); // allowedRootNodes is undefined
    let streamResult = parser.parseStream("<anyRoot><item>content</item></anyRoot>");
    expect(streamResult.xml).toEqual([{ anyRoot: { item: { "#text": "content" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual([{ anyRoot: { item: { "#text": "content" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should parse as XML when allowedRootNodes is an empty array", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: [], textNodeName: "#text" });
    let streamResult = parser.parseStream("<anyRoot><item>content</item></anyRoot>");
    expect(streamResult.xml).toEqual([{ anyRoot: { item: { "#text": "content" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual([{ anyRoot: { item: { "#text": "content" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should parse as XML when allowedRootNodes is a string and matches", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: "allowedRoot", textNodeName: "#text" });
    let streamResult = parser.parseStream("<allowedRoot><item>data</item></allowedRoot>");
    expect(streamResult.xml).toEqual([{ allowedRoot: { item: { "#text": "data" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual([{ allowedRoot: { item: { "#text": "data" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should treat as plain text when allowedRootNodes is a string and does not match", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: "allowedRoot", textNodeName: "#text" });
    let streamResult = parser.parseStream("<otherRoot>data</otherRoot>");
    expect(streamResult.xml).toEqual(["<otherRoot>data</otherRoot>"]);
    expect(streamResult.metadata.partial).toBe(true); // Will be plain text, but partial until null
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual(["<otherRoot>data</otherRoot>"]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should treat non-XML input as plain text when allowedRootNodes is active", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: ["root"], textNodeName: "#text" });
    let streamResult = parser.parseStream("this is plain text");
    expect(streamResult.xml).toEqual(["this is plain text"]);
    // If it's the only chunk before null, it might be partial: false immediately.
    // However, the current logic might keep it partial until null.
    // Let's assume it's partial until null for consistency with other text cases.
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual(["this is plain text"]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should treat as plain text if stream ends before root tag is fully identified", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: ["root"], textNodeName: "#text" });
    let streamResult = parser.parseStream("<roo");
    expect(streamResult.xml).toEqual([]); // Decision pending
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual(["<roo"]); // Treated as plain text at EOS
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should continue as plain text if initial chunks determine non-XML", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: ["root"], textNodeName: "#text" });
    let streamResult = parser.parseStream("  leading text ");
    expect(streamResult.xml).toEqual(["  leading text "]); // Decision: plain text
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream("<notRoot>more</notRoot>");
    expect(streamResult.xml).toEqual(["  leading text <notRoot>more</notRoot>"]);
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual(["  leading text <notRoot>more</notRoot>"]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should handle empty or whitespace-only input correctly with allowedRootNodes", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: ["root"], textNodeName: "#text" });
    let streamResult = parser.parseStream("");
    expect(streamResult.xml).toBeNull(); // Or `xml: []` depending on internal handling
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toBeNull();
    expect(streamResult.metadata.partial).toBe(false);

    parser.reset();
    streamResult = parser.parseStream("   ");
    expect(streamResult.xml).toEqual(["   "]); // Decision: plain text
    expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual(["   "]);
    expect(streamResult.metadata.partial).toBe(false);
  });

  it("should correctly identify root tag even if split across multiple small chunks", () => {
    parser = new PartialXMLStreamParser({ allowedRootNodes: ["veryLongRootElementName"], textNodeName: "#text" });
    let streamResult = parser.parseStream("<very");
    expect(streamResult.xml).toEqual([]); expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream("LongRoo");
    expect(streamResult.xml).toEqual([]); expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream("tElementNa");
    expect(streamResult.xml).toEqual([]); expect(streamResult.metadata.partial).toBe(true);
    streamResult = parser.parseStream("me><item>data</item></veryLongRootElementName>");
    expect(streamResult.xml).toEqual([{ veryLongRootElementName: { item: { "#text": "data" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
    streamResult = parser.parseStream(null);
    expect(streamResult.xml).toEqual([{ veryLongRootElementName: { item: { "#text": "data" } } }]);
    expect(streamResult.metadata.partial).toBe(false);
  });
});
