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
    'lt': '<', 'gt': '>', 'amp': '&', 'quot': '"', 'apos': "'"
};

const addValueToObject = (obj, key, value, textNodeNameForConcat) => {
    if (obj.hasOwnProperty(key)) {
        if (key === textNodeNameForConcat && typeof obj[key] === 'string' && typeof value === 'string') {
            obj[key] += value;
        } else {
            if (!Array.isArray(obj[key])) {
                obj[key] = [obj[key]];
            }
            obj[key].push(value);
        }
    } else {
        obj[key] = value;
    }
};

class PartialXMLStreamParser {

    constructor(options) {
        const mergedOptions = { ...DEFAULT_STREAM_OPTIONS, ...options };

        this.simpleStopNodes = new Set();
        this.pathStopNodes = new Set();

        if (mergedOptions.stopNodes) {
            const stopNodesArray = Array.isArray(mergedOptions.stopNodes) ? mergedOptions.stopNodes : [mergedOptions.stopNodes];
            stopNodesArray.forEach(node => {
                if (typeof node === 'string') {
                    if (node.includes('.')) {
                        this.pathStopNodes.add(node);
                    } else {
                        this.simpleStopNodes.add(node);
                    }
                }
            });
        }

        this.customOptions = mergedOptions;
        this.streamingBuffer = "";
        this._activelyStreaming = false;

        this.attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
        this.commentRegex = /<!--/g;
        this.cdataOpenRegex = /<!\[CDATA\[/g;
        this.doctypeRegex = /<!DOCTYPE/g;
        this.xmlDeclRegex = /<\?xml/g;
        this.closingTagRegex = /<\/\s*([\w:-]+)\s*>/g; // Removed ^, added g
        this.openingTagRegex = /<\s*([\w:-]+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*\s*)?(\/?)>/g; // Removed ^, added g
        this.stopNodeRegexCache = {};
    }

    _decodeXmlEntities(text) {
        if (typeof text !== 'string') return text;
        return text.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([\da-fA-F]+));/g, (match, name, dec, hex) => {
            if (COMMON_ENTITIES[name]) {
                return COMMON_ENTITIES[name];
            }
            if (dec) return String.fromCharCode(parseInt(dec, 10));
            if (hex) return String.fromCharCode(parseInt(hex, 16));
            return match;
        });
    }

    _tryParsePrimitive(value) {
        if (typeof value !== 'string') return value;
        const lowerVal = value.toLowerCase();
        if (lowerVal === 'true') return true;
        if (lowerVal === 'false') return false;
        const trimmedValueForCheck = value.trim();
        if (trimmedValueForCheck.length > 0 && !isNaN(Number(trimmedValueForCheck))) {
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
                if (this.customOptions.parsePrimitives && typeof attrValue === 'string') {
                    attrs[`${attributeNamePrefix}${attrName}`] = this._tryParsePrimitive(attrValue);
                } else {
                    attrs[`${attributeNamePrefix}${attrName}`] = attrValue;
                }
            }
        }
        return attrs;
    }

    _parseChunkToPartialObject(xmlString) {
        const root = {};
        let currentPointer = root;
        const tagStack = [];
        const textNodeName = this.customOptions.textNodeName;
        const attributeNamePrefix = this.customOptions.attributeNamePrefix !== undefined ? this.customOptions.attributeNamePrefix : "@";
        let i = 0;
        const len = xmlString.length;

        while (i < len) {
            if (xmlString[i] === '<') {
                let match;
                let matchedPrefix = false;

                this.commentRegex.lastIndex = i;
                if ((match = this.commentRegex.exec(xmlString)) && match.index === i) {
                    const commentEnd = xmlString.indexOf("-->", i + match[0].length);
                    i = (commentEnd === -1) ? len : commentEnd + 3;
                    matchedPrefix = true;
                }

                if (!matchedPrefix) {
                    this.cdataOpenRegex.lastIndex = i;
                    if ((match = this.cdataOpenRegex.exec(xmlString)) && match.index === i) {
                        const cdataContentStart = i + match[0].length;
                        const cdataEnd = xmlString.indexOf("]]>", cdataContentStart);
                        let text;
                        if (cdataEnd === -1) {
                            text = xmlString.substring(cdataContentStart);
                            i = len;
                        } else {
                            text = xmlString.substring(cdataContentStart, cdataEnd);
                            i = cdataEnd + 3;
                        }
                        if (tagStack.length > 0) {
                            const processedText = this.customOptions.parsePrimitives ? this._tryParsePrimitive(text) : text;
                            addValueToObject(currentPointer, textNodeName, processedText, textNodeName);
                        }
                        matchedPrefix = true;
                    }
                }

                if (!matchedPrefix) {
                    this.doctypeRegex.lastIndex = i;
                    if ((match = this.doctypeRegex.exec(xmlString)) && match.index === i) {
                        const endDeclaration = xmlString.indexOf(">", i + match[0].length);
                        i = (endDeclaration === -1) ? len : endDeclaration + 1;
                        matchedPrefix = true;
                    }
                }

                if (!matchedPrefix) {
                    this.xmlDeclRegex.lastIndex = i;
                    if ((match = this.xmlDeclRegex.exec(xmlString)) && match.index === i) {
                        const endDeclaration = xmlString.indexOf("?>", i + match[0].length); // XML declarations end with ?>
                        i = (endDeclaration === -1) ? len : endDeclaration + 2; // account for ?>
                        matchedPrefix = true;
                    }
                }

                if (matchedPrefix) {
                    continue;
                }

                // No longer creating remainingStr for each tag check
                if (xmlString[i + 1] === '/') { // Potential Closing Tag
                    this.closingTagRegex.lastIndex = i;
                    match = this.closingTagRegex.exec(xmlString);
                    if (match && match.index === i) { // Confirmed Closing Tag at current position
                        const tagName = match[1];
                        if (tagStack.length > 0 && tagStack[tagStack.length - 1].tagName === tagName) {
                            const closedTagState = tagStack.pop();
                            const parentObj = (tagStack.length > 0) ? tagStack[tagStack.length - 1].objPtr : root;
                            if (!this.customOptions.alwaysCreateTextNode &&
                                closedTagState.textOnly &&
                                closedTagState.objPtr.hasOwnProperty(textNodeName) &&
                                Object.keys(closedTagState.objPtr).length === 1) {
                                const textVal = closedTagState.objPtr[textNodeName];
                                for (const keyInParent in parentObj) {
                                    if (parentObj[keyInParent] === closedTagState.objPtr) {
                                        parentObj[keyInParent] = textVal;
                                        break;
                                    } else if (Array.isArray(parentObj[keyInParent])) {
                                        const arr = parentObj[keyInParent];
                                        const idx = arr.indexOf(closedTagState.objPtr);
                                        if (idx !== -1) {
                                            arr[idx] = textVal;
                                            break;
                                        }
                                    }
                                }
                            }
                            currentPointer = parentObj;
                        }
                        i += match[0].length;
                    } else { // Not a well-formed closing tag, treat as text
                        const text = xmlString.substring(i);
                        if (tagStack.length > 0) {
                            let processedText = this._decodeXmlEntities(text);
                            if (this.customOptions.parsePrimitives) processedText = this._tryParsePrimitive(processedText);
                            addValueToObject(currentPointer, textNodeName, processedText, textNodeName);
                            if (tagStack.length > 0) tagStack[tagStack.length - 1].textOnly = false;
                        }
                        i = len;
                    }
                } // End of Closing Tag or fallback to text
                else { // Potential Opening Tag
                    this.openingTagRegex.lastIndex = i;
                    match = this.openingTagRegex.exec(xmlString);
                    if (match && match.index === i) { // Confirmed Opening Tag at current position
                        const tagName = match[1];
                        const attributesString = (match[2] || "").trim();
                        const isSelfClosing = match[3] === '/';
                        const parsedAttributes = this._parseAttributes(attributesString, attributeNamePrefix);
                        const parentPath = tagStack.length > 0 ? tagStack[tagStack.length - 1].path : '';
                        const currentPath = parentPath ? `${parentPath}.${tagName}` : tagName;
                        const isSimpleStopNode = this.simpleStopNodes.has(tagName);
                        const isPathStopNode = this.pathStopNodes.has(currentPath);
                        const isStopNode = !isSelfClosing && (isSimpleStopNode || isPathStopNode);

                        if (tagStack.length > 0) tagStack[tagStack.length - 1].textOnly = false;

                        if (isStopNode) {
                            const stopNodeObject = { ...parsedAttributes };
                            addValueToObject(currentPointer, tagName, stopNodeObject, undefined);
                            const openTagEndOffset = match[0].length;
                            const contentStartIndex = i + openTagEndOffset;
                            let depth = 1;
                            let searchPos = contentStartIndex;
                            let rawContentEnd = -1;
                            let closingTagLength = 0;
                            let contentSearchRegex = this.stopNodeRegexCache[tagName];
                            if (!contentSearchRegex) {
                                const contentSearchRegexStr = `<\\s*${tagName}(?:\\s[^>]*)?>|<\\/\\s*${tagName}\\s*>`;
                                contentSearchRegex = new RegExp(contentSearchRegexStr, "g");
                                this.stopNodeRegexCache[tagName] = contentSearchRegex;
                            }
                            contentSearchRegex.lastIndex = searchPos; // Start search from current position
                            while (searchPos < len) {
                                const execMatch = contentSearchRegex.exec(xmlString); // Search on the full string
                                if (!execMatch) break;
                                const matchedTag = execMatch[0];
                                if (matchedTag.startsWith("</") || matchedTag.startsWith("<\\/")) { // Check for closing tag
                                    depth--;
                                    if (depth === 0) {
                                        rawContentEnd = execMatch.index;
                                        closingTagLength = matchedTag.length;
                                        break;
                                    }
                                } else if (!/\/\s*>$/.test(matchedTag)) { // Not a self-closing opening tag
                                    depth++;
                                }
                            }
                            let rawContent = "";
                            if (rawContentEnd !== -1) {
                                rawContent = xmlString.substring(contentStartIndex, rawContentEnd);
                                i = rawContentEnd + closingTagLength;
                            } else {
                                rawContent = xmlString.substring(contentStartIndex);
                                i = len;
                            }
                            addValueToObject(stopNodeObject, textNodeName, rawContent, textNodeName);
                        } else {
                            const newObj = parsedAttributes;
                            addValueToObject(currentPointer, tagName, newObj, undefined);
                            if (!isSelfClosing) {
                                tagStack.push({ tagName: tagName, objPtr: newObj, textOnly: true, path: currentPath });
                                currentPointer = newObj;
                            }
                            i += match[0].length;
                        }
                    } else { // Not a well-formed opening tag at i, or something else
                        const text = xmlString.substring(i); // Fallback: treat as text
                        if (tagStack.length > 0) {
                            let processedText = this._decodeXmlEntities(text);
                            if (this.customOptions.parsePrimitives) processedText = this._tryParsePrimitive(processedText);
                            addValueToObject(currentPointer, textNodeName, processedText, textNodeName);
                            if (tagStack.length > 0) tagStack[tagStack.length - 1].textOnly = false;
                        }
                        i = len;
                    }
                }
            } else { // Text Content
                let textEnd = xmlString.indexOf('<', i);
                if (textEnd === -1) textEnd = len;
                const rawText = xmlString.substring(i, textEnd);

                if (rawText.length > 0) {
                    const decodedText = this._decodeXmlEntities(rawText);
                    const isPurelyWhitespace = decodedText.trim().length === 0;

                    // Ignore text after the root element has been established
                    if (tagStack.length === 0 && Object.keys(root).length > 0) {
                        i = textEnd;
                        continue;
                    }

                    // Ignore purely formatting whitespace (inter-element or leading whitespace before any root tag)
                    if (isPurelyWhitespace) {
                        i = textEnd;
                        continue;
                    }

                    // Process non-purely-whitespace text
                    let processedContent;
                    if (this.customOptions.parsePrimitives) {
                        processedContent = this._tryParsePrimitive(decodedText);
                    } else {
                        processedContent = decodedText;
                    }

                    let finalValueToAdd;
                    // if (typeof processedContent !== 'string') { 
                    //     finalValueToAdd = processedContent;
                    // } else { 
                    // if (this.customOptions.alwaysCreateTextNode) {
                    finalValueToAdd = processedContent;
                    // } else {
                    //     finalValueToAdd = processedContent.trim(); 
                    // }
                    // }

                    const isPrimitive = typeof finalValueToAdd !== 'string';
                    const isNonEmptyString = typeof finalValueToAdd === 'string' && finalValueToAdd.length > 0;
                    // Add empty string only if alwaysCreateTextNode is true AND the original text was not purely whitespace
                    // (e.g. <tag>{emptyVar}</tag> where emptyVar is "", not from <tag>   </tag>)
                    const shouldAddEmptyString =
                        typeof finalValueToAdd === 'string' &&
                        finalValueToAdd.length === 0 &&
                        this.customOptions.alwaysCreateTextNode &&
                        !isPurelyWhitespace; // This condition is implicitly true if we reached here

                    if (isPrimitive || isNonEmptyString || shouldAddEmptyString) {
                        addValueToObject(currentPointer, textNodeName, finalValueToAdd, textNodeName);
                    }
                }
                i = textEnd;
            }
        }
        return { result: root, stack: tagStack };
    }

    parseStream(xmlChunk) {
        let currentXmlString;
        if (typeof xmlChunk === "string") {
            currentXmlString = xmlChunk;
        } else if (xmlChunk && typeof xmlChunk.toString === "function") {
            currentXmlString = xmlChunk.toString();
        } else if (xmlChunk === null || xmlChunk === undefined || xmlChunk === "") {
            currentXmlString = "";
        } else {
            throw new Error("XML chunk for 'parseStream' is accepted in String, Buffer, null, or undefined form.");
        }
        this.streamingBuffer += currentXmlString;
        if (this.streamingBuffer.trim() === "") {
            if ((xmlChunk === null || xmlChunk === undefined) && !this._activelyStreaming) {
                return { _partial: false };
            }
            return { _partial: true, _status: "Waiting for data or empty stream" };
        }
        this._activelyStreaming = true;
        const { result, stack } = this._parseChunkToPartialObject(this.streamingBuffer);
        result._partial = (stack.length > 0);
        if (xmlChunk === null || xmlChunk === undefined) {
            this._activelyStreaming = false;
            if (!result._partial) {
                this.streamingBuffer = "";
            }
        }
        return result;
    }
}

module.exports = PartialXMLStreamParser;