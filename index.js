// PartialXMLStreamParser.js (Lenient Streaming Focus)

const STATIC_OPENING_TAG_REGEX =
  /<\s*([\w:-]+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*\s*)?(\/?)\>/;
const STATIC_CLOSING_TAG_REGEX = /<\/\s*([\w:-]+)\s*>/;

// Default options relevant to the lenient streaming parser
const DEFAULT_STREAM_OPTIONS = {
  textNodeName: "#text", // Key for text content when a tag has other children or for consistency
  attributeNamePrefix: "@", // Prefix for attribute names in the parsed object
  stopNodes: [], // Array of tag names that should not have their children parsed
  alwaysCreateTextNode: true, // If true, text content is always in a #text node. Changed default for performance.
  parsePrimitives: false, // If true, attempts to parse numbers and booleans
};

const COMMON_ENTITIES = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

const addValueToObject = (
  obj,
  key,
  value,
  // textNodeNameForConcat, // This parameter is effectively customOptions.textNodeName
  customOptions,
) => {
  const effectiveTextNodeName = customOptions.textNodeName; // Directly use from merged options
  const alwaysCreate = customOptions.alwaysCreateTextNode; // Directly use from merged options

  if (obj.hasOwnProperty(key)) {
    if (alwaysCreate) { // Path for alwaysCreateTextNode = true
      if (key === effectiveTextNodeName) { // Special handling for text nodes
        if (typeof obj[key] === "string" && typeof value === "string") {
          obj[key] += value; // Concatenate text
        } else { // Mixed content or multiple distinct text segments
          if (!Array.isArray(obj[key])) {
            obj[key] = [obj[key]];
          }
          obj[key].push(value);
        }
      } else { // For non-text nodes (child elements)
        if (!Array.isArray(obj[key])) {
          obj[key] = [obj[key]];
        }
        obj[key].push(value);
      }
    } else { // Path for alwaysCreateTextNode = false
      if (
        key === effectiveTextNodeName && // Was textNodeNameForConcat
        typeof obj[key] === "string" &&
        typeof value === "string"
      ) {
        // Concatenate for textNodeName if types match
        obj[key] += value;
      } else { // General case: turn into array or push to existing array
        if (!Array.isArray(obj[key])) {
          obj[key] = [obj[key]];
        }
        obj[key].push(value);
      }
    }
  } else {
    // Key doesn't exist yet.
    // If alwaysCreate is true, and it's the textNodeName, it's just the value.
    // If alwaysCreate is false, it's also just the value.
    // The distinction for alwaysCreate matters more when the key *exists*.
    obj[key] = value;
  }
};

class PartialXMLStreamParser {
  constructor(options) {
    const mergedOptions = { ...DEFAULT_STREAM_OPTIONS, ...options };
    this.customOptions = mergedOptions;

    this.attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
    // Regexes for special constructs - these are still useful for quick checks and full parsing of these constructs
    this.commentRegex = /<!--/g; // Used to find the start
    this.cdataOpenRegex = /<!\[CDATA\[/g; // Used to find the start
    this.doctypeRegex = /<!DOCTYPE/g; // Used to find the start
    this.xmlDeclRegex = /<\?xml/g; // Used to find the start

    // Global regexes for opening/closing tags are removed as they are replaced by static ones on substrings
    // this.closingTagRegex = /<\/\s*([\w:-]+)\s*>/g;
    // this.openingTagRegex =
    //   /<\s*([\w:-]+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*\s*)?(\/?)\>/g;

    this.stopNodeRegexCache = {};

    this.simpleStopNodes = new Set();
    this.pathStopNodes = new Set();

    if (mergedOptions.stopNodes) {
      const stopNodesArray = Array.isArray(mergedOptions.stopNodes)
        ? mergedOptions.stopNodes
        : [mergedOptions.stopNodes];
      stopNodesArray.forEach((node) => {
        if (typeof node === "string") {
          if (node.includes(".")) {
            this.pathStopNodes.add(node);
          } else {
            this.simpleStopNodes.add(node);
          }
        }
      });
    }
    this.reset();
  }

  reset() {
    this.streamingBuffer = "";
    this._activelyStreaming = false;
    this.accumulator = [];
    this.currentPointer = null;
    this.tagStack = [];
    this.parsingIndex = 0;
    this.incompleteStructureState = null;
    this.reparsedSegmentContext = null;
    this.streamingBufferBeforeClear = ""; // For final null check
    this._originalBufferHadContent = false; // For final null check
    this._lastClearedIncompleteStateWasSpecial = false; // Initialize flag
  }

  _decodeXmlEntities(text) {
    if (typeof text !== "string") return text;
    return text.replace(
      /&(lt|gt|amp|quot|apos|#(\d+)|#x([\da-fA-F]+));/g,
      (match, name, dec, hex) => {
        if (COMMON_ENTITIES[name]) {
          return COMMON_ENTITIES[name];
        }
        if (dec) return String.fromCharCode(parseInt(dec, 10));
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        return match;
      },
    );
  }

  _tryParsePrimitive(value) {
    if (typeof value !== "string") return value;
    const lowerVal = value.toLowerCase();
    // Only convert if the string is exactly "true" or "false"
    if (value === "true") return true;
    if (value === "false") return false;
    if (lowerVal === "true" && value.length === 4) return true; // case-insensitive exact match
    if (lowerVal === "false" && value.length === 5) return false; // case-insensitive exact match

    const trimmedValueForCheck = value.trim();
    if (
      trimmedValueForCheck.length > 0 &&
      !isNaN(Number(trimmedValueForCheck))
    ) {
      const num = Number(trimmedValueForCheck);
      if (String(num) === trimmedValueForCheck) {
        // Ensure no trailing characters like "123a"
        return num;
      }
    }
    return value;
  }

  _parseAttributes(attributesString, attributeNamePrefix) {
    const attrs = {};
    if (attributesString) {
      this.attrRegex.lastIndex = 0;
      let match;
      while ((match = this.attrRegex.exec(attributesString)) !== null) {
        const attrName = match[1];
        let attrValue;
        if (match[2] !== undefined) {
          attrValue = this._decodeXmlEntities(match[2]);
        } else if (match[3] !== undefined) {
          attrValue = this._decodeXmlEntities(match[3]);
        } else if (match[4] !== undefined) {
          attrValue = this._decodeXmlEntities(match[4]);
        } else {
          attrValue = true;
        }
        if (
          this.customOptions.parsePrimitives &&
          typeof attrValue === "string"
        ) {
          attrs[`${attributeNamePrefix}${attrName}`] =
            this._tryParsePrimitive(attrValue);
        } else {
          attrs[`${attributeNamePrefix}${attrName}`] = attrValue;
        }
      }
    }
    return attrs;
  }

  _processBuffer() {
    const textNodeName = this.customOptions.textNodeName;
    const attributeNamePrefix =
      this.customOptions.attributeNamePrefix !== undefined
        ? this.customOptions.attributeNamePrefix
        : "@";
    const buffer = this.streamingBuffer;
    let len = buffer.length;

    if (this.incompleteStructureState) {
      const state = this.incompleteStructureState;
      const searchStartIndex = Math.max(this.parsingIndex, state.at || 0);
      let endIdx;

      switch (state.type) {
        case "comment":
          endIdx = buffer.indexOf(state.lookingFor, searchStartIndex);
          if (endIdx !== -1 && endIdx >= (state.at || 0)) {
            this.parsingIndex = endIdx + state.lookingFor.length;
            this.incompleteStructureState = null;
          } else {
            return;
          }
          break;
        case "cdata":
          const cdataCloseMarker = state.lookingFor;
          endIdx = buffer.indexOf(cdataCloseMarker, this.parsingIndex);

          if (endIdx !== -1) {
            const newContentSegment = buffer.substring(
              this.parsingIndex,
              endIdx,
            );
            if (newContentSegment.trim().length > 0) {
              let textToAdd = this.customOptions.parsePrimitives
                ? this._tryParsePrimitive(newContentSegment)
                : newContentSegment;
              if (this.tagStack.length > 0 && this.currentPointer) {
                addValueToObject(
                  this.currentPointer,
                  textNodeName,
                  textToAdd,
                  // textNodeName, // Removed parameter
                  this.customOptions,
                );
              } else if (this.tagStack.length === 0) {
                this.accumulator.push(textToAdd);
              }
            }
            this.parsingIndex = endIdx + cdataCloseMarker.length;
            this.incompleteStructureState = null;
          } else {
            const newPartialContent = buffer.substring(this.parsingIndex, len);
            if (newPartialContent.trim().length > 0) {
              let textToAdd = this.customOptions.parsePrimitives
                ? this._tryParsePrimitive(newPartialContent)
                : newPartialContent;
              if (this.tagStack.length > 0 && this.currentPointer) {
                addValueToObject(
                  this.currentPointer,
                  textNodeName,
                  textToAdd,
                  // textNodeName, // Removed parameter
                  this.customOptions,
                );
              } else if (
                this.tagStack.length === 0 &&
                state.at === 0 &&
                this.accumulator.length === 0
              ) {
                // Only add to accumulator if it's truly root CDATA
                this.accumulator.push(textToAdd);
              }
            }
            this.parsingIndex = len;
            return;
          }
          break;
        case "doctype":
        case "xmldecl":
          endIdx = buffer.indexOf(state.lookingFor, searchStartIndex);
          if (endIdx !== -1 && endIdx >= (state.at || 0)) {
            this.parsingIndex = endIdx + state.lookingFor.length;
            this.incompleteStructureState = null;
          } else {
            return;
          }
          break;
        case "tag_start_incomplete":
          if (this.parsingIndex + 1 < len) {
            this.incompleteStructureState = null;
          } else {
            return;
          }
          break;
        case "opening_tag_incomplete":
        case "closing_tag_incomplete":
          if (state.at !== undefined) {
            this.parsingIndex = state.at;
            this.reparsedSegmentContext = {
              originalIndex: state.at,
              partialText: state.partial,
              parentContext: state.parentOfPartial,
              tagType:
                state.type === "opening_tag_incomplete" ? "opening" : "closing",
            };
          }
          this.incompleteStructureState = null;
          break;
        case "stop_node_content":
          let {
            tagName: stopNodeTagName,
            depth: stopNodeDepth,
            // contentStartIndex: stopNodeContentStartIndex, // Not directly used here after state restore
            stopNodeObjectRef,
          } = state;
          let currentSearchPos = this.parsingIndex;

          let contentSearchRegex = this.stopNodeRegexCache[stopNodeTagName];
          if (!contentSearchRegex) {
            const contentSearchRegexStr = `<\\s*${stopNodeTagName}(?:\\s[^>]*)?>|<\\/\\s*${stopNodeTagName}\\s*>`;
            contentSearchRegex = new RegExp(contentSearchRegexStr, "g");
            this.stopNodeRegexCache[stopNodeTagName] = contentSearchRegex;
          }
          contentSearchRegex.lastIndex = currentSearchPos;

          let rawContentEnd = -1;
          let closingTagLength = 0;
          let execMatch;

          while (
            currentSearchPos < len &&
            (execMatch = contentSearchRegex.exec(buffer)) !== null
          ) {
            const matchedTag = execMatch[0];
            if (matchedTag.startsWith("</") || matchedTag.startsWith("<\\/")) {
              stopNodeDepth--;
              if (stopNodeDepth === 0) {
                rawContentEnd = execMatch.index;
                closingTagLength = matchedTag.length;
                break;
              }
            } else if (!/\/\s*>$/.test(matchedTag)) {
              stopNodeDepth++;
            }
            currentSearchPos = contentSearchRegex.lastIndex;
          }

          if (rawContentEnd !== -1) {
            const newContentSegment = buffer.substring(
              this.parsingIndex, // Continue from where we left off in the buffer
              rawContentEnd,
            );
            // state.stopNodeObjectRef should already have prior content if any
            addValueToObject(
              stopNodeObjectRef,
              textNodeName,
              newContentSegment,
              // textNodeName, // Removed parameter
              this.customOptions,
            );
            this.parsingIndex = rawContentEnd + closingTagLength;
            this.incompleteStructureState = null;
          } else {
            // More content for the stop node, but no closing tag found yet in this chunk
            const newPartialContent = buffer.substring(this.parsingIndex, len);
            if (newPartialContent.length > 0) {
              addValueToObject(
                stopNodeObjectRef,
                textNodeName,
                newPartialContent,
                // textNodeName, // Removed parameter
                this.customOptions,
              );
            }
            this.parsingIndex = len;
            // Keep incompleteStructureState as is, but update its content
            this.incompleteStructureState.depth = stopNodeDepth; // Update depth
            return;
          }
          break;
        default:
          this.incompleteStructureState = null;
      }
    }

    while (this.parsingIndex < len) {
      const i = this.parsingIndex;
      if (buffer[i] === "<") {
        if (i + 1 >= len) {
          this.incompleteStructureState = {
            type: "tag_start_incomplete",
            at: i,
            partial: "<",
          };
          this.parsingIndex = len; // Consume the '<'
          return;
        }

        let matchedSpecialPrefix = false;
        // Removed regexMatch variable as it's not used with startsWith logic for these prefixes

        const charAfterLT = buffer[i + 1]; // Already checked: i + 1 < len

        if (charAfterLT === '?') { // Potential <?xml
          if (buffer.startsWith("<?xml", i)) {
            const endDeclaration = buffer.indexOf("?>", i + 5); // "<?xml".length is 5
            if (endDeclaration === -1) {
              this.incompleteStructureState = {
                type: "xmldecl",
                lookingFor: "?>",
                at: i,
                partial: buffer.substring(i, len),
              };
              this.parsingIndex = len;
              return;
            }
            this.parsingIndex = endDeclaration + 2;
            matchedSpecialPrefix = true;
            this.incompleteStructureState = null;
          }
        } else if (charAfterLT === '!') { // Potential comment, CDATA, DOCTYPE
          // Check for <!-- (comment)
          if (i + 3 < len && buffer[i + 2] === '-' && buffer[i + 3] === '-') {
            // No need for buffer.startsWith("<!--", i) if char checks are sufficient,
            // but keeping it for safety/clarity or if `startsWith` is highly optimized.
            // Assuming it's "<!--"
            const commentEnd = buffer.indexOf("-->", i + 4); // "<!--".length is 4
            if (commentEnd === -1) {
              this.incompleteStructureState = {
                type: "comment",
                lookingFor: "-->",
                at: i,
                partial: buffer.substring(i, len),
              };
              this.parsingIndex = len;
              return;
            }
            this.parsingIndex = commentEnd + 3;
            matchedSpecialPrefix = true;
            this.incompleteStructureState = null;
          }
          // Check for <![CDATA[
          // Needs to be checked before <!DOCTYPE because <!D also starts with <!
          else if (buffer.startsWith("<![CDATA[", i)) { // "<![CDATA[".length is 9
            const cdataOpenTagEnd = i + 9;
            const cdataCloseMarker = "]]>";
            const cdataEnd = buffer.indexOf(cdataCloseMarker, cdataOpenTagEnd);
            if (cdataEnd === -1) {
              const partialContent = buffer.substring(cdataOpenTagEnd, len);
              if (partialContent.trim().length > 0) {
                let textToAdd = this.customOptions.parsePrimitives
                  ? this._tryParsePrimitive(partialContent)
                  : partialContent;
                if (this.tagStack.length > 0 && this.currentPointer) {
                  addValueToObject(
                    this.currentPointer,
                    textNodeName,
                    textToAdd,
                    // textNodeName, // Removed parameter
                    this.customOptions,
                  );
                } else if (this.tagStack.length === 0) {
                  this.accumulator.push(textToAdd);
                }
              }
              this.incompleteStructureState = {
                type: "cdata",
                lookingFor: cdataCloseMarker,
                at: i,
                partialData: partialContent,
              };
              this.parsingIndex = len;
              return;
            } else {
              let text = buffer.substring(cdataOpenTagEnd, cdataEnd);
              this.parsingIndex = cdataEnd + cdataCloseMarker.length;
              const processedCDATA = this.customOptions.parsePrimitives
                ? this._tryParsePrimitive(text)
                : text;
              if (
                processedCDATA.trim().length > 0 ||
                (this.incompleteStructureState?.partialData &&
                  this.incompleteStructureState.type === "cdata")
              ) {
                if (this.tagStack.length > 0 && this.currentPointer) {
                  addValueToObject(
                    this.currentPointer,
                    textNodeName,
                    processedCDATA,
                    // textNodeName, // Removed parameter
                    this.customOptions,
                  );
                } else if (this.tagStack.length === 0) {
                  this.accumulator.push(processedCDATA);
                }
              }
              this.incompleteStructureState = null;
            }
            matchedSpecialPrefix = true;
          }
          // Check for <!DOCTYPE
          else if (buffer.startsWith("<!DOCTYPE", i)) { // "<!DOCTYPE ".length is 10 (or 9 for just "<!DOCTYPE")
            const endDoctype = buffer.indexOf(">", i + 9); // Assuming min length of <!DOCTYPE is 9
            if (endDoctype === -1) {
              this.incompleteStructureState = {
                type: "doctype",
                lookingFor: ">",
                at: i,
                partial: buffer.substring(i, len),
              };
              this.parsingIndex = len;
              return;
            }
            this.parsingIndex = endDoctype + 1;
            matchedSpecialPrefix = true;
            this.incompleteStructureState = null;
          }
        }

        if (matchedSpecialPrefix) {
          continue;
        }

        const tagEndMarker = buffer.indexOf(">", i);
        if (tagEndMarker === -1) {
          this.parsingIndex = this._handleFallbackText(buffer, i, textNodeName);
          if (
            this.incompleteStructureState &&
            (this.incompleteStructureState.type === "opening_tag_incomplete" ||
              this.incompleteStructureState.type === "closing_tag_incomplete" ||
              this.incompleteStructureState.type === "tag_start_incomplete")
          ) {
            return;
          }
          continue;
        }

        const tagString = buffer.substring(i, tagEndMarker + 1);
        let match;

        if (buffer[i + 1] === "/") {
          match = tagString.match(STATIC_CLOSING_TAG_REGEX);
          if (match) {
            const tagName = match[1];
            if (
              this.tagStack.length > 0 &&
              this.tagStack[this.tagStack.length - 1].tagName === tagName
            ) {
              const closedTagState = this.tagStack.pop();
              this.currentPointer =
                this.tagStack.length > 0
                  ? this.tagStack[this.tagStack.length - 1].objPtr
                  : null;

              if (
                !this.customOptions.alwaysCreateTextNode &&
                closedTagState.textOnly &&
                closedTagState.objPtr.hasOwnProperty(textNodeName) &&
                Object.keys(closedTagState.objPtr).length === 1
              ) {
                const textVal = closedTagState.objPtr[textNodeName];
                if (this.currentPointer) {
                  for (const keyInParent in this.currentPointer) {
                    if (
                      this.currentPointer[keyInParent] === closedTagState.objPtr
                    ) {
                      this.currentPointer[keyInParent] = textVal;
                      break;
                    } else if (
                      Array.isArray(this.currentPointer[keyInParent])
                    ) {
                      const arr = this.currentPointer[keyInParent];
                      const idx = arr.indexOf(closedTagState.objPtr);
                      if (idx !== -1) {
                        arr[idx] = textVal;
                        break;
                      }
                    }
                  }
                } else {
                  for (let k = 0; k < this.accumulator.length; k++) {
                    if (
                      typeof this.accumulator[k] === "object" &&
                      this.accumulator[k] !== null
                    ) {
                      const rootTagNameFromAccumulator = Object.keys(
                        this.accumulator[k],
                      )[0];
                      if (
                        rootTagNameFromAccumulator === closedTagState.tagName &&
                        this.accumulator[k][rootTagNameFromAccumulator] ===
                          closedTagState.objPtr
                      ) {
                        this.accumulator[k][rootTagNameFromAccumulator] =
                          textVal;
                        break;
                      }
                    }
                  }
                }
              }
            }
            this.parsingIndex = i + tagString.length;
            this.incompleteStructureState = null;
            this.reparsedSegmentContext = null;
          } else {
            this.parsingIndex = this._handleFallbackText(
              buffer,
              i,
              textNodeName,
            );
          }
        } else {
          match = tagString.match(STATIC_OPENING_TAG_REGEX);
          if (match) {
            const tagName = match[1];
            // Cleanup temporary text if this opening tag completes a previously incomplete fragment
            if (
              this.reparsedSegmentContext &&
              this.reparsedSegmentContext.parentContext &&
              this.reparsedSegmentContext.partialText !== undefined
            ) {
              // Ensure partialText is defined
              const { partialText, parentContext } =
                this.reparsedSegmentContext;
              const textNodeNameToUse = this.customOptions.textNodeName; // Use the dynamic textNodeName

              if (parentContext.hasOwnProperty(textNodeNameToUse)) {
                const currentTextNodeValue = parentContext[textNodeNameToUse];

                if (typeof currentTextNodeValue === "string") {
                  if (currentTextNodeValue.endsWith(partialText)) {
                    const newTextValue = currentTextNodeValue.slice(
                      0,
                      -partialText.length,
                    );
                    if (newTextValue === "") {
                      delete parentContext[textNodeNameToUse];
                    } else {
                      parentContext[textNodeNameToUse] = newTextValue;
                    }
                  }
                } else if (Array.isArray(currentTextNodeValue)) {
                  // Remove the *last* occurrence that strictly equals partialText
                  let foundAndRemoved = false;
                  for (let k = currentTextNodeValue.length - 1; k >= 0; k--) {
                    if (currentTextNodeValue[k] === partialText) {
                      currentTextNodeValue.splice(k, 1);
                      foundAndRemoved = true;
                      break;
                    }
                  }
                  if (foundAndRemoved && currentTextNodeValue.length === 0) {
                    delete parentContext[textNodeNameToUse];
                  }
                }
              }
            }
            this.reparsedSegmentContext = null; // Clear after attempting cleanup

            const attributesString = (match[2] || "").trim();
            const isSelfClosing = match[3] === "/";
            const parsedAttributes = this._parseAttributes(
              attributesString,
              attributeNamePrefix,
            );
            const parentPath =
              this.tagStack.length > 0
                ? this.tagStack[this.tagStack.length - 1].path
                : "";
            const currentPath = parentPath
              ? `${parentPath}.${tagName}`
              : tagName;
            const isSimpleStopNode = this.simpleStopNodes.has(tagName);
            const isPathStopNode = this.pathStopNodes.has(currentPath);
            const isStopNode =
              !isSelfClosing && (isSimpleStopNode || isPathStopNode);

            if (isStopNode) {
              const stopNodeObject = { ...parsedAttributes };
              if (this.tagStack.length === 0) {
                this.accumulator.push({ [tagName]: stopNodeObject });
              } else {
                addValueToObject(
                  this.currentPointer,
                  tagName,
                  stopNodeObject,
                  // undefined, // Removed parameter
                  this.customOptions,
                );
              }
              const openTagEndOffset = tagString.length;
              const contentStartIndex = i + openTagEndOffset;
              let depth = 1;
              let searchPos = contentStartIndex;
              let rawContentEnd = -1;
              let closingTagLengthVal = 0;
              let contentSearchRegex = this.stopNodeRegexCache[tagName];
              if (!contentSearchRegex) {
                const contentSearchRegexStr = `<\\s*${tagName}(?:\\s[^>]*)?>|<\\/\\s*${tagName}\\s*>`;
                contentSearchRegex = new RegExp(contentSearchRegexStr, "g");
                this.stopNodeRegexCache[tagName] = contentSearchRegex;
              }
              contentSearchRegex.lastIndex = searchPos;
              let execMatchStop;
              while (
                searchPos < len &&
                (execMatchStop = contentSearchRegex.exec(buffer)) !== null
              ) {
                const matchedStopTag = execMatchStop[0];
                if (
                  matchedStopTag.startsWith("</") ||
                  matchedStopTag.startsWith("<\\/")
                ) {
                  depth--;
                  if (depth === 0) {
                    rawContentEnd = execMatchStop.index;
                    closingTagLengthVal = matchedStopTag.length;
                    break;
                  }
                } else if (!/\/\s*>$/.test(matchedStopTag)) {
                  depth++;
                }
                searchPos = contentSearchRegex.lastIndex;
              }
              if (rawContentEnd !== -1) {
                const rawContent = buffer.substring(
                  contentStartIndex,
                  rawContentEnd,
                );
                addValueToObject(
                  stopNodeObject,
                  textNodeName,
                  rawContent,
                  // textNodeName, // Removed parameter
                  this.customOptions,
                );
                this.parsingIndex = rawContentEnd + closingTagLengthVal;
                this.incompleteStructureState = null;
              } else {
                const newPartialContent = buffer.substring(
                  contentStartIndex,
                  len,
                );
                addValueToObject(
                  stopNodeObject,
                  textNodeName,
                  newPartialContent,
                  // textNodeName, // Removed parameter
                  this.customOptions,
                );
                this.incompleteStructureState = {
                  type: "stop_node_content",
                  tagName,
                  depth,
                  contentStartIndex,
                  stopNodeObjectRef: stopNodeObject,
                  at: i,
                };
                this.parsingIndex = len;
                return;
              }
            } else {
              const newObjShell = { ...parsedAttributes };
              if (this.tagStack.length === 0) {
                this.accumulator.push({ [tagName]: newObjShell });
                if (!isSelfClosing) {
                  this.tagStack.push({
                    tagName,
                    objPtr: newObjShell,
                    path: currentPath,
                    textOnly: true,
                  });
                  this.currentPointer = newObjShell;
                } else {
                  this.currentPointer = null;
                }
              } else {
                if (this.tagStack.length > 0)
                  this.tagStack[this.tagStack.length - 1].textOnly = false;
                addValueToObject(
                  this.currentPointer,
                  tagName,
                  newObjShell,
                  // undefined, // Removed parameter
                  this.customOptions,
                );
                if (!isSelfClosing) {
                  this.tagStack.push({
                    tagName,
                    objPtr: newObjShell,
                    path: currentPath,
                    textOnly: true,
                  });
                  this.currentPointer = newObjShell;
                }
              }
              this.parsingIndex = i + tagString.length;
              this.incompleteStructureState = null;
            }
          } else {
            this.parsingIndex = this._handleFallbackText(
              buffer,
              i,
              textNodeName,
            );
          }
        }
      } else {
        let textEnd = buffer.indexOf("<", i);
        if (textEnd === -1) textEnd = len;
        const rawText = buffer.substring(i, textEnd);

        if (rawText.length > 0) {
          const decodedText = this._decodeXmlEntities(rawText);
          if (decodedText.trim().length > 0) {
            let processedContent = this.customOptions.parsePrimitives
              ? this._tryParsePrimitive(decodedText)
              : decodedText;

            if (this.tagStack.length > 0 && this.currentPointer) {
              if (this.tagStack.length > 0)
                this.tagStack[this.tagStack.length - 1].textOnly = false;
              addValueToObject(
                this.currentPointer,
                textNodeName,
                processedContent,
                // textNodeName, // Removed parameter
                this.customOptions,
              );
            } else if (this.tagStack.length === 0) {
              this.accumulator.push(processedContent);
            }
          }
        }
        this.parsingIndex = textEnd;
        this.incompleteStructureState = null;
      }
    }
  }

  _handleFallbackText(buffer, startIndex, textNodeName) {
    let endOfProblematicText = buffer.indexOf("<", startIndex + 1);
    if (endOfProblematicText === -1) endOfProblematicText = buffer.length;

    const fullFallbackText = buffer.substring(startIndex, endOfProblematicText);
    let textToProcessAsContent = fullFallbackText;
    let incompleteTagFragment = null; // Keep track of the fragment if it's identified as incomplete

    this.incompleteStructureState = null; // Reset by default

    // Only consider it an incomplete tag if it's at the very end of the current buffer processing window
    if (
      endOfProblematicText === buffer.length &&
      fullFallbackText.startsWith("<")
    ) {
      if (fullFallbackText === "<") {
        incompleteTagFragment = "<";
        this.incompleteStructureState = {
          type: "tag_start_incomplete",
          at: startIndex,
          partial: incompleteTagFragment,
        };
      } else if (fullFallbackText.startsWith("</")) {
        if (fullFallbackText.indexOf(">") === -1) {
          // e.g. "</foo"
          incompleteTagFragment = fullFallbackText;
          this.incompleteStructureState = {
            type: "closing_tag_incomplete",
            at: startIndex,
            partial: incompleteTagFragment,
          };
        }
      } else if (fullFallbackText.startsWith("<")) {
        // e.g. "<foo" or "<foo attr"
        const potentialTagNameMatch = fullFallbackText.match(/^<([\w:-]+)/);
        if (potentialTagNameMatch && fullFallbackText.indexOf(">") === -1) {
          incompleteTagFragment = fullFallbackText;
          this.incompleteStructureState = {
            type: "opening_tag_incomplete",
            at: startIndex,
            partial: incompleteTagFragment,
          };
        }
      }

      if (this.incompleteStructureState) {
        textToProcessAsContent = ""; // The fragment itself is not "text to process" in the generic sense.
        // It's an incomplete tag part.

        // Assign parent context for the incomplete state
        if (this.tagStack.length > 0 && this.currentPointer) {
          this.incompleteStructureState.parentOfPartial = this.currentPointer;
          // For the current partial result, if a chunk ends with an incomplete tag fragment
          // and we are inside an open tag, this fragment IS treated as text content of that parent.
          // This temporary text will be cleaned up by reparsedSegmentContext if the tag completes later.
          const fragmentText = this.incompleteStructureState.partial; // This is the raw fragment
          if (fragmentText && fragmentText.length > 0) {
            const decodedFragment = this._decodeXmlEntities(fragmentText);
            let processedFragment =
              this.customOptions.parsePrimitives &&
              typeof decodedFragment === "string"
                ? this._tryParsePrimitive(decodedFragment)
                : decodedFragment;

            // Add the processed fragment as text
            addValueToObject(
              this.currentPointer,
              textNodeName,
              processedFragment,
              // textNodeName, // Removed parameter
              this.customOptions,
            );
            // Store the exact processed fragment for cleanup
            this.incompleteStructureState.processedPartialForCleanup =
              processedFragment;

            if (
              this.tagStack.length > 0 &&
              this.tagStack[this.tagStack.length - 1].objPtr ===
                this.currentPointer
            ) {
              this.tagStack[this.tagStack.length - 1].textOnly = false;
            }
          }
        } else if (this.tagStack.length === 0) {
          // Incomplete tag at root
          this.incompleteStructureState.parentOfPartial = this.accumulator;
          // If at root, an incomplete tag fragment is generally not added as text to the accumulator.
          // No processedPartialForCleanup needed here as text isn't added to accumulator.
        }
      }
    }
    // If no incompleteStructureState was set (meaning fullFallbackText was not an incomplete tag start),
    // or if it was set but textToProcessAsContent is now empty,
    // textToProcessAsContent (which might be the original fullFallbackText or part of it before the fragment)
    // will be processed below.

    if (textToProcessAsContent.length > 0) {
      const decodedText = this._decodeXmlEntities(textToProcessAsContent);
      if (decodedText.trim().length > 0) {
        let processedContent = this.customOptions.parsePrimitives
          ? this._tryParsePrimitive(decodedText)
          : decodedText;
        if (this.tagStack.length > 0 && this.currentPointer) {
          if (this.tagStack.length > 0)
            this.tagStack[this.tagStack.length - 1].textOnly = false;
          addValueToObject(
            this.currentPointer,
            textNodeName,
            processedContent,
            // textNodeName, // Removed parameter
            this.customOptions,
          );
        } else if (this.tagStack.length === 0) {
          this.accumulator.push(processedContent);
        }
      }
    }
    // If an incomplete state was set, it remains. Otherwise, it's null.
    return endOfProblematicText;
  }

  parseStream(xmlChunk) {
    let currentXmlString = "";
    if (xmlChunk === null || xmlChunk === undefined) {
      this._activelyStreaming = false;
    } else if (typeof xmlChunk === "string") {
      currentXmlString = xmlChunk;
    } else if (xmlChunk && typeof xmlChunk.toString === "function") {
      currentXmlString = xmlChunk.toString();
    } else if (xmlChunk !== "") {
      throw new Error(
        "XML chunk for 'parseStream' is accepted in String, Buffer, null, undefined or empty string form.",
      );
    }

    // If there's a pending incomplete fragment from a previous chunk,
    // prepend it to the current chunk's data before adding to the main buffer.
    let combinedXmlString = currentXmlString;
    let parentContextForReparse = null; // Re-declare and initialize
    const originalIncompleteState = this.incompleteStructureState; // Capture before it's potentially nulled

    if (originalIncompleteState && originalIncompleteState.partial) {
      // Assign parentContextForReparse if parentOfPartial exists on the original state
      if (originalIncompleteState.parentOfPartial) {
        parentContextForReparse = originalIncompleteState.parentOfPartial;
      }
      const fragment = originalIncompleteState.partial; // This is the raw fragment

      // Prepend fragment to current chunk's data.
      // The check `currentXmlString || !this.streamingBuffer.startsWith(fragment)`
      // was an attempt to avoid double prepending. Simpler to always prepend
      // if a fragment exists and rely on parsingIndex=0.
      combinedXmlString = fragment + currentXmlString;
      this.parsingIndex = 0; // Reparse from start of combined string

      // Set up reparse context ONLY if the incomplete state was for a tag fragment
      // AND its parentOfPartial was an object (implying temporary text was added to an element).
      if (
        (originalIncompleteState.type === "opening_tag_incomplete" ||
          originalIncompleteState.type === "closing_tag_incomplete" ||
          originalIncompleteState.type === "tag_start_incomplete") &&
        originalIncompleteState.parentOfPartial &&
        typeof originalIncompleteState.parentOfPartial === "object" &&
        !Array.isArray(originalIncompleteState.parentOfPartial)
      ) {
        // Use processedPartialForCleanup if available (it should be if text was added to an object).
        // This ensures the cleanup logic uses the same version of the text (decoded, etc.) as was added.
        const textToCleanup =
          originalIncompleteState.processedPartialForCleanup !== undefined
            ? originalIncompleteState.processedPartialForCleanup
            : fragment; // Fallback to raw fragment if processed one isn't there

        this.reparsedSegmentContext = {
          partialText: textToCleanup,
          parentContext: originalIncompleteState.parentOfPartial,
        };
      }
      this.incompleteStructureState = null; // Clear the state after using its data
    }

    if (combinedXmlString) {
      if (!this._activelyStreaming && combinedXmlString.trim().length > 0) {
        this._activelyStreaming = true;
        this._originalBufferHadContent = true; // Mark that buffer received content
      }
      // If parsingIndex was reset, we are effectively replacing the buffer start
      // or prepending. Otherwise, it's a normal append.
      if (this.parsingIndex === 0 && combinedXmlString !== currentXmlString) {
        // Prepend happened
        this.streamingBuffer =
          combinedXmlString +
          this.streamingBuffer.substring(
            currentXmlString.length > 0
              ? 0
              : this.incompleteStructureState?.partial?.length || 0,
          );
        // The above line is a bit complex, aiming to avoid duplicating the original currentXmlString if it was empty
        // A simpler approach if parsingIndex is 0 due to fragment prepend:
        this.streamingBuffer = combinedXmlString; // The new chunk is now part of combinedXmlString
        // and old buffer content (if any beyond the fragment) needs careful handling.
        // Let's simplify: if a fragment was prepended, the new streamingBuffer
        // starts with this combined string.
        // Any *previous* buffer content not part of the fragment is lost.
        // This assumes _processBuffer consumes what it can, and slices.
        // So, if a fragment was prepended, the new buffer IS the fragment + new chunk.
      } else {
        this.streamingBuffer += combinedXmlString; // Normal append or if combinedXmlString is just currentXmlString
      }

      // If a fragment was prepended, ensure parsingIndex is 0 for the _processBuffer call.
      // This was already set when incompleteStructureState.partial was handled.
    } else if (xmlChunk === "" && !this._activelyStreaming) {
      // If first chunk is empty string, mark that we've started but no real content yet
      this._originalBufferHadContent = false;
    }

    const isFreshParserCall =
      this.accumulator.length === 0 &&
      this.tagStack.length === 0 &&
      !this.incompleteStructureState && // This might be null now if a fragment was just consumed
      this.parsingIndex === 0 &&
      this.streamingBuffer === combinedXmlString; // True if this is the first chunk ever (or first after fragment merge)

    if (
      isFreshParserCall &&
      combinedXmlString === "" &&
      (xmlChunk === "" || xmlChunk === null || xmlChunk === undefined)
    ) {
      // Handles:
      // 1. Empty string as the very first chunk.
      // 2. Null/undefined as the very first chunk (buffer is empty).
      // 3. An incomplete fragment was the only thing, and then null/EOF arrived.
      if (xmlChunk === null || xmlChunk === undefined) {
        return { metadata: { partial: false }, xml: null }; // Empty stream, ended.
      } else {
        return { metadata: { partial: true }, xml: null }; // Empty first chunk, more might come.
      }
    }

    // If an incomplete state existed and was consumed by prepending,
    // and the new chunk (currentXmlString) is empty, and it's not EOF.
    // This means we only processed the fragment.
    // Commenting out this block as it's causing ReferenceError and its necessity is unclear
    // with the current fragment prepending strategy.
    // if (parentContextForReparse && currentXmlString === "" && xmlChunk !== null && xmlChunk !== undefined) {
    //     // The fragment was prepended, parsingIndex reset, _processBuffer will run.
    //     // If _processBuffer doesn't fully resolve it, incompleteStructureState might be set again.
    //     // The existing logic for returning partial based on accumulator/tagStack/incompleteState should cover this.
    // }

    if (xmlChunk === null || xmlChunk === undefined) {
      // End of stream signaled
      this.streamingBufferBeforeClear = this.streamingBuffer; // Save before potential clear
    }

    // This specific block for empty string chunk while incomplete state exists might be redundant
    // if the fragment prepending logic correctly sets up the buffer for _processBuffer.
    // Let's re-evaluate if this is still needed after the prepend logic.
    // For now, commenting out as the prepend should handle merging.
    // if (
    //   this.streamingBuffer.length === this.parsingIndex &&
    //   xmlChunk !== null &&
    //   xmlChunk !== undefined &&
    //   typeof currentXmlString === "string" &&
    //   currentXmlString.length === 0 &&
    //   this.incompleteStructureState // This would be a *new* incomplete state after processing the fragment
    // ) {
    //   return {
    //     metadata: { partial: true },
    //     xml: this.accumulator.length > 0 ? this.accumulator : [],
    //   };
    // }

    this._processBuffer();

    // After _processBuffer, if a reparsedSegmentContext was created due to the prepended fragment
    // and it involved a parentContextForReparse, we might need to ensure linkage.
    // However, the standard addValueToObject should handle this if the tag is correctly formed.
    // The main challenge is ensuring _processBuffer correctly parses the combined string.

    // Slice the buffer if parsingIndex has advanced to free up memory
    if (this.parsingIndex > 0) {
      const sliceAmount = this.parsingIndex;

      // Adjust state indices BEFORE slicing the buffer string itself,
      // as they are relative to the current (un-sliced) buffer.
      if (
        this.incompleteStructureState &&
        this.incompleteStructureState.at !== undefined
      ) {
        this.incompleteStructureState.at -= sliceAmount;
        // Safeguard against negative indices, though ideally this shouldn't happen with correct parsing logic.
        if (this.incompleteStructureState.at < 0) {
          // This case should ideally not be hit if parsingIndex is managed correctly
          // with prepended fragments. If 'at' becomes negative, it implies an issue.
          // For safety, reset to 0, but log or debug if this happens.
          // console.warn("Incomplete state 'at' became negative:", this.incompleteStructureState);
          this.incompleteStructureState.at = 0;
        }

        if (
          this.incompleteStructureState.type === "stop_node_content" &&
          this.incompleteStructureState.contentStartIndex !== undefined
        ) {
          this.incompleteStructureState.contentStartIndex -= sliceAmount;
          if (this.incompleteStructureState.contentStartIndex < 0)
            this.incompleteStructureState.contentStartIndex = 0;
        }
        // No changes needed for 'partialData' types like cdata, comment, doctype, xmldecl here,
        // as their 'at' is mostly for identifying the start of the special sequence,
        // and continuation relies on finding the end marker from the current parsingIndex.
      }
      // Adjust reparse context if it exists and is based on an index within the sliced part
      if (
        this.reparsedSegmentContext &&
        this.reparsedSegmentContext.originalIndex !== undefined
      ) {
        if (this.reparsedSegmentContext.originalIndex < sliceAmount) {
          // The reparse point was within the sliced part.
          // This might mean the reparse context is now invalid or needs complex adjustment.
          // For simplicity, if the reparse point is sliced away, clear it.
          // This assumes that if a fragment was prepended and fully parsed,
          // the reparse context related to its *initial* partial state is no longer needed.
          // console.warn("Reparsed segment context originalIndex was sliced away:", this.reparsedSegmentContext.originalIndex, sliceAmount);
          this.reparsedSegmentContext = null;
        } else {
          this.reparsedSegmentContext.originalIndex -= sliceAmount;
        }
      }

      this.streamingBuffer = this.streamingBuffer.substring(sliceAmount);
      this.parsingIndex = 0; // Reset parsingIndex as it's relative to the new buffer start
    }

    let finalXmlContent = this.accumulator.length > 0 ? this.accumulator : [];
    let isReturnPartial =
      this.tagStack.length > 0 || !!this.incompleteStructureState;

    // Initial check for partial based on incomplete states that are not EOF-specific yet
    if (this.incompleteStructureState) {
      const { type, at } = this.incompleteStructureState;
      if (type === "stop_node_content" || type === "cdata") {
        isReturnPartial = true;
      } else if (
        at !== undefined &&
        this.streamingBuffer.length > 0 &&
        at >= this.streamingBuffer.length
      ) {
        // If 'at' points to or beyond the end of the current buffer for other types, it's likely partial.
        // This handles cases like "tag_start_incomplete" at the very end.
        isReturnPartial = true;
      }
    }

    if (xmlChunk === null || xmlChunk === undefined) {
      // End of stream processing
      this._lastClearedIncompleteStateWasSpecial = false; // Reset flag

      if (this.incompleteStructureState) {
        const stateType = this.incompleteStructureState.type;
        const isSpecialIncomplete =
          stateType === "doctype" ||
          stateType === "xmldecl" ||
          stateType === "comment";

        if (
          isSpecialIncomplete &&
          this.accumulator.length === 0 &&
          this.tagStack.length === 0
        ) {
          // If the only substantive thing is an unclosed special declaration (e.g. "<!DOCTYPE test" then EOF)
          // Treat as non-partial, with an empty XML result.
          isReturnPartial = false;
          // finalXmlContent will be handled by the !isReturnPartial block below, ensuring it becomes []
          this.incompleteStructureState = null; // Clear the state
          this._lastClearedIncompleteStateWasSpecial = true; // Mark that a special tag was cleared this way
        } else {
          // Other incomplete types (cdata, stop_node, incomplete tags),
          // or special incomplete types mixed with other parsed content/tags, remain partial.
          isReturnPartial = true;
        }
      } else if (this.tagStack.length > 0) {
        isReturnPartial = true; // Unclosed regular tags
      } else {
        // No incomplete state, no unclosed tags
        isReturnPartial = false;
      }

      if (!isReturnPartial) {
        // This block determines finalXmlContent (null vs []) for non-partial results.
        const effectiveBufferContent =
          this.streamingBufferBeforeClear || this.streamingBuffer;
        const tempBufferForNullCheck = effectiveBufferContent
          .replace(/<\?xml[^?]*\?>/g, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<!DOCTYPE[^>]*>/g, "")
          .trim();

        if (this.accumulator.length === 0 && tempBufferForNullCheck === "") {
          // Accumulator is empty, and buffer (after stripping specials) is also empty.
          if (this._lastClearedIncompleteStateWasSpecial) {
            // If we just cleared an unclosed special tag as the only content.
            finalXmlContent = [];
          } else if (
            !this._originalBufferHadContent &&
            effectiveBufferContent === ""
          ) {
            // Truly empty input from start to end (no chunks ever had non-whitespace).
            finalXmlContent = null;
          } else {
            // Buffer had some content (e.g. only comments, or only an unclosed special tag that wasn't cleared by the above)
            // which all reduced to nothing. Or, it was an empty stream from the start.
            finalXmlContent = [];
          }
        } else if (
          this.accumulator.length === 0 &&
          tempBufferForNullCheck !== ""
        ) {
          // Accumulator empty, but buffer had some non-special, non-empty text that didn't form elements.
          finalXmlContent = [];
        } else {
          // Accumulator has content, use it.
          finalXmlContent = this.accumulator.length > 0 ? this.accumulator : [];
        }

        this.streamingBuffer = "";
        this.parsingIndex = 0;
        this._activelyStreaming = false;
        this._originalBufferHadContent = false;
        this.incompleteStructureState = null;
        this.streamingBufferBeforeClear = "";
      } else {
        // If isReturnPartial is true, finalXmlContent is already based on this.accumulator
        // (or potentially an empty array if accumulator is empty but still partial)
        finalXmlContent = this.accumulator.length > 0 ? this.accumulator : [];
      }
    }

    const result = {
      metadata: { partial: isReturnPartial },
      xml: finalXmlContent,
    };

    // Final check for specific null case: stream ends, not partial, accumulator empty, and original buffer was effectively empty.
    if (
      (xmlChunk === null || xmlChunk === undefined) &&
      !result.metadata.partial &&
      result.xml &&
      result.xml.length === 0
    ) {
      const effectiveBuffer =
        this.streamingBufferBeforeClear !== undefined
          ? this.streamingBufferBeforeClear
          : this.streamingBuffer;
      const tempBuffer = effectiveBuffer
        .replace(/<\?xml[^?]*\?>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<!DOCTYPE[^>]*>/g, "")
        .trim();
      if (tempBuffer === "" && !this._originalBufferHadContent) {
        // Check if buffer ever had meaningful content
        result.xml = null;
      } else if (tempBuffer === "") {
        // If buffer had content but it all reduced to nothing (e.g. only comments)
        // and accumulator is empty, result.xml should be [] (empty array), not null.
        // This is typically handled by finalXmlContent defaulting to [].
        // However, if it became null above, this might need adjustment.
        // The current logic: if finalXmlContent became null, it stays null.
        // If it was [], it stays [].
      }
    }
    // If stream ends, and it's the very first call with null/undefined, and buffer is empty
    if (
      (xmlChunk === null || xmlChunk === undefined) &&
      isFreshParserCall &&
      this.streamingBuffer.trim() === ""
    ) {
      result.xml = [];
      result.metadata.partial = false;
    }

    return result;
  }
}

module.exports = PartialXMLStreamParser;
