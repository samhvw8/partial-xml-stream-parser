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
  customOptions,
) => {
  const effectiveTextNodeName = customOptions.textNodeName;
  const alwaysCreate = customOptions.alwaysCreateTextNode;

  if (obj.hasOwnProperty(key)) {
    if (alwaysCreate) {
      if (key === effectiveTextNodeName) {
        if (typeof obj[key] === "string" && typeof value === "string") {
          obj[key] += value;
        } else {
          if (!Array.isArray(obj[key])) {
            obj[key] = [obj[key]];
          }
          obj[key].push(value);
        }
      } else {
        if (!Array.isArray(obj[key])) {
          obj[key] = [obj[key]];
        }
        obj[key].push(value);
      }
    } else {
      if (
        key === effectiveTextNodeName &&
        typeof obj[key] === "string" &&
        typeof value === "string"
      ) {
        obj[key] += value;
      } else {
        if (!Array.isArray(obj[key])) {
          obj[key] = [obj[key]];
        }
        obj[key].push(value);
      }
    }
  } else {
    obj[key] = value;
  }
};

class PartialXMLStreamParser {
  constructor(options) {
    const mergedOptions = { ...DEFAULT_STREAM_OPTIONS, ...options };
    this.customOptions = mergedOptions;

    if (mergedOptions.allowedRootNodes) {
      if (Array.isArray(mergedOptions.allowedRootNodes) && mergedOptions.allowedRootNodes.length > 0) {
        this.allowedRootNodes = new Set(mergedOptions.allowedRootNodes);
      } else if (typeof mergedOptions.allowedRootNodes === 'string') {
        this.allowedRootNodes = new Set([mergedOptions.allowedRootNodes]);
      } else if (Array.isArray(mergedOptions.allowedRootNodes) && mergedOptions.allowedRootNodes.length === 0) {
        this.allowedRootNodes = null; // Empty array means parse all as XML
      } else {
        this.allowedRootNodes = null; // Default to no restrictions
      }
    } else {
      this.allowedRootNodes = null; // No restrictions
    }

    this.attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
    this.commentRegex = /<!--/g;
    this.cdataOpenRegex = /<!\[CDATA\[/g;
    this.doctypeRegex = /<!DOCTYPE/g;
    this.xmlDeclRegex = /<\?xml/g;

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
    this.streamingBufferBeforeClear = "";
    this._originalBufferHadContent = false;
    this._lastClearedIncompleteStateWasSpecial = false;

    this._rootDeterminationBuffer = "";
    this._plainTextAccumulator = "";
    this._treatAsPlainText = false;
    this._rootTagDecisionMade = false;
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
    if (value === "true") return true;
    if (value === "false") return false;
    if (lowerVal === "true" && value.length === 4) return true;
    if (lowerVal === "false" && value.length === 5) return false;

    const trimmedValueForCheck = value.trim();
    if (
      trimmedValueForCheck.length > 0 &&
      !isNaN(Number(trimmedValueForCheck))
    ) {
      const num = Number(trimmedValueForCheck);
      if (String(num) === trimmedValueForCheck) {
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
            const fullContent = (state.partialData || "") + newContentSegment;
            if (fullContent.length > 0) { 
              let textToAdd = this.customOptions.parsePrimitives
                ? this._tryParsePrimitive(fullContent)
                : fullContent;
              if (this.tagStack.length > 0 && this.currentPointer) {
                addValueToObject(
                  this.currentPointer,
                  textNodeName,
                  textToAdd,
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
            if (newPartialContent.length > 0) {
              state.partialData = (state.partialData || "") + newPartialContent;
              if (this.tagStack.length > 0 && this.currentPointer) {
                addValueToObject(this.currentPointer, textNodeName, newPartialContent, this.customOptions);
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
              this.parsingIndex,
              rawContentEnd,
            );
            addValueToObject(
              stopNodeObjectRef,
              textNodeName,
              newContentSegment,
              this.customOptions,
            );
            this.parsingIndex = rawContentEnd + closingTagLength;
            this.incompleteStructureState = null;
          } else {
            const newPartialContent = buffer.substring(this.parsingIndex, len);
            if (newPartialContent.length > 0) {
              addValueToObject(
                stopNodeObjectRef,
                textNodeName,
                newPartialContent,
                this.customOptions,
              );
            }
            this.parsingIndex = len;
            this.incompleteStructureState.depth = stopNodeDepth;
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
          this.parsingIndex = len;
          return;
        }

        let matchedSpecialPrefix = false;
        const charAfterLT = buffer[i + 1];

        if (charAfterLT === "?") {
          if (buffer.startsWith("<?xml", i)) {
            const endDeclaration = buffer.indexOf("?>", i + 5);
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
        } else if (charAfterLT === "!") {
          if (i + 3 < len && buffer[i + 2] === "-" && buffer[i + 3] === "-") { // <!--
            const commentEnd = buffer.indexOf("-->", i + 4);
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
          else if (buffer.startsWith("<![CDATA[", i)) {
            const cdataOpenTagEnd = i + 9;
            const cdataCloseMarker = "]]>";
            const cdataEnd = buffer.indexOf(cdataCloseMarker, cdataOpenTagEnd);
            if (cdataEnd === -1) {
              const partialContent = buffer.substring(cdataOpenTagEnd, len);
              if (this.tagStack.length > 0 && this.currentPointer) {
                  addValueToObject(this.currentPointer, textNodeName, partialContent, this.customOptions);
              } else if (this.tagStack.length === 0) {
                  if (!this.incompleteStructureState || this.incompleteStructureState.type !== 'cdata') {
                      this.accumulator.push(partialContent);
                  } else { 
                      this.incompleteStructureState.partialData = (this.incompleteStructureState.partialData || "") + partialContent;
                  }
              }
              this.incompleteStructureState = {
                type: "cdata",
                lookingFor: cdataCloseMarker,
                at: i, 
                partialData: (this.incompleteStructureState?.partialData || "") + partialContent, 
              };
              this.parsingIndex = len;
              return;
            } else {
              let text = buffer.substring(cdataOpenTagEnd, cdataEnd);
              this.parsingIndex = cdataEnd + cdataCloseMarker.length;
              const processedCDATA = this.customOptions.parsePrimitives
                ? this._tryParsePrimitive(text)
                : text;
              const fullText = (this.incompleteStructureState?.partialData || "") + processedCDATA;

              if (fullText.length > 0 ) { 
                if (this.tagStack.length > 0 && this.currentPointer) {
                  addValueToObject(
                    this.currentPointer,
                    textNodeName,
                    fullText,
                    this.customOptions,
                  );
                } else if (this.tagStack.length === 0) {
                  this.accumulator.push(fullText);
                }
              }
              this.incompleteStructureState = null;
            }
            matchedSpecialPrefix = true;
          }
          else if (buffer.startsWith("<!DOCTYPE", i)) {
            const endDoctype = buffer.indexOf(">", i + 9);
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
            if (
              this.reparsedSegmentContext &&
              this.reparsedSegmentContext.parentContext &&
              this.reparsedSegmentContext.partialText !== undefined &&
              this.currentPointer === this.reparsedSegmentContext.parentContext
            ) {
              const { partialText, parentContext } =
                this.reparsedSegmentContext;
              const textNodeNameToUse = this.customOptions.textNodeName;

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
            this.reparsedSegmentContext = null;

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
      } else { // Not starting with '<'
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
    let incompleteTagFragment = null;

    this.incompleteStructureState = null;

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
          incompleteTagFragment = fullFallbackText;
          this.incompleteStructureState = {
            type: "closing_tag_incomplete",
            at: startIndex,
            partial: incompleteTagFragment,
          };
        }
      } else if (fullFallbackText.startsWith("<")) {
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
        textToProcessAsContent = "";
        if (this.tagStack.length > 0 && this.currentPointer) {
          this.incompleteStructureState.parentOfPartial = this.currentPointer;
          const fragmentText = this.incompleteStructureState.partial;
          if (fragmentText && fragmentText.length > 0) {
            const decodedFragment = this._decodeXmlEntities(fragmentText);
            let processedFragment =
              this.customOptions.parsePrimitives &&
              typeof decodedFragment === "string"
                ? this._tryParsePrimitive(decodedFragment)
                : decodedFragment;
            
            this.incompleteStructureState.processedPartialForCleanup = processedFragment;

            let skipAddingProvisionalText = false;
            if (
              this.reparsedSegmentContext &&
              this.reparsedSegmentContext.parentContext ===
                this.incompleteStructureState.parentOfPartial &&
              this.reparsedSegmentContext.partialText === processedFragment
            ) {
              skipAddingProvisionalText = true;
            }

            if (!skipAddingProvisionalText && this.incompleteStructureState.parentOfPartial === this.currentPointer) {
              addValueToObject(
                this.currentPointer,
                textNodeName,
                processedFragment,
                this.customOptions,
              );
              if (
                this.tagStack.length > 0 &&
                this.tagStack[this.tagStack.length - 1].objPtr ===
                  this.currentPointer
              ) {
                this.tagStack[this.tagStack.length - 1].textOnly = false;
              }
            }
          }
        } else if (this.tagStack.length === 0) {
          this.incompleteStructureState.parentOfPartial = this.accumulator;
        }
      }
    }

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
            this.customOptions,
          );
        } else if (this.tagStack.length === 0) {
          this.accumulator.push(processedContent);
        }
      }
    }
    return endOfProblematicText;
  }

  parseStream(xmlChunk) {
    let currentXmlString = "";
    if (xmlChunk === null || xmlChunk === undefined) {
      // EOF, specific handling below
    } else if (typeof xmlChunk === "string") {
      currentXmlString = xmlChunk;
    } else if (xmlChunk && typeof xmlChunk.toString === "function") {
      currentXmlString = xmlChunk.toString();
    } else if (xmlChunk !== "") {
      throw new Error(
        "XML chunk for 'parseStream' is accepted in String, Buffer, null, undefined or empty string form.",
      );
    }
    
    const isFirstEverChunk = !this._originalBufferHadContent && this.streamingBuffer === "" && this._rootDeterminationBuffer === "" && this._plainTextAccumulator === "" && this.accumulator.length === 0 && this.tagStack.length === 0;
    if (!this._originalBufferHadContent && currentXmlString.length > 0) {
        this._originalBufferHadContent = true;
    }

    // --- BEGIN Conditional XML Parsing Logic ---
    if (this._treatAsPlainText) {
      if (xmlChunk !== null && currentXmlString) {
        this._plainTextAccumulator += currentXmlString;
      }
      const isPartialPlainText = xmlChunk !== null;
      let resultXml = [];
      if (this._plainTextAccumulator.length > 0) { 
        resultXml = [this._plainTextAccumulator];
      } else if (xmlChunk === null && !this._originalBufferHadContent && this._plainTextAccumulator === "") {
        resultXml = null;
      }
      return { metadata: { partial: isPartialPlainText }, xml: resultXml };
    }

    if (this.allowedRootNodes && !this._rootTagDecisionMade) {
      if (currentXmlString) {
        this._rootDeterminationBuffer += currentXmlString;
      }

      const bufferToInspect = this._rootDeterminationBuffer;
      const trimmedBufferForTagCheck = bufferToInspect.trimStart();

      if (trimmedBufferForTagCheck.length > 0) {
        if (trimmedBufferForTagCheck.startsWith("<")) {
          const tagMatch = STATIC_OPENING_TAG_REGEX.exec(trimmedBufferForTagCheck);
          if (tagMatch) { 
            const rootTagName = tagMatch[1];
            if (this.allowedRootNodes.has(rootTagName)) {
              this._rootTagDecisionMade = true;
              currentXmlString = bufferToInspect; 
              this.streamingBuffer = ""; 
              this.parsingIndex = 0;
              this._rootDeterminationBuffer = "";
            } else { 
              this._treatAsPlainText = true;
              this._rootTagDecisionMade = true;
              this._plainTextAccumulator = bufferToInspect;
              this._rootDeterminationBuffer = "";
              return { metadata: { partial: xmlChunk !== null }, xml: [this._plainTextAccumulator] };
            }
          } else { 
            const partialTagNameMatch = trimmedBufferForTagCheck.match(/^<([\w:-]+)/);
            if (xmlChunk === null) { 
                this._treatAsPlainText = true;
                this._rootTagDecisionMade = true;
                this._plainTextAccumulator = bufferToInspect;
                this._rootDeterminationBuffer = "";
                return { metadata: { partial: false }, xml: [this._plainTextAccumulator] };
            } else if (partialTagNameMatch) { 
                const potentialTagName = partialTagNameMatch[1];
                const isPotentiallyAllowed = [...this.allowedRootNodes].some(ar => ar.startsWith(potentialTagName));
                const isExactButIncompleteAllowed = this.allowedRootNodes.has(potentialTagName);

                if (isExactButIncompleteAllowed || isPotentiallyAllowed) {
                    return { metadata: { partial: true }, xml: [] }; 
                } else { 
                    this._treatAsPlainText = true;
                    this._rootTagDecisionMade = true;
                    this._plainTextAccumulator = bufferToInspect;
                    this._rootDeterminationBuffer = "";
                    return { metadata: { partial: true }, xml: [this._plainTextAccumulator] };
                }
            } else { 
                return { metadata: { partial: true }, xml: [] }; 
            }
          }
        } else { 
          this._treatAsPlainText = true;
          this._rootTagDecisionMade = true;
          this._plainTextAccumulator = bufferToInspect; 
          this._rootDeterminationBuffer = "";
          return { metadata: { partial: xmlChunk !== null }, xml: [this._plainTextAccumulator] };
        }
      } else { 
        if (xmlChunk === null) { 
            this._rootTagDecisionMade = true;
            if (bufferToInspect.length > 0) { 
                this._treatAsPlainText = true;
                this._plainTextAccumulator = bufferToInspect;
                this._rootDeterminationBuffer = "";
                return { metadata: { partial: false }, xml: [this._plainTextAccumulator] };
            } else { 
                this._rootDeterminationBuffer = "";
                return { metadata: { partial: false }, xml: null };
            }
        } else { 
            if (bufferToInspect.length > 0) { 
                this._treatAsPlainText = true; 
                this._rootTagDecisionMade = true;
                this._plainTextAccumulator = bufferToInspect;
                this._rootDeterminationBuffer = "";
                return { metadata: { partial: true }, xml: [this._plainTextAccumulator] };
            } else { 
                 if (isFirstEverChunk && currentXmlString === "") { 
                    return { metadata: { partial: true }, xml: null };
                 }
                 return { metadata: { partial: true }, xml: [] };
            }
        }
      }
    } else if (!this.allowedRootNodes && !this._rootTagDecisionMade) {
      this._rootTagDecisionMade = true; 
    }
    // --- END Conditional XML Parsing Logic ---
    
    if (xmlChunk === null || xmlChunk === undefined) {
        this._activelyStreaming = false;
    } else if (currentXmlString || (this.streamingBuffer && this.streamingBuffer.length > 0) || (this.accumulator && this.accumulator.length > 0)) {
        if (!this._activelyStreaming && (currentXmlString.trim().length > 0 || (this.streamingBuffer.trim().length > 0 && this.parsingIndex < this.streamingBuffer.length))) {
            this._activelyStreaming = true;
        }
    }

    let combinedXmlString = currentXmlString;
    const originalIncompleteState = this.incompleteStructureState; 

    if (originalIncompleteState && originalIncompleteState.partial) {
      const fragment = originalIncompleteState.partial; 
      combinedXmlString = fragment + currentXmlString;
      this.parsingIndex = 0; 

      if (
        (originalIncompleteState.type === "opening_tag_incomplete" ||
          originalIncompleteState.type === "closing_tag_incomplete" ||
          originalIncompleteState.type === "tag_start_incomplete") &&
        originalIncompleteState.parentOfPartial &&
        typeof originalIncompleteState.parentOfPartial === "object" &&
        !Array.isArray(originalIncompleteState.parentOfPartial)
      ) {
        const textToCleanup =
          originalIncompleteState.processedPartialForCleanup !== undefined
            ? originalIncompleteState.processedPartialForCleanup
            : fragment; 

        this.reparsedSegmentContext = {
          partialText: textToCleanup,
          parentContext: originalIncompleteState.parentOfPartial,
        };
      }
      this.incompleteStructureState = null; 
    }

    if (combinedXmlString) {
      if (!this._activelyStreaming && combinedXmlString.trim().length > 0) {
        this._activelyStreaming = true;
      }
      if (
        this.parsingIndex === 0 && 
        originalIncompleteState &&
        originalIncompleteState.partial && 
        combinedXmlString.startsWith(originalIncompleteState.partial) && 
        combinedXmlString !== currentXmlString 
      ) {
        this.streamingBuffer = combinedXmlString;
      } else {
        this.streamingBuffer += combinedXmlString;
      }
    } else if (xmlChunk === "" && isFirstEverChunk) {
      // Handled by the isFreshParserCallForEmptyStream check below
    }

    const isFreshParserCallForEmptyStreamCheck = 
      this.accumulator.length === 0 &&
      this.tagStack.length === 0 &&
      !this.incompleteStructureState &&
      this.parsingIndex === 0 &&
      this.streamingBuffer === "" && 
      this._rootDeterminationBuffer === "" && 
      this._plainTextAccumulator === "";

    if (
      isFreshParserCallForEmptyStreamCheck &&
      currentXmlString === "" && 
      (xmlChunk === "" || xmlChunk === null || xmlChunk === undefined)
    ) {
      if (xmlChunk === null || xmlChunk === undefined) { 
        return { metadata: { partial: false }, xml: null }; 
      } else { 
        return { metadata: { partial: true }, xml: null }; 
      }
    }

    if (xmlChunk === null || xmlChunk === undefined) {
      this.streamingBufferBeforeClear = this.streamingBuffer; 
    }

    this._processBuffer();

    if (this.parsingIndex > 0) {
      const sliceAmount = this.parsingIndex;

      if (
        this.incompleteStructureState &&
        this.incompleteStructureState.at !== undefined
      ) {
        this.incompleteStructureState.at -= sliceAmount;
        if (this.incompleteStructureState.at < 0) {
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
      }
      if (
        this.reparsedSegmentContext &&
        this.reparsedSegmentContext.originalIndex !== undefined
      ) {
        if (this.reparsedSegmentContext.originalIndex < sliceAmount) {
          this.reparsedSegmentContext = null;
        } else {
          this.reparsedSegmentContext.originalIndex -= sliceAmount;
        }
      }

      this.streamingBuffer = this.streamingBuffer.substring(sliceAmount);
      this.parsingIndex = 0; 
    }

    let finalXmlContent = this.accumulator.length > 0 ? this.accumulator : [];
    let isReturnPartial =
      this.tagStack.length > 0 || !!this.incompleteStructureState;
    
    let isSpecialOnlyAtEOF = false; // Renamed from isSpecialOnlyAndClearedAtEOF for clarity

    if (xmlChunk === null || xmlChunk === undefined) { // EOF
      if (this.incompleteStructureState) {
        const stateType = this.incompleteStructureState.type;
        const isSpecialIncomplete = stateType === "doctype" || stateType === "xmldecl" || stateType === "comment";
        
        if (isSpecialIncomplete && this.accumulator.length === 0 && this.tagStack.length === 0) {
          const remainingBufferIsJustPartial = (this.streamingBufferBeforeClear || this.streamingBuffer).trim() === (this.incompleteStructureState.partial || "").trim();
          if (remainingBufferIsJustPartial) {
            isReturnPartial = false;
            this.incompleteStructureState = null; 
            isSpecialOnlyAtEOF = true; 
            finalXmlContent = []; 
          } else { 
            isReturnPartial = true;
          }
        } else if ( (stateType === "opening_tag_incomplete" || stateType === "tag_start_incomplete" || stateType === "closing_tag_incomplete") && this.incompleteStructureState.partial) {
            isReturnPartial = true; 
            const fragment = this.incompleteStructureState.partial;
            if (this.accumulator.length === 0 && !this._treatAsPlainText) { 
                finalXmlContent = [{ [this.customOptions.textNodeName]: fragment }];
            } else if (this.tagStack.length > 0 && this.currentPointer && !this._treatAsPlainText) { 
                 let needsAdding = true;
                 if (this.currentPointer.hasOwnProperty(this.customOptions.textNodeName)) {
                    const currentText = this.currentPointer[this.customOptions.textNodeName];
                    if ((typeof currentText === 'string' && currentText.endsWith(fragment)) || 
                        (Array.isArray(currentText) && currentText.some(t => typeof t === 'string' && t.endsWith(fragment)))) {
                        needsAdding = false;
                    }
                 }
                 if(needsAdding) addValueToObject(this.currentPointer, this.customOptions.textNodeName, fragment, this.customOptions);
                 finalXmlContent = this.accumulator.length > 0 ? this.accumulator : []; 
            }
        } else { 
          isReturnPartial = true;
        }
      } else if (this.tagStack.length > 0) {
        isReturnPartial = true; 
      } else {
        isReturnPartial = false;
      }

      if (!isReturnPartial) {
        const effectiveBufferContent = this.streamingBufferBeforeClear || this.streamingBuffer;
        const tempBufferForNullCheck = effectiveBufferContent.replace(/<\?xml[^?]*\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/g, "").trim();

        if (isSpecialOnlyAtEOF) { 
            finalXmlContent = [];
        } else if (this.accumulator.length === 0 && tempBufferForNullCheck === "") {
             if (!this._originalBufferHadContent && effectiveBufferContent === "") {
                finalXmlContent = null;
            } else {
                finalXmlContent = [];
            }
        } else if (this.accumulator.length === 0 && tempBufferForNullCheck !== "" && !this._treatAsPlainText) {
            finalXmlContent = [tempBufferForNullCheck]; 
        } else if (this.accumulator.length > 0) {
            finalXmlContent = this.accumulator;
        } else { 
            finalXmlContent = [];
        }

        this.streamingBuffer = ""; this.parsingIndex = 0; this._activelyStreaming = false;
        this._originalBufferHadContent = false; this.incompleteStructureState = null;
        this.streamingBufferBeforeClear = ""; this._lastClearedIncompleteStateWasSpecial = isSpecialOnlyAtEOF;
      } else { 
         if (!(this.incompleteStructureState && (this.incompleteStructureState.type === "opening_tag_incomplete" || this.incompleteStructureState.type === "tag_start_incomplete" || this.incompleteStructureState.type === "closing_tag_incomplete"))) {
            finalXmlContent = this.accumulator.length > 0 ? this.accumulator : [];
        }
        if (this.incompleteStructureState) this.reparsedSegmentContext = null;
      }
    }

    const result = {
      metadata: { partial: isReturnPartial },
      xml: finalXmlContent,
    };
    
    if (xmlChunk === null && !result.metadata.partial) { 
        if (isSpecialOnlyAtEOF) { // If it was an unterminated special tag as only content
            result.xml = [];
        } else if (result.xml && result.xml.length === 0 && !this._originalBufferHadContent && (this.streamingBufferBeforeClear || this.streamingBuffer).trim() === "") {
            result.xml = null;
        } else if (result.xml === null && this._originalBufferHadContent && (this.streamingBufferBeforeClear || this.streamingBuffer).trim() === "" && this.accumulator.length === 0) {
            result.xml = [];
        }
    }
    
    return result;
  }
}

module.exports = PartialXMLStreamParser;
