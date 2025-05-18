import { bench, describe } from "vitest";
import PartialXMLStreamParser from "./index.js";

describe("PartialXMLStreamParser Benchmarks", () => {
  const simpleXML =
    '<root><item id="1">Text1</item><item id="2">Text2</item></root>';
  const complexXML = `
        <data store="main">
            <book category="COOKING">
                <title lang="en">Everyday Italian</title>
                <author>Giada De Laurentiis</author>
                <year>2005</year>
                <price>30.00</price>
            </book>
            <book category="CHILDREN">
                <title lang="en">Harry Potter</title>
                <author>J K. Rowling</author>
                <year>2005</year>
                <price>29.99</price>
            </book>
            <book category="WEB">
                <title lang="en">Learning XML</title>
                <author>Erik T. Ray</author>
                <year>2003</year>
                <price>39.95</price>
            </book>
            <misc type="info">Some additional info here</misc>
        </data>
    `;
  const multiRootXML =
    "<item>A</item><item>B</item><item>C</item><item>D</item><item>E</item>";
  const cdataXML =
    "<root><data><![CDATA[This is some <CDATA> content with & symbols that should be preserved.]]></data></root>";
  const stopNodeXML =
    '<root><script type="text/javascript">function greet(){ console.log("hello <world>"); }</script><content>Parse me</content></root>';

  bench("Parse simple XML (single chunk)", () => {
    const parser = new PartialXMLStreamParser();
    parser.parseStream(simpleXML);
    parser.parseStream(null);
  });

  bench("Parse complex XML (single chunk)", () => {
    const parser = new PartialXMLStreamParser();
    parser.parseStream(complexXML);
    parser.parseStream(null);
  });

  bench("Parse simple XML (multiple chunks)", () => {
    const parser = new PartialXMLStreamParser();
    const chunks = simpleXML.match(/.{1,10}/g) || [simpleXML]; // Split into ~10 char chunks
    chunks.forEach((chunk) => parser.parseStream(chunk));
    parser.parseStream(null);
  });

  bench("Parse complex XML (multiple chunks)", () => {
    const parser = new PartialXMLStreamParser();
    const chunks = complexXML.match(/.{1,50}/g) || [complexXML]; // Split into ~50 char chunks
    chunks.forEach((chunk) => parser.parseStream(chunk));
    parser.parseStream(null);
  });

  bench("Parse XML with multiple root elements", () => {
    const parser = new PartialXMLStreamParser();
    parser.parseStream(multiRootXML);
    parser.parseStream(null);
  });

  bench("Parse XML with CDATA", () => {
    const parser = new PartialXMLStreamParser();
    parser.parseStream(cdataXML);
    parser.parseStream(null);
  });

  bench("Parse XML with stop nodes", () => {
    const parser = new PartialXMLStreamParser({ stopNodes: ["script"] });
    parser.parseStream(stopNodeXML);
    parser.parseStream(null);
  });

  bench("Parse XML with alwaysCreateTextNode true", () => {
    const parser = new PartialXMLStreamParser({ alwaysCreateTextNode: true });
    parser.parseStream(complexXML);
    parser.parseStream(null);
  });

  bench("Parse XML with parsePrimitives true", () => {
    const parser = new PartialXMLStreamParser({ parsePrimitives: true });
    parser.parseStream(complexXML); // complexXML has numbers and could have booleans if added
    parser.parseStream(null);
  });

  const generateLargeXML = (numItems) => {
    let xml = "<largeRoot>";
    for (let i = 0; i < numItems; i++) {
      xml += `<item id="${i}">`;
      xml += `<name>Item Name ${i}</name>`;
      xml += `<value>${Math.random() * 1000}</value>`;
      xml += `<description>This is a description for item ${i}. It contains some text to make it a bit larger.</description>`;
      xml += `<nested><subitem attr="sub${i}">Sub Value ${i}</subitem></nested>`;
      xml += "</item>";
    }
    xml += "</largeRoot>";
    return xml;
  };

  const largeXMLString = generateLargeXML(1000); // 1000 items
  const veryLargeXMLString = generateLargeXML(5000); // 5000 items for a more demanding test

  bench("Parse large XML (1000 items, single chunk)", () => {
    const parser = new PartialXMLStreamParser();
    parser.parseStream(largeXMLString);
    parser.parseStream(null);
  });

  bench("Parse large XML (1000 items, multiple chunks)", () => {
    const parser = new PartialXMLStreamParser();
    const chunks = largeXMLString.match(/.{1,1024}/g) || [largeXMLString]; // Split into ~1KB chunks
    chunks.forEach((chunk) => parser.parseStream(chunk));
    parser.parseStream(null);
  });

  bench("Parse very large XML (5000 items, single chunk)", () => {
    const parser = new PartialXMLStreamParser();
    parser.parseStream(veryLargeXMLString);
    parser.parseStream(null);
  });

  bench("Parse very large XML (5000 items, multiple chunks)", () => {
    const parser = new PartialXMLStreamParser();
    const chunks = veryLargeXMLString.match(/.{1,1024}/g) || [
      veryLargeXMLString,
    ]; // Split into ~1KB chunks
    chunks.forEach((chunk) => parser.parseStream(chunk));
    parser.parseStream(null);
  });
});
