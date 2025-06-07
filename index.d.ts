// Type definitions for partial-xml-stream-parser
// Project: https://github.com/username/partial-xml-stream-parser
// Definitions by: TypeScript User

/**
 * Options for configuring the PartialXMLStreamParser
 */
export interface PartialXMLStreamParserOptions {
  /**
   * Key for text content when a tag has other children or for consistency
   * @default "#text"
   */
  textNodeName?: string;

  /**
   * Prefix for attribute names in the parsed object
   * @default "@"
   */
  attributeNamePrefix?: string;

  /**
   * Array of tag names that should not have their children parsed
   * @default []
   */
  stopNodes?: string[] | string;

  /**
   * Maximum nesting depth; tags beyond this depth are treated like stopNodes
   * @default null
   */
  maxDepth?: number | null;

  /**
   * If true, text content is always in a #text node
   * @default true
   */
  alwaysCreateTextNode?: boolean;

  /**
   * If true, attempts to parse numbers and booleans
   * @default false
   */
  parsePrimitives?: boolean;

  /**
   * Optional array of permitted root element names.
   * If provided and not empty, the parser will only treat the input as XML if the root element's name is in this list.
   * Otherwise, the input is treated as plain text.
   * If undefined or an empty array, XML is parsed unconditionally.
   * Can be a single string or an array of strings.
   * @default []
   */
  allowedRootNodes?: string[] | string;
}

/**
 * Metadata about the parsing result
 */
export interface ParsingMetadata {
  /**
   * Indicates if the parsing is partial/incomplete
   */
  partial: boolean;
}

/**
 * The result of parsing an XML stream
 */
export interface ParsingResult {
  /**
   * Metadata about the parsing result
   */
  metadata: ParsingMetadata;

  /**
   * The parsed XML content as an array of root elements/text.
   * Can be null if no valid XML was found and the stream ended.
   */
  xml: Array<any> | null;
}

/**
 * A lenient XML stream parser that can handle incomplete or malformed XML data
 */
declare class PartialXMLStreamParser {
  /**
   * Creates a new instance of PartialXMLStreamParser
   * @param options Configuration options for the parser
   */
  constructor(options?: PartialXMLStreamParserOptions);

  /**
   * Reset the parser state
   */
  reset(): void;

  /**
   * Parse an XML chunk in streaming mode
   * @param xmlChunk The XML chunk to parse. Can be a string, Buffer, null, undefined, or empty string.
   * @returns The parsing result, which may be partial if the XML is incomplete
   */
  parseStream(xmlChunk: string | Buffer | null | undefined): ParsingResult;

  /**
   * The current streaming buffer
   */
  private streamingBuffer: string;

  /**
   * Flag indicating if the parser is actively streaming
   */
  private _activelyStreaming: boolean;

  /**
   * The accumulator for parsed XML objects
   */
  private accumulator: any[];

  /**
   * The current pointer in the XML object tree
   */
  private currentPointer: any;

  /**
   * The stack of tags being processed
   */
  private tagStack: Array<{
    tagName: string;
    objPtr: any;
    textOnly: boolean;
    path: string;
  }>;

  /**
   * The current parsing index in the buffer
   */
  private parsingIndex: number;

  /**
   * The state of any incomplete structure being parsed
   */
  private incompleteStructureState: any;

  /**
   * Context for reparsed segments
   */
  private reparsedSegmentContext: any;

  /**
   * The custom options for this parser instance
   */
  private customOptions: PartialXMLStreamParserOptions;

  /**
   * Regular expression for parsing attributes
   */
  private attrRegex: RegExp;

  /**
   * Regular expression for finding XML comments
   */
  private commentRegex: RegExp;

  /**
   * Regular expression for finding CDATA sections
   */
  private cdataOpenRegex: RegExp;

  /**
   * Regular expression for finding DOCTYPE declarations
   */
  private doctypeRegex: RegExp;

  /**
   * Regular expression for finding XML declarations
   */
  private xmlDeclRegex: RegExp;

  /**
   * Regular expression for finding closing tags
   */
  private closingTagRegex: RegExp;

  /**
   * Regular expression for finding opening tags
   */
  private openingTagRegex: RegExp;

  /**
   * Cache for stop node regular expressions
   */
  private stopNodeRegexCache: Record<string, RegExp>;

  /**
   * Set of simple stop nodes
   */
  private simpleStopNodes: Set<string>;

  /**
   * Set of path stop nodes
   */
  private pathStopNodes: Set<string>;

  private _rootTagDecisionMade: boolean;
  private _treatAsPlainText: boolean;
  private _rootDeterminationBuffer: string;
  private _plainTextAccumulator: any[];
  private _originalBufferHadContent: boolean;
  private streamingBufferBeforeClear: string;
  private _lastClearedIncompleteStateWasSpecial: boolean;


  /**
   * Decode XML entities in text
   * @param text The text to decode
   * @returns The decoded text
   */
  private _decodeXmlEntities(text: string): string;

  /**
   * Try to parse a primitive value from a string
   * @param value The string value to parse
   * @returns The parsed primitive value or the original string
   */
  private _tryParsePrimitive(value: string): any;

  /**
   * Parse attributes from an attribute string
   * @param attributesString The string containing attributes
   * @param attributeNamePrefix The prefix to use for attribute names
   * @returns An object containing the parsed attributes
   */
  private _parseAttributes(
    attributesString: string,
    attributeNamePrefix: string,
  ): Record<string, any>;

  /**
   * Process the current buffer
   */
  private _processBuffer(): void;

  /**
   * Handle fallback text when parsing fails
   * @param buffer The buffer being parsed
   * @param startIndex The starting index in the buffer
   * @param textNodeName The name to use for text nodes
   * @returns The new parsing index
   */
  private _handleFallbackText(
    buffer: string,
    startIndex: number,
    textNodeName: string,
  ): number;
}

export default PartialXMLStreamParser;
