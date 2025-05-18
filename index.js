// PartialXMLStreamParser.js (Lenient Streaming Focus)

// Default options relevant to the lenient streaming parser
const DEFAULT_STREAM_OPTIONS = {
  textNodeName: "#text", // Key for text content when a tag has other children or for consistency
  attributeNamePrefix: "@", // Prefix for attribute names in the parsed object
  stopNodes: [], // Array of tag names that should not have their children parsed
  alwaysCreateTextNode: false, // If true, text content is always in a #text node
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
  textNodeNameForConcat,
  customOptions,
) => {
  const effectiveTextNodeName = customOptions?.textNodeName || "#text";

  if (obj.hasOwnProperty(key)) {
    if (key === effectiveTextNodeName && customOptions?.alwaysCreateTextNode) {
      // If alwaysCreateTextNode, ensure #text is an array for multiple distinct text segments
      if (!Array.isArray(obj[key])) {
        obj[key] = [obj[key]]; // Convert existing string to array
      }
      obj[key].push(value); // Add new text segment
    } else if (
      key === textNodeNameForConcat &&
      typeof obj[key] === "string" &&
      typeof value === "string" &&
      !customOptions?.alwaysCreateTextNode
    ) {
      // Concatenate for non-alwaysCreateTextNode if it's the designated concat key and types match
      obj[key] += value;
    } else {
      // General case: if key exists, turn it into an array or push to existing array
      if (!Array.isArray(obj[key])) {
        obj[key] = [obj[key]];
      }
      obj[key].push(value);
    }
  } else {
    // Key doesn't exist yet
    if (key === effectiveTextNodeName && customOptions?.alwaysCreateTextNode) {
      // For alwaysCreateTextNode, first text node is a string, subsequent ones make it an array.
      // This was changed: first text node should be a string, not an array of one.
      // The conversion to array happens when a second text node or a child element is added.
      // For now, let's assume the test expects single text to be string, multiple to be array.
      // The logic above (when key exists) handles making it an array.
      // So, if it's the first time, it should just be the value.
      obj[key] = value;
    } else {
      obj[key] = value;
    }
  }
};

class PartialXMLStreamParser {
  constructor(options) {
    const mergedOptions = { ...DEFAULT_STREAM_OPTIONS, ...options };
    this.customOptions = mergedOptions;

    this.attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
    this.commentRegex = /<!--/g;
    this.cdataOpenRegex = /<!\[CDATA\[/g;
    this.doctypeRegex = /<!DOCTYPE/g;
    this.xmlDeclRegex = /<\?xml/g;
    this.closingTagRegex = /<\/\s*([\w:-]+)\s*>/g;
    this.openingTagRegex =
      /<\s*([\w:-]+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*\s*)?(\/?)\>/g;

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
                  textNodeName,
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
                  textNodeName,
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
            contentStartIndex: stopNodeContentStartIndex,
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
              textNodeName,
              this.customOptions,
            );
            this.parsingIndex = rawContentEnd + closingTagLength;
            this.incompleteStructureState = null;
          } else {
            const existingContent = stopNodeObjectRef[textNodeName] || "";
            const newPartialContent = buffer.substring(this.parsingIndex, len);
            if (newPartialContent.length > 0) {
              stopNodeObjectRef[textNodeName] =
                existingContent + newPartialContent;
            }
            this.parsingIndex = len;
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
          };
          return;
        }
        let match;
        let matchedPrefix = false;

        this.commentRegex.lastIndex = i;
        if ((match = this.commentRegex.exec(buffer)) && match.index === i) {
          const commentEnd = buffer.indexOf("-->", i + match[0].length);
          if (commentEnd === -1) {
            this.incompleteStructureState = {
              type: "comment",
              lookingFor: "-->",
              at: i,
            };
            return;
          }
          this.parsingIndex = commentEnd + 3;
          matchedPrefix = true;
          this.incompleteStructureState = null;
        }

        if (
          !matchedPrefix &&
          ((this.cdataOpenRegex.lastIndex = i),
          (match = this.cdataOpenRegex.exec(buffer))) &&
          match.index === i
        ) {
          const cdataOpenTagEnd = i + match[0].length;
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
                  textNodeName,
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
            };
            this.parsingIndex = len;
            return;
          } else {
            let text = buffer.substring(cdataOpenTagEnd, cdataEnd);
            this.parsingIndex = cdataEnd + cdataCloseMarker.length;
            const processedCDATA = this.customOptions.parsePrimitives
              ? this._tryParsePrimitive(text)
              : text;
            if (processedCDATA.trim().length > 0) {
              if (this.tagStack.length > 0 && this.currentPointer) {
                addValueToObject(
                  this.currentPointer,
                  textNodeName,
                  processedCDATA,
                  textNodeName,
                  this.customOptions,
                );
              } else if (this.tagStack.length === 0) {
                this.accumulator.push(processedCDATA);
              }
            }
            this.incompleteStructureState = null;
          }
          matchedPrefix = true;
        }

        if (
          !matchedPrefix &&
          ((this.doctypeRegex.lastIndex = i),
          (match = this.doctypeRegex.exec(buffer))) &&
          match.index === i
        ) {
          const endDeclaration = buffer.indexOf(">", i + match[0].length);
          if (endDeclaration === -1) {
            this.incompleteStructureState = {
              type: "doctype",
              lookingFor: ">",
              at: i,
            };
            return;
          }
          this.parsingIndex = endDeclaration + 1;
          matchedPrefix = true;
          this.incompleteStructureState = null;
        }

        if (
          !matchedPrefix &&
          ((this.xmlDeclRegex.lastIndex = i),
          (match = this.xmlDeclRegex.exec(buffer))) &&
          match.index === i
        ) {
          const endDeclaration = buffer.indexOf("?>", i + match[0].length);
          if (endDeclaration === -1) {
            this.incompleteStructureState = {
              type: "xmldecl",
              lookingFor: "?>",
              at: i,
            };
            return;
          }
          this.parsingIndex = endDeclaration + 2;
          matchedPrefix = true;
          this.incompleteStructureState = null;
        }

        if (matchedPrefix) {
          continue;
        }

        if (buffer[i + 1] === "/") {
          this.closingTagRegex.lastIndex = i;
          match = this.closingTagRegex.exec(buffer);
          if (match && match.index === i) {
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
            this.parsingIndex = i + match[0].length;
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
          this.openingTagRegex.lastIndex = i;
          match = this.openingTagRegex.exec(buffer);
          if (match && match.index === i) {
            const tagName = match[1];

            if (
              this.reparsedSegmentContext &&
              this.reparsedSegmentContext.originalIndex === i &&
              this.reparsedSegmentContext.tagType === "opening"
            ) {
              const { partialText, parentContext } =
                this.reparsedSegmentContext;
              if (parentContext) {
                if (Array.isArray(parentContext)) {
                  const lastIdx = parentContext.length - 1;
                  if (lastIdx >= 0 && parentContext[lastIdx] === partialText) {
                    parentContext.pop();
                  }
                } else if (parentContext.hasOwnProperty(textNodeName)) {
                  if (typeof parentContext[textNodeName] === "string") {
                    if (parentContext[textNodeName].endsWith(partialText)) {
                      parentContext[textNodeName] = parentContext[
                        textNodeName
                      ].slice(0, -partialText.length);
                      if (parentContext[textNodeName] === "") {
                        delete parentContext[textNodeName];
                      }
                    }
                  } else if (Array.isArray(parentContext[textNodeName])) {
                    const lastIdx = parentContext[textNodeName].length - 1;
                    if (
                      lastIdx >= 0 &&
                      parentContext[textNodeName][lastIdx] === partialText
                    ) {
                      parentContext[textNodeName].pop();
                      if (parentContext[textNodeName].length === 0) {
                        delete parentContext[textNodeName];
                      }
                    }
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

            if (this.tagStack.length > 0 && this.currentPointer) {
              const parentTagState = this.tagStack[this.tagStack.length - 1];
              if (parentTagState) parentTagState.textOnly = false;
            }

            if (isStopNode) {
              const stopNodeObject = { ...parsedAttributes };
              if (this.tagStack.length === 0) {
                const newRootElement = { [tagName]: stopNodeObject };
                this.accumulator.push(newRootElement);
              } else {
                addValueToObject(
                  this.currentPointer,
                  tagName,
                  stopNodeObject,
                  undefined,
                  this.customOptions,
                );
              }
              const openTagEndOffset = match[0].length;
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
                  textNodeName,
                  this.customOptions,
                );
                this.parsingIndex = rawContentEnd + closingTagLengthVal;
                this.incompleteStructureState = null;
              } else {
                const existingContent = stopNodeObject[textNodeName] || "";
                const newPartialContent = buffer.substring(
                  contentStartIndex,
                  len,
                );
                stopNodeObject[textNodeName] =
                  existingContent + newPartialContent;
                this.incompleteStructureState = {
                  type: "stop_node_content",
                  tagName: tagName,
                  depth: depth,
                  contentStartIndex: contentStartIndex,
                  stopNodeObjectRef: stopNodeObject,
                  at: i,
                };
                this.parsingIndex = len;
                return;
              }
            } else {
              const newObjShell = { ...parsedAttributes };
              if (this.tagStack.length === 0) {
                const newRootElement = { [tagName]: newObjShell };
                this.accumulator.push(newRootElement);
                if (!isSelfClosing) {
                  this.tagStack.push({
                    tagName: tagName,
                    objPtr: newObjShell,
                    textOnly: true,
                    path: currentPath,
                  });
                  this.currentPointer = newObjShell;
                } else {
                  this.currentPointer = null;
                }
              } else {
                addValueToObject(
                  this.currentPointer,
                  tagName,
                  newObjShell,
                  undefined,
                  this.customOptions,
                );
                if (!isSelfClosing) {
                  this.tagStack.push({
                    tagName: tagName,
                    objPtr: newObjShell,
                    textOnly: true,
                    path: currentPath,
                  });
                  this.currentPointer = newObjShell;
                }
              }
              this.parsingIndex = i + match[0].length;
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
              addValueToObject(
                this.currentPointer,
                textNodeName,
                processedContent,
                textNodeName,
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

    const text = buffer.substring(startIndex, endOfProblematicText);
    let actualParentOfPartialText = null;

    if (text.length > 0) {
      const decodedText = this._decodeXmlEntities(text);
      if (decodedText.trim().length > 0) {
        let processedContent = this.customOptions.parsePrimitives
          ? this._tryParsePrimitive(decodedText)
          : decodedText;

        if (this.tagStack.length > 0 && this.currentPointer) {
          addValueToObject(
            this.currentPointer,
            textNodeName,
            processedContent,
            textNodeName,
            this.customOptions,
          );
          actualParentOfPartialText = this.currentPointer;
        } else if (this.tagStack.length === 0) {
          this.accumulator.push(processedContent);
          actualParentOfPartialText = this.accumulator;
        }
      }
    }

    if (
      endOfProblematicText === buffer.length &&
      text.startsWith("<") &&
      text.length > 1
    ) {
      if (text.startsWith("</")) {
        if (text.indexOf(">") === -1) {
          this.incompleteStructureState = {
            type: "closing_tag_incomplete",
            at: startIndex,
            partial: text,
            parentOfPartial: actualParentOfPartialText,
          };
        } else {
          this.incompleteStructureState = null;
        }
      } else {
        const potentialTagName = text.substring(1).split(/\s|=|>|\[|\//)[0];
        if (
          text.indexOf(">") === -1 &&
          /^[a-zA-Z_][\w:-]*$/.test(potentialTagName) &&
          potentialTagName.length > 0
        ) {
          this.incompleteStructureState = {
            type: "opening_tag_incomplete",
            at: startIndex,
            partial: text,
            parentOfPartial: actualParentOfPartialText,
          };
        } else {
          this.incompleteStructureState = null;
        }
      }
    } else {
      this.incompleteStructureState = null;
    }

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

    if (currentXmlString) {
      this.streamingBuffer += currentXmlString;
      if (!this._activelyStreaming && currentXmlString.trim().length > 0) {
        this._activelyStreaming = true;
      }
    }

    const isFreshParser =
      this.accumulator.length === 0 &&
      this.tagStack.length === 0 &&
      !this.incompleteStructureState &&
      this.parsingIndex === 0 &&
      this.streamingBuffer === currentXmlString;

    if (isFreshParser && xmlChunk === "") {
      return { metadata: { partial: true }, xml: null };
    }
    if (
      isFreshParser &&
      (xmlChunk === null || xmlChunk === undefined) &&
      this.streamingBuffer.trim() === ""
    ) {
      return { metadata: { partial: false }, xml: null };
    }

    if (xmlChunk === null || xmlChunk === undefined) {
      if (this.incompleteStructureState) {
        const state = this.incompleteStructureState;
        const stateType = state.type;

        if (stateType === "cdata") {
          // All partial content should have been added by _processBuffer.
        } else if (
          (stateType === "opening_tag_incomplete" ||
            stateType === "closing_tag_incomplete") &&
          state.partial
        ) {
          this.incompleteStructureState = null;
          if (
            this.parsingIndex < this.streamingBuffer.length &&
            this.streamingBuffer.substring(this.parsingIndex).trim() === ""
          ) {
            this.parsingIndex = this.streamingBuffer.length;
          }
        } else if (stateType === "stop_node_content") {
          // If stream ends mid stop_node_content, the content collected so far is what we have.
        }
      }
    }

    if (
      this.streamingBuffer.length === this.parsingIndex &&
      xmlChunk !== null &&
      xmlChunk !== undefined &&
      typeof currentXmlString === "string" &&
      currentXmlString.length === 0 &&
      this.incompleteStructureState
    ) {
      let xmlForEarlyReturn;
      if (this.accumulator.length === 0) {
        xmlForEarlyReturn = null;
      } else if (this.accumulator.length === 1) {
        const firstItem = this.accumulator[0];
        if (
          typeof firstItem === "object" &&
          firstItem !== null &&
          !Array.isArray(firstItem)
        ) {
          // Check if it's an object, not an array or primitive
          xmlForEarlyReturn = JSON.parse(JSON.stringify(firstItem));
        } else {
          xmlForEarlyReturn = JSON.parse(JSON.stringify(this.accumulator));
        }
      } else {
        xmlForEarlyReturn = JSON.parse(JSON.stringify(this.accumulator));
      }
      return { metadata: { partial: true }, xml: xmlForEarlyReturn };
    }

    this._processBuffer();

    let finalXmlContent;
    if (this.accumulator.length === 0) {
      finalXmlContent = null;
    } else if (this.accumulator.length === 1) {
      const firstItem = this.accumulator[0];
      if (
        typeof firstItem === "object" &&
        firstItem !== null &&
        !Array.isArray(firstItem) &&
        Object.keys(firstItem).length === 1
      ) {
        finalXmlContent = JSON.parse(JSON.stringify(firstItem));
      } else {
        finalXmlContent = JSON.parse(JSON.stringify(this.accumulator));
      }
    } else {
      finalXmlContent = JSON.parse(JSON.stringify(this.accumulator));
    }

    let isReturnPartial =
      this.tagStack.length > 0 || !!this.incompleteStructureState;

    if (xmlChunk === null || xmlChunk === undefined) {
      if (
        this.incompleteStructureState &&
        (this.incompleteStructureState.type === "doctype" ||
          this.incompleteStructureState.type === "xmldecl" ||
          this.incompleteStructureState.type === "comment")
      ) {
        if (this.accumulator.length === 0 && this.tagStack.length === 0) {
          isReturnPartial = false;
          this.incompleteStructureState = null;
        } else {
          isReturnPartial = true;
        }
      } else if (this.incompleteStructureState) {
        isReturnPartial = true;
      } else if (this.tagStack.length > 0) {
        isReturnPartial = true;
      } else {
        isReturnPartial = false;
      }

      if (!isReturnPartial) {
        this.streamingBuffer = "";
        this.parsingIndex = 0;
        this._activelyStreaming = false;
        if (finalXmlContent === null && this.streamingBuffer.trim() !== "") {
          const tempBufferTest = this.streamingBuffer
            .replace(/<\?xml[^?]*\?>/g, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<!DOCTYPE[^>]*>/g, "")
            .trim();
          if (tempBufferTest === "") {
            // finalXmlContent is already null
          }
        }
      }
    }

    const result = {
      metadata: { partial: isReturnPartial },
      xml: finalXmlContent,
    };

    if (
      (xmlChunk === null || xmlChunk === undefined) &&
      !result.metadata.partial &&
      this.accumulator.length === 0 &&
      this.streamingBuffer.trim() !== ""
    ) {
      const tempBuffer = this.streamingBuffer
        .replace(/<\?xml[^?]*\?>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<!DOCTYPE[^>]*>/g, "")
        .trim();
      if (tempBuffer === "") {
        result.xml = null;
      }
    }

    return result;
  }
}

module.exports = PartialXMLStreamParser;
