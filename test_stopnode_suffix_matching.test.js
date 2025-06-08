import { describe, it, expect, beforeEach } from "vitest";
import { PartialXMLStreamParser } from "./index.js";

// Test case for stopnode suffix matching functionality
describe('Stopnode Suffix Matching', () => {
  let parser;

  it('should support path stopnode suffix matching', () => {
    parser = new PartialXMLStreamParser({
      stopNodes: ["follow_up.suggest"],
      textNodeName: "#text"
    });

    const input = `<ask_followup_question>
<question>What would you like to do next?</question>
<follow_up>
<suggest><data>heha</data></suggest>
<suggest>Second option</suggest>
</follow_up>
</ask_followup_question>`;

    const result = parser.parseStream(input);
    
    expect(result).toEqual({
      metadata: { partial: false },
      xml: [
        {
          ask_followup_question: {
            question: { "#text": "What would you like to do next?" },
            follow_up: {
              suggest: [
                { "#text": "<data>heha</data>" },  // data should be raw text
                { "#text": "Second option" }
              ]
            }
          }
        }
      ]
    });
  });

  it('should work with exact path matches', () => {
    parser = new PartialXMLStreamParser({
      stopNodes: ["ask_followup_question.follow_up.suggest"],
      textNodeName: "#text"
    });

    const input = `<ask_followup_question>
<follow_up>
<suggest><data>heha</data></suggest>
</follow_up>
</ask_followup_question>`;

    const result = parser.parseStream(input);
    
    expect(result.xml[0].ask_followup_question.follow_up.suggest["#text"]).toBe("<data>heha</data>");
  });

  it('should not match partial path segments', () => {
    parser = new PartialXMLStreamParser({
      stopNodes: ["up.suggest"],  // Should not match "follow_up.suggest"
      textNodeName: "#text"
    });

    const input = `<follow_up><suggest><data>should be parsed</data></suggest></follow_up>`;

    const result = parser.parseStream(input);
    
    // Since "up.suggest" doesn't match "follow_up.suggest", data should be parsed normally
    expect(result.xml[0].follow_up.suggest.data["#text"]).toBe("should be parsed");
  });

  it('should work with multiple suffix matches', () => {
    parser = new PartialXMLStreamParser({
      stopNodes: ["config.value", "data.item"],
      textNodeName: "#text"
    });

    const input = `<root>
<app>
  <config>
    <value><raw>content1</raw></value>
  </config>
  <data>
    <item><raw>content2</raw></item>
  </data>
</app>
</root>`;

    const result = parser.parseStream(input);
    
    expect(result.xml[0].root.app.config.value["#text"]).toBe("<raw>content1</raw>");
    expect(result.xml[0].root.app.data.item["#text"]).toBe("<raw>content2</raw>");
  });
});

module.exports = {};