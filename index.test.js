import { describe, it, expect, beforeEach } from 'vitest';
import PartialXMLStreamParser from './index.js';

describe('PartialXMLStreamParser', () => {
    let parser;

    beforeEach(() => {
        parser = new PartialXMLStreamParser({ textNodeName: "#text" });
        parser.streamingBuffer = "";
        parser._activelyStreaming = false;
    });

    it('should parse a stream chunk by chunk correctly', () => {
        let streamResult;

        streamResult = parser.parseStream("<read>");
        expect(streamResult).toEqual({ "read": {}, "_partial": true });

        streamResult = parser.parseStream("<args>");
        expect(streamResult).toEqual({ "read": { "args": {} }, "_partial": true });

        streamResult = parser.parseStream("<file><name>as");
        expect(streamResult).toEqual({ "read": { "args": { "file": { "name": { "#text": "as" } } } }, "_partial": true });

        streamResult = parser.parseStream("d</name>");
        expect(streamResult).toEqual({ "read": { "args": { "file": { "name": "asd" } } }, "_partial": true });

        streamResult = parser.parseStream("</file></args>");
        expect(streamResult).toEqual({ "read": { "args": { "file": { "name": "asd" } } }, "_partial": true });

        streamResult = parser.parseStream("</read>");
        expect(streamResult).toEqual({ "read": { "args": { "file": { "name": "asd" } } }, "_partial": false });

        streamResult = parser.parseStream(null); // Signal end of stream
        expect(streamResult).toEqual({ "read": { "args": { "file": { "name": "asd" } } }, "_partial": false });
        expect(parser.streamingBuffer).toBe("");
    });

    it('should handle a single incomplete chunk, then completion', () => {
        let streamResult;
        const singleChunk = "<request><id>123</id><data>value<da";
        streamResult = parser.parseStream(singleChunk);
        expect(streamResult).toEqual({ "request": { "id": "123", "data": { "#text": "value<da" } }, "_partial": true });

        streamResult = parser.parseStream("ta></request>");
        expect(streamResult).toEqual({ "request": { "id": "123", "data": { "#text": "value", "data": {} } }, "_partial": true });

        streamResult = parser.parseStream(null); // Signal end
        expect(streamResult).toEqual({ "request": { "id": "123", "data": { "#text": "value", "data": {} } }, "_partial": true });
        // When _partial is true at EOF, buffer is not cleared.
        // expect(parser.streamingBuffer).toBe("<request><id>123</id><data>value<data></request>"); // Or check it's not empty
    });

    it('should handle a text-only stream', () => {
        let streamResult;
        streamResult = parser.parseStream("Just some text");
        expect(streamResult).toEqual({ "#text": "Just some text", "_partial": false });

        streamResult = parser.parseStream(null); // End stream
        expect(streamResult).toEqual({ "#text": "Just some text", "_partial": false });
        expect(parser.streamingBuffer).toBe("");
    });

    it('should handle self-closing tags and mixed content', () => {
        let streamResult;
        streamResult = parser.parseStream("<root><item/>Text after item<another/></root>");
        expect(streamResult).toEqual({ "root": { "item": {}, "#text": "Text after item", "another": {} }, "_partial": false });

        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ "root": { "item": {}, "#text": "Text after item", "another": {} }, "_partial": false });
        expect(parser.streamingBuffer).toBe("");
    });

    it('should handle XML entities in text nodes', () => {
        parser.streamingBuffer = "";
        parser._activelyStreaming = false;
        let streamResult = parser.parseStream('<doc>Hello &amp; "World" &apos;Test&apos;</doc>');
        expect(streamResult).toEqual({ "doc": "Hello & \"World\" 'Test'", "_partial": false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ "doc": "Hello & \"World\" 'Test'", "_partial": false });
    });

    it('should handle XML entities in attribute values', () => {
        parser.streamingBuffer = "";
        parser._activelyStreaming = false;
        let streamResult = parser.parseStream('<doc val="&lt;value&gt;" />');
        expect(streamResult).toEqual({ "doc": { "@val": "<value>" }, "_partial": false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ "doc": { "@val": "<value>" }, "_partial": false });
    });

    it('should handle numeric XML entities (decimal and hex)', () => {
        parser.streamingBuffer = "";
        parser._activelyStreaming = false;
        let streamResult = parser.parseStream('<doc>&#60;Hello&#x26;&#32;World&#x3E;</doc>'); // <Hello& World>
        expect(streamResult).toEqual({ "doc": "<Hello& World>", "_partial": false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ "doc": "<Hello& World>", "_partial": false });
    });

    it('should correctly parse multiple chunks that form a complete XML', () => {
        parser.streamingBuffer = "";
        parser._activelyStreaming = false;
        parser.parseStream('<data><item');
        parser.parseStream(' key="value">Te');
        parser.parseStream('st</item><item2');
        let streamResult = parser.parseStream('/></data>');
        expect(streamResult).toEqual({ data: { item: { '@key': 'value', '#text': 'Test' }, item2: {} }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ data: { item: { '@key': 'value', '#text': 'Test' }, item2: {} }, _partial: false });
    });

    it('should return empty object for empty stream', () => {
        parser.streamingBuffer = "";
        parser._activelyStreaming = false;
        let streamResult = parser.parseStream('');
        expect(streamResult).toEqual({ _partial: true, _status: 'Waiting for data or empty stream' });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ _partial: false });
        expect(parser.streamingBuffer).toBe("");
    });

    it('should handle stream with only XML declaration and comments', () => {
        parser.streamingBuffer = "";
        parser._activelyStreaming = false;
        let streamResult = parser.parseStream('<?xml version="1.0"?><!-- comment -->');
        expect(streamResult).toEqual({ _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ _partial: false });
        expect(parser.streamingBuffer).toBe("");
    });

    // New tests start here

    it('should handle custom attributeNamePrefix', () => {
        parser = new PartialXMLStreamParser({ attributeNamePrefix: "_" });
        let streamResult = parser.parseStream('<doc attr="val" />');
        expect(streamResult).toEqual({ doc: { _attr: "val" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ doc: { _attr: "val" }, _partial: false });

        parser = new PartialXMLStreamParser({ attributeNamePrefix: "" });
        streamResult = parser.parseStream('<doc attr="val" />');
        expect(streamResult).toEqual({ doc: { attr: "val" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ doc: { attr: "val" }, _partial: false });
    });

    it('should parse CDATA sections correctly', () => {
        let streamResult = parser.parseStream('<root><![CDATA[This is <CDATA> text with & special chars]]></root>');
        expect(streamResult).toEqual({ root: "This is <CDATA> text with & special chars", _partial: false }); // Simplified due to textOnly
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ root: "This is <CDATA> text with & special chars", _partial: false });
    });

    it('should handle unterminated CDATA section', () => {
        let streamResult = parser.parseStream('<root><![CDATA[Unterminated cdata');
        // The rest of the chunk becomes the CDATA content
        expect(streamResult).toEqual({ root: { "#text": "Unterminated cdata" }, _partial: true });
        streamResult = parser.parseStream(null); // End stream
        // Since it was unterminated, and root tag is still open, it's partial.
        expect(streamResult).toEqual({ root: { "#text": "Unterminated cdata" }, _partial: true });
    });

    it('should ignore CDATA at root level if it is the only content', () => {
        let streamResult = parser.parseStream('<![CDATA[Root CDATA]]>');
        expect(streamResult).toEqual({ _partial: false }); // Should be an empty object as root CDATA is not directly mapped to result
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ _partial: false }); // Should be an empty object as root CDATA is not directly mapped to result
    });


    it('should handle unterminated comments', () => {
        let streamResult = parser.parseStream('<root><!-- This is an unterminated comment');
        // Parser skips to end of chunk for unterminated comment
        expect(streamResult).toEqual({ root: {}, _partial: true });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ root: {}, _partial: true }); // root is still open
    });

    it('should handle unterminated DOCTYPE', () => {
        let streamResult = parser.parseStream('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"');
        expect(streamResult).toEqual({ _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ _partial: false });
    });

    it('should handle unterminated XML declaration', () => {
        let streamResult = parser.parseStream('<?xml version="1.0" encoding="UTF-8"');
        expect(streamResult).toEqual({ _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ _partial: false });
    });

    it('should leniently handle mismatched closing tags', () => {
        let streamResult = parser.parseStream('<root><item>text</mismatched></item></root>');
        // </mismatched> is ignored. </item> closes item. </root> closes root.
        // All tags are closed within this chunk.
        expect(streamResult).toEqual({ root: { item: "text" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ root: { item: "text" }, _partial: false });
    });

    it('should handle attributes without explicit values (boolean attributes) as true', () => {
        let streamResult = parser.parseStream('<input disabled checked="checked" required />');
        expect(streamResult).toEqual({ input: { "@disabled": true, "@checked": "checked", "@required": true }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ input: { "@disabled": true, "@checked": "checked", "@required": true }, _partial: false });
    });

    it('should correctly simplify text-only elements', () => {
        let streamResult = parser.parseStream('<parent><child>simple text</child></parent>');
        expect(streamResult).toEqual({ parent: { child: "simple text" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ parent: { child: "simple text" }, _partial: false });
    });

    it('should not simplify elements with attributes even if they also have text', () => {
        let streamResult = parser.parseStream('<parent><child attr="val">text content</child></parent>');
        expect(streamResult).toEqual({ parent: { child: { "@attr": "val", "#text": "text content" } }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ parent: { child: { "@attr": "val", "#text": "text content" } }, _partial: false });
    });

    it('should not simplify elements with child elements', () => {
        let streamResult = parser.parseStream('<parent><child><grandchild/></child></parent>');
        expect(streamResult).toEqual({ parent: { child: { grandchild: {} } }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ parent: { child: { grandchild: {} } }, _partial: false });
    });

    it('should ignore text nodes containing only whitespace', () => {
        let streamResult = parser.parseStream('<root>  <item>text</item>   </root>');
        // Whitespace between tags is ignored if it doesn't form part of a mixed content node with non-whitespace.
        // The text "  " before <item> and "   " after </item> should be ignored.
        expect(streamResult).toEqual({ root: { item: "text" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ root: { item: "text" }, _partial: false });
    });

    it('should handle text at root level before any tags', () => {
        let streamResult = parser.parseStream('Leading text<root/>');
        // Current logic (lines 213-216) adds root text if root object is empty.
        // However, _parseChunkToPartialObject processes tags first.
        // If "Leading text " is encountered, then <root/>, the text might be associated with root if stack is empty.
        // Let's trace: "Leading text " -> i advances. Then <root/> is parsed.
        // The text "Leading text" is processed. tagStack is empty. root is {}.
        // addValueToObject(root, "#text", "Leading text") happens. root = {"#text": "Leading text"}
        // Then <root/> is processed. addValueToObject(root, "root", {}).
        // root = {"#text": "Leading text", "root": {}}
        expect(streamResult).toEqual({ "#text": "Leading text", root: {}, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ "#text": "Leading text", root: {}, _partial: false });
    });

    it('should ignore text at root level after all tags are closed', () => {
        let streamResult = parser.parseStream('<root/>Trailing text');
        // <root/> is parsed. root = {root: {}}. tagStack is empty.
        // "Trailing text" is encountered. tagStack is empty. root is NOT empty.
        // So, this text is ignored (line 217).
        expect(streamResult).toEqual({ root: {}, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ root: {}, _partial: false });
    });

    it('should handle Buffer input', () => {
        let streamResult = parser.parseStream(Buffer.from('<data>value</data>'));
        expect(streamResult).toEqual({ data: "value", _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ data: "value", _partial: false });
    });

    it('should handle multiple attributes correctly', () => {
        let streamResult = parser.parseStream('<tag attr1="val1" attr2=\'val2\' attr3=val3 />');
        expect(streamResult).toEqual({ tag: { "@attr1": "val1", "@attr2": "val2", "@attr3": "val3" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ tag: { "@attr1": "val1", "@attr2": "val2", "@attr3": "val3" }, _partial: false });
    });

    it('should handle incomplete tags at end of chunk and then completed', () => {
        parser.parseStream("<root><item"); // Incomplete opening tag
        let streamResult = parser.parseStream(" attr='1'>Text</item></r"); // Complete item, root gets text </r
        expect(streamResult.root.item).toEqual({ "@attr": "1", "#text": "Text" });
        expect(streamResult.root["#text"]).toBe("</r");
        expect(streamResult._partial).toBe(true); // root is still open

        parser = new PartialXMLStreamParser({ textNodeName: "#text" }); // Reset
        parser.parseStream("<root><item");
        streamResult = parser.parseStream(" attr='1'>Text</item></root>");
        expect(streamResult).toEqual({ root: { item: { "@attr": "1", "#text": "Text" } }, _partial: false }); // All closed
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ root: { item: { "@attr": "1", "#text": "Text" } }, _partial: false });
    });

    it('should handle empty string chunks in midst of stream', () => {
        parser.parseStream("<doc>");
        parser.parseStream(""); // Empty chunk
        let streamResult = parser.parseStream("<content>Hello</content>");
        expect(streamResult.doc.content).toEqual("Hello");
        expect(streamResult._partial).toBe(true); // <doc> is still open

        let finalDocStreamResult = parser.parseStream("</doc>"); // Close doc
        expect(finalDocStreamResult.doc.content).toEqual("Hello");
        expect(finalDocStreamResult._partial).toBe(false); // <doc> is now closed

        streamResult = parser.parseStream(null); // EOF
        expect(streamResult).toEqual({ doc: { content: "Hello" }, _partial: false });
    });

    describe('stopNodes feature', () => {
        it('should treat content of a stopNode as text', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['script'] });
            let streamResult = parser.parseStream('<root><script>let a = 1; console.log(a);</script></root>');
            expect(streamResult).toEqual({ root: { script: { "#text": "let a = 1; console.log(a);" } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ root: { script: { "#text": "let a = 1; console.log(a);" } }, _partial: false });
        });

        it('should parse attributes of a stopNode', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['script'], attributeNamePrefix: "@" });
            let streamResult = parser.parseStream('<root><script type="text/javascript" src="app.js">let b = 2;</script></root>');
            expect(streamResult).toEqual({ root: { script: { "@type": "text/javascript", "@src": "app.js", "#text": "let b = 2;" } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ root: { script: { "@type": "text/javascript", "@src": "app.js", "#text": "let b = 2;" } }, _partial: false });
        });

        it('should not parse XML tags inside a stopNode', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['data'] });
            let streamResult = parser.parseStream('<root><data><item>one</item><value>100</value></data></root>');
            expect(streamResult).toEqual({ root: { data: { "#text": "<item>one</item><value>100</value>" } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ root: { data: { "#text": "<item>one</item><value>100</value>" } }, _partial: false });
        });

        it('should handle multiple stopNode types', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['script', 'style'] });
            let streamResult = parser.parseStream('<root><script>var c=3;</script><style>.cls{color:red}</style></root>');
            expect(streamResult).toEqual({ root: { script: { "#text": "var c=3;" }, style: { "#text": ".cls{color:red}" } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ root: { script: { "#text": "var c=3;" }, style: { "#text": ".cls{color:red}" } }, _partial: false });
        });

        it('should handle self-closing tags within stopNode content', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['htmlData'] });
            let streamResult = parser.parseStream('<doc><htmlData>Some text <br/> and more <img src="test.png"/></htmlData></doc>');
            expect(streamResult).toEqual({ doc: { htmlData: { "#text": "Some text <br/> and more <img src=\"test.png\"/>" } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ doc: { htmlData: { "#text": "Some text <br/> and more <img src=\"test.png\"/>" } }, _partial: false });
        });

        it('should handle unterminated stopNode at end of stream', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['raw'] });
            let streamResult = parser.parseStream('<root><raw>This content is not closed');
            expect(streamResult).toEqual({ root: { raw: { "#text": "This content is not closed" } }, _partial: true }); // root is open
            streamResult = parser.parseStream(null); // EOF
            // raw node itself is considered complete with the text it has, but root is still open.
            expect(streamResult).toEqual({ root: { raw: { "#text": "This content is not closed" } }, _partial: true });
        });

        it('should correctly handle nested stopNodes of the same name', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['codeblock'] });
            const xml = '<doc><codeblock>Outer <codeblock>Inner</codeblock> Content</codeblock></doc>';
            let streamResult = parser.parseStream(xml);
            expect(streamResult).toEqual({ doc: { codeblock: { "#text": "Outer <codeblock>Inner</codeblock> Content" } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ doc: { codeblock: { "#text": "Outer <codeblock>Inner</codeblock> Content" } }, _partial: false });
        });

        it('should handle stopNode as the root element', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['rawhtml'] });
            let streamResult = parser.parseStream('<rawhtml><head></head><body><p>Hello</p></body></rawhtml>');
            expect(streamResult).toEqual({ rawhtml: { "#text": "<head></head><body><p>Hello</p></body>" }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ rawhtml: { "#text": "<head></head><body><p>Hello</p></body>" }, _partial: false });
        });

        it('should handle empty stopNode', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['emptyContent'] });
            let streamResult = parser.parseStream('<data><emptyContent></emptyContent></data>');
            // Empty text node might be omitted or present depending on exact logic for empty content.
            // Current implementation will add an empty #text if the content is empty.
            expect(streamResult).toEqual({ data: { emptyContent: { "#text": "" } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ data: { emptyContent: { "#text": "" } }, _partial: false });
        });

        it('should handle stopNode with only whitespace content', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['whitespaceNode'] });
            let streamResult = parser.parseStream('<data><whitespaceNode>   \n\t   </whitespaceNode></data>');
            expect(streamResult).toEqual({ data: { whitespaceNode: { "#text": "   \n\t   " } }, _partial: false });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ data: { whitespaceNode: { "#text": "   \n\t   " } }, _partial: false });
        });

        it('should handle stopNode content split across multiple chunks', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['log'] });
            parser.parseStream('<system><log>Part 1 data ');
            let streamResult = parser.parseStream('Part 2 data <inner>tag</inner> and more');
            expect(streamResult).toEqual({ system: { log: { "#text": "Part 1 data Part 2 data <inner>tag</inner> and more" } }, _partial: true }); // log is still open as no closing tag yet

            streamResult = parser.parseStream(' final part.</log></system>');
            expect(streamResult).toEqual({ system: { log: { "#text": "Part 1 data Part 2 data <inner>tag</inner> and more final part." } }, _partial: false });

            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({ system: { log: { "#text": "Part 1 data Part 2 data <inner>tag</inner> and more final part." } }, _partial: false });
        });

        it('should handle stopNode with attributes and content split across chunks', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['customTag'], attributeNamePrefix: '@' });
            parser.parseStream('<root><customTag id="123" ');
            parser.parseStream('name="test">This is the ');
            let streamResult = parser.parseStream('content with  wewnętrzny tag <tag/>.</customTag></root>');
            expect(streamResult).toEqual({
                root: {
                    customTag: {
                        '@id': '123',
                        '@name': 'test',
                        '#text': 'This is the content with  wewnętrzny tag <tag/>.'
                    }
                },
                _partial: false
            });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({
                root: {
                    customTag: {
                        '@id': '123',
                        '@name': 'test',
                        '#text': 'This is the content with  wewnętrzny tag <tag/>.'
                    }
                },
                _partial: false
            });
        });

        it('should handle stop node when stopNodes option is a string', () => {
            parser = new PartialXMLStreamParser({ stopNodes: 'script' }); // Test with string instead of array
            let streamResult = parser.parseStream('<root><script>alert("hello");</script></root>');
            expect(streamResult).toEqual({ root: { script: { "#text": "alert(\"hello\");" } }, _partial: false });
        });

        it('should handle path-based stopNode correctly', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['read.file.metadata'] });
            const xml = "<read><metadata><item>one</item></metadata><file><metadata><item>two</item><subitem>three</subitem></metadata><other>data</other></file></read>";
            let streamResult = parser.parseStream(xml);
            expect(streamResult).toEqual({
                read: {
                    metadata: { item: "one" }, // This metadata should be parsed
                    file: {
                        metadata: { "#text": "<item>two</item><subitem>three</subitem>" }, // This should be a stop node
                        other: "data"
                    }
                },
                _partial: false
            });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({
                read: {
                    metadata: { item: "one" },
                    file: {
                        metadata: { "#text": "<item>two</item><subitem>three</subitem>" },
                        other: "data"
                    }
                },
                _partial: false
            });
        });

        it('should prioritize path-based stopNode over simple name if both could match', () => {
            // If 'metadata' is simple stop, but 'read.file.metadata' is also path stop, path should be checked.
            // Current logic checks simple first, then path. For this test, we assume 'metadata' is NOT a simple stop.
            parser = new PartialXMLStreamParser({ stopNodes: ['read.file.metadata', 'nomatch.metadata'] });
            const xml = "<read><metadata><item>one</item></metadata><file><metadata><item>two</item></metadata></file></read>";
            let streamResult = parser.parseStream(xml);
            expect(streamResult).toEqual({
                read: {
                    metadata: { item: "one" },
                    file: {
                        metadata: { "#text": "<item>two</item>" }
                    }
                },
                _partial: false
            });
        });

        it('should handle simple stopNode alongside path-based stopNode', () => {
            parser = new PartialXMLStreamParser({ stopNodes: ['script', 'app.config.settings.value'] }); // Corrected full path
            const xml = "<app><script>let x=1;</script><config><settings><value>secret</value><other>val</other></settings></config></app>";
            let streamResult = parser.parseStream(xml);
            expect(streamResult).toEqual({
                app: {
                    script: { "#text": "let x=1;" },
                    config: {
                        settings: {
                            value: { "#text": "secret" },
                            other: "val"
                        }
                    }
                },
                _partial: false
            });
        });
    });
    describe('alwaysCreateTextNode feature', () => {
        const xmlData = `
    <root a="nice" checked>
        <a>wow</a>
        <a>
          wow again
          <c> unlimited </c>
        </a>
        <b>wow phir se</b>
    </root>`;

        it('should simplify text nodes when alwaysCreateTextNode is false (default)', () => {
            parser = new PartialXMLStreamParser({ attributeNamePrefix: "@" }); // Use default alwaysCreateTextNode: false
            let streamResult = parser.parseStream(xmlData);
            expect(streamResult).toEqual({
                root: {
                    "@a": "nice",
                    "@checked": true,
                    "a": [
                        "wow",
                        {
                            "c": " unlimited ", // Note: spaces are preserved by current text parsing
                            "#text": "\n          wow again\n          "
                        }
                    ],
                    "b": "wow phir se",
                },
                _partial: false
            });
            streamResult = parser.parseStream(null);
            expect(streamResult).toEqual({
                root: {
                    "@a": "nice",
                    "@checked": true,
                    "a": [
                        "wow",
                        {
                            "c": " unlimited ",
                            "#text": "\n          wow again\n          "
                        }
                    ],
                    "b": "wow phir se",
                },
                _partial: false
            });
        });

        it('should always create #text nodes when alwaysCreateTextNode is true', () => {
            describe('parsePrimitives feature', () => {
                it('should parse primitive types in attributes when parsePrimitives is true', () => {
                    parser = new PartialXMLStreamParser({ parsePrimitives: true, attributeNamePrefix: "@" });
                    let streamResult = parser.parseStream('&lt;data num="123" float="3.14" boolTrue="true" boolFalse="false" text="hello" neg="-5" zero="0" /&gt;');
                    expect(streamResult).toEqual({
                        data: {
                            "@num": 123,
                            "@float": 3.14,
                            "@boolTrue": true,
                            "@boolFalse": false,
                            "@text": "hello",
                            "@neg": -5,
                            "@zero": 0
                        },
                        _partial: false
                    });
                });

                it('should not parse primitives in attributes when parsePrimitives is false (default)', () => {
                    parser = new PartialXMLStreamParser({ attributeNamePrefix: "@" }); // parsePrimitives is false by default
                    let streamResult = parser.parseStream('&lt;data num="123" boolTrue="true" text="hello" /&gt;');
                    expect(streamResult).toEqual({
                        data: {
                            "@num": "123",
                            "@boolTrue": "true",
                            "@text": "hello"
                        },
                        _partial: false
                    });
                });

                it('should parse primitive types in text content when parsePrimitives is true', () => {
                    parser = new PartialXMLStreamParser({ parsePrimitives: true, textNodeName: "#text" });
                    let streamResult = parser.parseStream('&lt;root&gt;&lt;num&gt;456&lt;/num&gt;&lt;bool&gt;false&lt;/bool&gt;&lt;str&gt;world&lt;/str&gt;&lt;float&gt;-7.89&lt;/float&gt;&lt;/root&gt;');
                    expect(streamResult).toEqual({
                        root: {
                            num: 456,
                            bool: false,
                            str: "world",
                            float: -7.89
                        },
                        _partial: false
                    });
                });

                it('should parse primitive types in text content with alwaysCreateTextNode:true and parsePrimitives:true', () => {
                    parser = new PartialXMLStreamParser({ parsePrimitives: true, alwaysCreateTextNode: true, textNodeName: "#text" });
                    let streamResult = parser.parseStream('&lt;root&gt;&lt;num&gt;456&lt;/num&gt;&lt;bool&gt;false&lt;/bool&gt;&lt;str&gt;world&lt;/str&gt;&lt;/root&gt;');
                    expect(streamResult).toEqual({
                        root: {
                            num: { "#text": 456 },
                            bool: { "#text": false },
                            str: { "#text": "world" }
                        },
                        _partial: false
                    });
                });

                it('should not parse primitives in text content when parsePrimitives is false', () => {
                    parser = new PartialXMLStreamParser({ textNodeName: "#text" }); // parsePrimitives is false
                    let streamResult = parser.parseStream('&lt;root&gt;&lt;num&gt;456&lt;/num&gt;&lt;bool&gt;true&lt;/bool&gt;&lt;/root&gt;');
                    expect(streamResult).toEqual({
                        root: {
                            num: "456",
                            bool: "true"
                        },
                        _partial: false
                    });
                });

                it('should handle mixed content with primitive parsing', () => {
                    parser = new PartialXMLStreamParser({ parsePrimitives: true, textNodeName: "#text" });
                    let streamResult = parser.parseStream('&lt;item&gt;Count: &lt;val&gt;10&lt;/val&gt; is true: &lt;flag&gt;TRUE&lt;/flag&gt;&lt;/item&gt;');
                    expect(streamResult).toEqual({
                        item: {
                            "#text": ["Count: ", " is true: "], // Text nodes are split by child elements
                            val: 10,
                            flag: true
                        },
                        _partial: false
                    });
                });

                it('should correctly parse primitives in CDATA sections when parsePrimitives is true', () => {
                    parser = new PartialXMLStreamParser({ parsePrimitives: true, textNodeName: "#text" });
                    let streamResult = parser.parseStream('&lt;data&gt;&lt;![CDATA[123]]&gt;&lt;![CDATA[true]]&gt;&lt;![CDATA[ text ]]&gt;&lt;/data&gt;');
                    // CDATA sections are concatenated if they are siblings under the same parent and parsePrimitives is on
                    // However, current addValueToObject logic for textNodeName will concatenate strings.
                    // If the first CDATA is "123" (parsed to number 123), and next is "true" (parsed to boolean true),
                    // they won't be string concatenated. They'll become an array.
                    expect(streamResult).toEqual({
                        data: {
                            "#text": [123, true, " text "] // CDATA content is not trimmed by default by _tryParsePrimitive for strings
                        },
                        _partial: false
                    });
                });

                it('should not parse non-primitive strings like "123xyz" or "true_value"', () => {
                    parser = new PartialXMLStreamParser({ parsePrimitives: true, attributeNamePrefix: "@" });
                    let streamResult = parser.parseStream('&lt;data attrNum="123xyz" attrBool="true_value"&gt;&lt;num&gt;456abc&lt;/num&gt;&lt;bool&gt;falseish&lt;/bool&gt;&lt;/data&gt;');
                    expect(streamResult).toEqual({
                        data: {
                            "@attrNum": "123xyz",
                            "@attrBool": "true_value",
                            num: "456abc",
                            bool: "falseish"
                        },
                        _partial: false
                    });
                });
            });
        });
        parser = new PartialXMLStreamParser({ alwaysCreateTextNode: true, attributeNamePrefix: "@" });
        let streamResult = parser.parseStream(xmlData);
        expect(streamResult).toEqual({
            root: {
                "@a": "nice",
                "@checked": true,
                "a": [
                    { "#text": "wow" },
                    {
                        "c": { "#text": " unlimited " },
                        "#text": "\n          wow again\n          "
                    }
                ],
                "b": { "#text": "wow phir se" },
            },
            _partial: false
        });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({
            root: {
                "@a": "nice",
                "@checked": true,
                "a": [
                    { "#text": "wow" },
                    {
                        "c": { "#text": " unlimited " },
                        "#text": "\n          wow again\n          "
                    }
                ],
                "b": { "#text": "wow phir se" },
            },
            _partial: false
        });
    });

    it('should handle simple text with alwaysCreateTextNode: true', () => {
        parser = new PartialXMLStreamParser({ alwaysCreateTextNode: true });
        let streamResult = parser.parseStream('<item>Just text</item>');
        expect(streamResult).toEqual({ item: { "#text": "Just text" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ item: { "#text": "Just text" }, _partial: false });
    });

    it('should handle text-only root with alwaysCreateTextNode: true', () => {
        parser = new PartialXMLStreamParser({ alwaysCreateTextNode: true });
        let streamResult = parser.parseStream('Root text only');
        // Root text is a special case, it might still be simplified or handled differently
        // Current logic for root text (lines 218-221 in index.js) might override.
        // Let's test current behavior:
        expect(streamResult).toEqual({ "#text": "Root text only", _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ "#text": "Root text only", _partial: false });
    });

    it('should handle CDATA with alwaysCreateTextNode: true', () => {
        parser = new PartialXMLStreamParser({ alwaysCreateTextNode: true });
        let streamResult = parser.parseStream('<item><![CDATA[cdata text]]></item>');
        expect(streamResult).toEqual({ item: { "#text": "cdata text" }, _partial: false });
        streamResult = parser.parseStream(null);
        expect(streamResult).toEqual({ item: { "#text": "cdata text" }, _partial: false });
    });
});