import { describe, it, expect, beforeEach } from "vitest";
import PartialXMLStreamParser from "./index.js";

describe("PartialXMLStreamParser", () => {
  let parser;

  beforeEach(() => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
  });

  it("should parse a stream chunk by chunk correctly", () => {
    let streamResult;

    streamResult = parser.parseStream("<read>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { read: {} },
    });

    streamResult = parser.parseStream("<args>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { read: { args: {} } },
    });

    streamResult = parser.parseStream("<file><name>as");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { read: { args: { file: { name: { "#text": "as" } } } } },
    });

    streamResult = parser.parseStream("d</name>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { read: { args: { file: { name: "asd" } } } },
    });

    streamResult = parser.parseStream("</file></args>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { read: { args: { file: { name: "asd" } } } },
    });

    streamResult = parser.parseStream("</read>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { read: { args: { file: { name: "asd" } } } },
    });

    streamResult = parser.parseStream(null); // Signal end of stream
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { read: { args: { file: { name: "asd" } } } },
    });
  });

  it("should handle a single incomplete chunk, then completion", () => {
    let streamResult;
    const singleChunk = "<request><id>123</id><data>value<da";
    streamResult = parser.parseStream(singleChunk);
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { request: { id: "123", data: { "#text": "value<da" } } },
    });

    streamResult = parser.parseStream("ta></request>");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { request: { id: "123", data: { "#text": "value", data: {} } } },
    });

    streamResult = parser.parseStream(null); // Signal end
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { request: { id: "123", data: { "#text": "value", data: {} } } },
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
      xml: { root: { item: {}, "#text": "Text after item", another: {} } },
    });

    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: {}, "#text": "Text after item", another: {} } },
    });
  });

  it("should handle XML entities in text nodes", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<doc>Hello & \"World\" 'Test'</doc>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: "Hello & \"World\" 'Test'" },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: "Hello & \"World\" 'Test'" },
    });
  });

  it("should handle XML entities in attribute values", () => {
    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    let streamResult = parser.parseStream('<doc val="<value>" />');
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: { "@val": "<value>" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: { "@val": "<value>" } },
    });
  });

  it("should handle numeric XML entities (decimal and hex)", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<doc>&#60;Hello&#x26;&#32;World&#x3E;</doc>",
    ); // <Hello& World>
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: "<Hello& World>" },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: "<Hello& World>" },
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
      xml: { data: { item: { "@key": "value", "#text": "Test" }, item2: {} } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { data: { item: { "@key": "value", "#text": "Test" }, item2: {} } },
    });
  });

  it("should return null xml for empty stream", () => {
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
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: null });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: null });
  });

  it("should handle custom attributeNamePrefix", () => {
    parser = new PartialXMLStreamParser({ attributeNamePrefix: "_" });
    let streamResult = parser.parseStream('<doc attr="val" />');
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: { _attr: "val" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: { _attr: "val" } },
    });

    parser = new PartialXMLStreamParser({ attributeNamePrefix: "" });
    streamResult = parser.parseStream('<doc attr="val" />');
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: { attr: "val" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: { attr: "val" } },
    });
  });

  it("should parse CDATA sections correctly", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<root><![CDATA[This is <CDATA> text with & special chars]]></root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: "This is <CDATA> text with & special chars" },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: "This is <CDATA> text with & special chars" },
    });
  });

  it("should handle unterminated CDATA section", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream("<root><![CDATA[Unterminated cdata");
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { root: { "#text": "Unterminated cdata" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { root: { "#text": "Unterminated cdata" } },
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
      xml: { root: {} },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: true },
      xml: { root: {} },
    });
  });

  it("should handle unterminated DOCTYPE", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"',
    );
    expect(streamResult).toEqual({ metadata: { partial: true }, xml: null });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: null });
  });

  it("should handle unterminated XML declaration", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream(
      '<?xml version="1.0" encoding="UTF-8"',
    );
    expect(streamResult).toEqual({ metadata: { partial: true }, xml: null });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({ metadata: { partial: false }, xml: null });
  });

  it("should leniently handle mismatched closing tags", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<root><item>text</mismatched></item></root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: "text" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: "text" } },
    });
  });

  it("should handle attributes without explicit values (boolean attributes) as true", () => {
    parser = new PartialXMLStreamParser({ attributeNamePrefix: "@" });
    let streamResult = parser.parseStream(
      '<input disabled checked="checked" required />',
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: {
        input: { "@disabled": true, "@checked": "checked", "@required": true },
      },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: {
        input: { "@disabled": true, "@checked": "checked", "@required": true },
      },
    });
  });

  it("should correctly simplify text-only elements", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<parent><child>simple text</child></parent>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { parent: { child: "simple text" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { parent: { child: "simple text" } },
    });
  });

  it("should not simplify elements with attributes even if they also have text", () => {
    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    let streamResult = parser.parseStream(
      '<parent><child attr="val">text content</child></parent>',
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { parent: { child: { "@attr": "val", "#text": "text content" } } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { parent: { child: { "@attr": "val", "#text": "text content" } } },
    });
  });

  it("should not simplify elements with child elements", () => {
    parser = new PartialXMLStreamParser();
    let streamResult = parser.parseStream(
      "<parent><child><grandchild/></child></parent>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { parent: { child: { grandchild: {} } } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { parent: { child: { grandchild: {} } } },
    });
  });

  it("should ignore text nodes containing only whitespace by default", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(
      "<root>  <item>text</item>   </root>",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: "text" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: "text" } },
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
      xml: { root: { item: { "#text": "text" } } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: { "#text": "text" } } },
    });
  });

  it("should handle text at root level before any tags", () => {
    parser = new PartialXMLStreamParser();
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
    parser = new PartialXMLStreamParser();
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
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream("<rootA/><rootB>text</rootB>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ rootA: {} }, { rootB: "text" }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ rootA: {} }, { rootB: "text" }],
    });
  });

  it("should handle multiple root elements in specific order", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    const xml = "<thinking>a</thinking><some-tool></some-tool>";
    let streamResult = parser.parseStream(xml);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ thinking: "a" }, { "some-tool": {} }],
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: [{ thinking: "a" }, { "some-tool": {} }],
    });
  });

  it("should handle Buffer input", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    let streamResult = parser.parseStream(Buffer.from("<data>value</data>"));
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { data: "value" },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { data: "value" },
    });
  });

  it("should handle multiple attributes correctly", () => {
    parser = new PartialXMLStreamParser({ attributeNamePrefix: "@" });
    let streamResult = parser.parseStream(
      "<tag attr1=\"val1\" attr2='val2' attr3=val3 />",
    );
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { tag: { "@attr1": "val1", "@attr2": "val2", "@attr3": "val3" } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { tag: { "@attr1": "val1", "@attr2": "val2", "@attr3": "val3" } },
    });
  });

  it("should handle incomplete tags at end of chunk and then completed", () => {
    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    parser.parseStream("<root><item");
    let streamResult = parser.parseStream(" attr='1'>Text</item></r");
    expect(streamResult.xml.root.item).toEqual({
      "@attr": "1",
      "#text": "Text",
    });
    expect(streamResult.xml.root["#text"]).toBe("</r");
    expect(streamResult.metadata.partial).toBe(true);

    parser = new PartialXMLStreamParser({
      textNodeName: "#text",
      attributeNamePrefix: "@",
    });
    parser.parseStream("<root><item");
    streamResult = parser.parseStream(" attr='1'>Text</item></root>");
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: { "@attr": "1", "#text": "Text" } } },
    });
    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { root: { item: { "@attr": "1", "#text": "Text" } } },
    });
  });

  it("should handle empty string chunks in midst of stream", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    parser.parseStream("<doc>");
    parser.parseStream("");
    let streamResult = parser.parseStream("<content>Hello</content>");
    expect(streamResult.xml.doc.content).toEqual("Hello");
    expect(streamResult.metadata.partial).toBe(true);

    let finalDocStreamResult = parser.parseStream("</doc>");
    expect(finalDocStreamResult.xml.doc.content).toEqual("Hello");
    expect(finalDocStreamResult.metadata.partial).toBe(false);

    streamResult = parser.parseStream(null);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: { doc: { content: "Hello" } },
    });
  });

  describe("stopNodes feature", () => {
    it("should treat content of a stopNode as text", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<root><script>let a = 1; console.log(a);</script></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { root: { script: { "#text": "let a = 1; console.log(a);" } } },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { root: { script: { "#text": "let a = 1; console.log(a);" } } },
      });
    });

    it("should parse attributes of a stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script"],
        attributeNamePrefix: "@",
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        '<root><script type="text/javascript" src="app.js">let b = 2;</script></root>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: {
            script: {
              "@type": "text/javascript",
              "@src": "app.js",
              "#text": "let b = 2;",
            },
          },
        },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: {
            script: {
              "@type": "text/javascript",
              "@src": "app.js",
              "#text": "let b = 2;",
            },
          },
        },
      });
    });

    it("should not parse XML tags inside a stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["data"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<root><data><item>one</item><value>100</value></data></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: { data: { "#text": "<item>one</item><value>100</value>" } },
        },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: { data: { "#text": "<item>one</item><value>100</value>" } },
        },
      });
    });

    it("should handle multiple stopNode types", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script", "style"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<root><script>var c=3;</script><style>.cls{color:red}</style></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: {
            script: { "#text": "var c=3;" },
            style: { "#text": ".cls{color:red}" },
          },
        },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: {
            script: { "#text": "var c=3;" },
            style: { "#text": ".cls{color:red}" },
          },
        },
      });
    });

    it("should handle self-closing tags within stopNode content", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["htmlData"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        '<doc><htmlData>Some text <br/> and more <img src="test.png"/></htmlData></doc>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          doc: {
            htmlData: {
              "#text": 'Some text <br/> and more <img src="test.png"/>',
            },
          },
        },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          doc: {
            htmlData: {
              "#text": 'Some text <br/> and more <img src="test.png"/>',
            },
          },
        },
      });
    });

    it("should handle unterminated stopNode at end of stream", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["raw"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<root><raw>This content is not closed",
      );
      expect(streamResult).toEqual({
        metadata: { partial: true },
        xml: { root: { raw: { "#text": "This content is not closed" } } },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: true },
        xml: { root: { raw: { "#text": "This content is not closed" } } },
      });
    });

    it("should correctly handle nested stopNodes of the same name", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["codeblock"],
        textNodeName: "#text",
      });
      const xml =
        "<doc><codeblock>Outer <codeblock>Inner</codeblock> Content</codeblock></doc>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          doc: {
            codeblock: {
              "#text": "Outer <codeblock>Inner</codeblock> Content",
            },
          },
        },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          doc: {
            codeblock: {
              "#text": "Outer <codeblock>Inner</codeblock> Content",
            },
          },
        },
      });
    });

    it("should handle stopNode as the root element", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["rawhtml"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<rawhtml><head></head><body><p>Hello</p></body></rawhtml>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { rawhtml: { "#text": "<head></head><body><p>Hello</p></body>" } },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { rawhtml: { "#text": "<head></head><body><p>Hello</p></body>" } },
      });
    });

    it("should handle empty stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["emptyContent"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<data><emptyContent></emptyContent></data>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { data: { emptyContent: { "#text": "" } } },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { data: { emptyContent: { "#text": "" } } },
      });
    });

    it("should handle stopNode with only whitespace content", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["whitespaceNode"],
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<data><whitespaceNode>   \n\t   </whitespaceNode></data>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { data: { whitespaceNode: { "#text": "   \n\t   " } } },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { data: { whitespaceNode: { "#text": "   \n\t   " } } },
      });
    });

    it("should handle stopNode content split across multiple chunks", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["log"],
        textNodeName: "#text",
      });
      parser.parseStream("<system><log>Part 1 data ");
      let streamResult = parser.parseStream(
        "Part 2 data <inner>tag</inner> and more",
      );
      expect(streamResult).toEqual({
        metadata: { partial: true },
        xml: {
          system: {
            log: {
              "#text": "Part 1 data Part 2 data <inner>tag</inner> and more",
            },
          },
        },
      });

      streamResult = parser.parseStream(" final part.</log></system>");
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          system: {
            log: {
              "#text":
                "Part 1 data Part 2 data <inner>tag</inner> and more final part.",
            },
          },
        },
      });

      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          system: {
            log: {
              "#text":
                "Part 1 data Part 2 data <inner>tag</inner> and more final part.",
            },
          },
        },
      });
    });

    it("should handle stopNode with attributes and content split across chunks", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["customTag"],
        attributeNamePrefix: "@",
        textNodeName: "#text",
      });
      parser.parseStream('<root><customTag id="123" ');
      parser.parseStream('name="test">This is the ');
      let streamResult = parser.parseStream(
        "content with  wewnętrzny tag <tag/>.</customTag></root>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: {
            customTag: {
              "@id": "123",
              "@name": "test",
              "#text": "This is the content with  wewnętrzny tag <tag/>.",
            },
          },
        },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          root: {
            customTag: {
              "@id": "123",
              "@name": "test",
              "#text": "This is the content with  wewnętrzny tag <tag/>.",
            },
          },
        },
      });
    });

    it("should handle stop node when stopNodes option is a string", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: "script",
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        '<root><script>alert("hello");</script></root>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: { root: { script: { "#text": 'alert("hello");' } } },
      });
    });

    it("should handle path-based stopNode correctly", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["read.file.metadata"],
        textNodeName: "#text",
      });
      const xml =
        "<read><metadata><item>one</item></metadata><file><metadata><item>two</item><subitem>three</subitem></metadata><other>data</other></file></read>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          read: {
            metadata: { item: "one" },
            file: {
              metadata: { "#text": "<item>two</item><subitem>three</subitem>" },
              other: "data",
            },
          },
        },
      });
      streamResult = parser.parseStream(null);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          read: {
            metadata: { item: "one" },
            file: {
              metadata: { "#text": "<item>two</item><subitem>three</subitem>" },
              other: "data",
            },
          },
        },
      });
    });

    it("should prioritize path-based stopNode over simple name if both could match", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["read.file.metadata", "nomatch.metadata"],
        textNodeName: "#text",
      });
      const xml =
        "<read><metadata><item>one</item></metadata><file><metadata><item>two</item></metadata></file></read>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          read: {
            metadata: { item: "one" },
            file: {
              metadata: { "#text": "<item>two</item>" },
            },
          },
        },
      });
    });

    it("should handle simple stopNode alongside path-based stopNode", () => {
      parser = new PartialXMLStreamParser({
        stopNodes: ["script", "app.config.settings.value"],
        textNodeName: "#text",
      });
      const xml =
        "<app><script>let x=1;</script><config><settings><value>secret</value><other>val</other></settings></config></app>";
      let streamResult = parser.parseStream(xml);
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          app: {
            script: { "#text": "let x=1;" },
            config: {
              settings: {
                value: { "#text": "secret" },
                other: "val",
              },
            },
          },
        },
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
        xml: { doc: { "#text": "Text" } },
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
        xml: { parent: { child: { "#text": "simple text" } } },
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
        xml: { parent: { child: { "@attr": "val", "#text": "text content" } } },
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
        xml: {
          root: {
            "#text": ["text1 ", " text2 ", " text3"],
            item: { "#text": "itemtext" },
            another: {},
          },
        },
      });
    });
  });

  describe("parsePrimitives option", () => {
    it("should parse numbers and booleans in text nodes if parsePrimitives is true", () => {
      parser = new PartialXMLStreamParser({
        parsePrimitives: true,
        textNodeName: "#text",
      });
      let streamResult = parser.parseStream(
        "<data><num>123</num><bool>true</bool><str>false</str><neg>-45.6</neg><notnum>123a</notnum><strtrue>True</strtrue></data>",
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          data: {
            num: 123,
            bool: true,
            str: false,
            neg: -45.6,
            notnum: "123a",
            strtrue: true,
          },
        },
      });
    });

    it("should parse numbers and booleans in attribute values if parsePrimitives is true", () => {
      parser = new PartialXMLStreamParser({
        parsePrimitives: true,
        attributeNamePrefix: "@",
      });
      let streamResult = parser.parseStream(
        '<data num="456" bool="false" str="true" neg="-0.5" notbool="FALSEY" strbool="True"/>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          data: {
            "@num": 456,
            "@bool": false,
            "@str": true,
            "@neg": -0.5,
            "@notbool": "FALSEY",
            "@strbool": true,
          },
        },
      });
    });

    it("should not parse primitives if option is false (default)", () => {
      parser = new PartialXMLStreamParser({
        textNodeName: "#text",
        attributeNamePrefix: "@",
      });
      let streamResult = parser.parseStream(
        '<data num="123" bool="true"><textnum>456</textnum><textbool>false</textbool></data>',
      );
      expect(streamResult).toEqual({
        metadata: { partial: false },
        xml: {
          data: {
            "@num": "123",
            "@bool": "true",
            textnum: "456",
            textbool: "false",
          },
        },
      });
    });
  });

  it("should handle multiple root elements with text nodes interspersed", () => {
    parser = new PartialXMLStreamParser({ textNodeName: "#text" });
    const xml = "text1<tagA>contentA</tagA>text2<tagB/>text3";
    const streamResult = parser.parseStream(xml);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["text1", { tagA: "contentA" }, "text2", { tagB: {} }, "text3"],
    });
  });

  it("should handle a single root text node correctly", () => {
    parser = new PartialXMLStreamParser();
    const xml = "Just a root text node";
    const streamResult = parser.parseStream(xml);
    expect(streamResult).toEqual({
      metadata: { partial: false },
      xml: ["Just a root text node"],
    });
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
      xml: {
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
    });
  });
  it("should handle complex nested structure with attributes and mixed content - no alwaysCreateTextNode (whitespace omitted)", () => {
    parser = new PartialXMLStreamParser({
      attributeNamePrefix: "@",
      textNodeName: "#text",
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
      xml: {
        root: {
          "@a": "nice",
          "@checked": true,
          a: [
            {
              b: [{ "@val": "1", "#text": "hello" }, { "@val": "2" }],
            },
            {
              c: "world",
            },
          ],
          b: "wow phir se",
        },
      },
    });
  });
});
