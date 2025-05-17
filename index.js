// PartialXMLStreamParser.js (Lenient Streaming Focus)

// Default options relevant to the lenient streaming parser
const DEFAULT_STREAM_OPTIONS = {
    textNodeName: "#text", // Key for text content when a tag has other children or for consistency
    attributeNamePrefix: "@", // Prefix for attribute names in the parsed object
    stopNodes: [], // Array of tag names that should not have their children parsed
    alwaysCreateTextNode: false, // If true, text content is always in a #text node
    parsePrimitives: false, // If true, attempts to parse numbers and booleans
    // Other options could be added here if the lenient parser evolves
};

const COMMON_ENTITIES = {
    'lt': '<', 'gt': '>', 'amp': '&', 'quot': '"', 'apos': "'"
};

const addValueToObject = (obj, key, value, textNodeNameForConcat) => {
    if (obj.hasOwnProperty(key)) {
        // If the key is the textNodeName and both current and new values are strings, concatenate them.
        if (key === textNodeNameForConcat && typeof obj[key] === 'string' && typeof value === 'string') {
            obj[key] += value;
        } else {
            // Key exists: convert to array or append
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
        // We don't need to clear this.customOptions.stopNodes as it's not directly used by the parsing logic anymore.
        // The parsing logic now uses this.simpleStopNodes and this.pathStopNodes.

        this.streamingBuffer = "";
        this._activelyStreaming = false; // Initialize streaming state

        // Pre-compiled regexes
        this.attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
        this.closingTagRegex = /^<\/\s*([\w:-]+)\s*>/;
        this.openingTagRegex = /^<\s*([\w:-]+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*\s*)?(\/?)>/;
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
            return match; // Should not happen with the regex
        });
    }

    _tryParsePrimitive(value) {
        if (typeof value !== 'string') return value;

        const lowerVal = value.toLowerCase();
        if (lowerVal === 'true') return true;
        if (lowerVal === 'false') return false;

        // Check if it's a number (integer or float)
        const trimmedValue = value.trim();
        if (trimmedValue !== "" && !isNaN(Number(trimmedValue))) {
            // Ensure the entire trimmed string is a valid number representation
            const num = Number(trimmedValue);
            if (String(num) === trimmedValue) { 
                 return num;
            }
        }
        return value;
    }

    _parseAttributes(attributesString, attributeNamePrefix) {
        const attrs = {};
        if (attributesString) {
            this.attrRegex.lastIndex = 0; // Reset lastIndex before using exec in a loop
            let match;
            while ((match = this.attrRegex.exec(attributesString)) !== null) {
                const attrName = match[1];
                let attrValue;

                if (match[2] !== undefined) { // Double-quoted
                    attrValue = this._decodeXmlEntities(match[2]);
                } else if (match[3] !== undefined) { // Single-quoted
                    attrValue = this._decodeXmlEntities(match[3]);
                } else if (match[4] !== undefined) { // Unquoted
                    attrValue = this._decodeXmlEntities(match[4]);
                } else { // Boolean attribute (no value part)
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
        while (i < xmlString.length) {
            const char = xmlString[i];
            if (char === '<') {
                if (xmlString.startsWith("<!--", i)) {
                    const commentEnd = xmlString.indexOf("-->", i + 4);
                    if (commentEnd === -1) {
                        i = xmlString.length;
                    } else {
                        i = commentEnd + 3;
                    }
                    continue;
                }
                if (xmlString.startsWith("<![CDATA[", i)) {
                    const cdataEnd = xmlString.indexOf("]]>", i + 9);
                    let text;
                    if (cdataEnd === -1) { 
                        text = xmlString.substring(i + 9);
                        i = xmlString.length;
                    } else {
                        text = xmlString.substring(i + 9, cdataEnd);
                        i = cdataEnd + 3;
                    }
                    if (tagStack.length > 0) {
                        const processedText = this.customOptions.parsePrimitives ? this._tryParsePrimitive(text) : text;
                        addValueToObject(tagStack[tagStack.length - 1].objPtr, textNodeName, processedText, textNodeName);
                    } 
                    continue;
                }
                if (xmlString.startsWith("<!DOCTYPE", i) || xmlString.startsWith("<?xml", i)) {
                    const endDeclaration = xmlString.indexOf(">", i + 2);
                    i = (endDeclaration === -1) ? xmlString.length : endDeclaration + 1;
                    continue;
                }

                if (xmlString[i + 1] === '/') {
                    const closingTagMatch = xmlString.substring(i).match(this.closingTagRegex);
                    if (closingTagMatch) {
                        const tagName = closingTagMatch[1];
                        if (tagStack.length > 0 && tagStack[tagStack.length - 1].tagName === tagName) {
                            const closedTagState = tagStack.pop();
                            const parentObj = (tagStack.length > 0) ? tagStack[tagStack.length - 1].objPtr : root;

                            if (!this.customOptions.alwaysCreateTextNode &&
                                closedTagState.textOnly &&
                                closedTagState.objPtr.hasOwnProperty(textNodeName)) {
                                const textVal = closedTagState.objPtr[textNodeName];
                                if (Object.keys(closedTagState.objPtr).length === 1) {
                                    for (const key in parentObj) {
                                        if (parentObj[key] === closedTagState.objPtr) {
                                            parentObj[key] = textVal;
                                            break;
                                        } else if (Array.isArray(parentObj[key])) {
                                            const arr = parentObj[key];
                                            const idx = arr.indexOf(closedTagState.objPtr);
                                            if (idx !== -1) {
                                                arr[idx] = textVal;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            currentPointer = parentObj;
                        } 
                        i += closingTagMatch[0].length;
                    } else { 
                        const text = xmlString.substring(i); 
                        if (tagStack.length > 0) {
                            let processedText = this._decodeXmlEntities(text);
                            if (this.customOptions.parsePrimitives) {
                                processedText = this._tryParsePrimitive(processedText);
                            }
                            addValueToObject(tagStack[tagStack.length - 1].objPtr, textNodeName, processedText, textNodeName);
                            tagStack[tagStack.length - 1].textOnly = false;
                        }
                        i = xmlString.length;
                    }
                } else { 
                    const openingTagMatch = xmlString.substring(i).match(this.openingTagRegex);
                    if (openingTagMatch) {
                        const tagName = openingTagMatch[1];
                        const attributesString = (openingTagMatch[2] || "").trim();
                        const isSelfClosing = openingTagMatch[3] === '/';
                        
                        const parsedAttributes = this._parseAttributes(attributesString, attributeNamePrefix);

                        const parentPath = tagStack.length > 0 ? tagStack[tagStack.length - 1].path : '';
                        const currentPath = parentPath ? `${parentPath}.${tagName}` : tagName;
                        
                        const isSimpleStopNode = this.simpleStopNodes.has(tagName);
                        const isPathStopNode = this.pathStopNodes.has(currentPath);
                        const isStopNode = !isSelfClosing && (isSimpleStopNode || isPathStopNode);

                        if (isStopNode) {
                            const stopNodeObject = { ...parsedAttributes }; 

                            const openTagEndOffset = openingTagMatch[0].length;
                            const contentStartIndex = i + openTagEndOffset;
                            let depth = 1;
                            let searchPos = contentStartIndex;
                            let rawContentEnd = -1;
                            let closingTagLength = 0;

                            let contentSearchRegex = this.stopNodeRegexCache[tagName];
                            if (!contentSearchRegex) {
                                const contentSearchRegexStr = `<\\s*${tagName}(?:\\s[^>]*)?>|<\\/\\s*${tagName}\\s*>`;
                                contentSearchRegex = new RegExp(contentSearchRegexStr, "g"); // 'g' flag, no 'i'
                                this.stopNodeRegexCache[tagName] = contentSearchRegex;
                            }
                            contentSearchRegex.lastIndex = searchPos; // Reset lastIndex before use

                            while(searchPos < xmlString.length) {
                                const match = contentSearchRegex.exec(xmlString);
                                if (!match) break;

                                const matchedTag = match[0];
                                if (matchedTag.startsWith("</") || matchedTag.startsWith("<\/") ) { 
                                    depth--;
                                    if (depth === 0) {
                                        rawContentEnd = match.index;
                                        closingTagLength = matchedTag.length;
                                        break;
                                    }
                                } else { 
                                    if (!/\/\s*>$/.test(matchedTag)) { 
                                        depth++;
                                    }
                                }
                                searchPos = match.index + matchedTag.length;
                            }

                            let rawContent = "";
                            if (rawContentEnd !== -1) {
                                rawContent = xmlString.substring(contentStartIndex, rawContentEnd);
                                i = rawContentEnd + closingTagLength;
                            } else { 
                                rawContent = xmlString.substring(contentStartIndex);
                                i = xmlString.length;
                            }
                            addValueToObject(stopNodeObject, textNodeName, rawContent, textNodeName); // Stop node content is not parsed for primitives
                            addValueToObject(currentPointer, tagName, stopNodeObject, undefined);

                            if (tagStack.length > 0) { 
                                tagStack[tagStack.length - 1].textOnly = false;
                            }
                        } else { 
                            const newObj = parsedAttributes; 

                            addValueToObject(currentPointer, tagName, newObj, undefined);
                            if (tagStack.length > 0) {
                                tagStack[tagStack.length - 1].textOnly = false;
                            }

                            if (!isSelfClosing) {
                                tagStack.push({ tagName: tagName, objPtr: newObj, textOnly: true, path: currentPath });
                                currentPointer = newObj;
                            }
                            i += openingTagMatch[0].length;
                        }
                    } else { 
                        const text = xmlString.substring(i); 
                        if (tagStack.length > 0) {
                            let processedText = this._decodeXmlEntities(text);
                            if (this.customOptions.parsePrimitives) {
                                processedText = this._tryParsePrimitive(processedText);
                            }
                            addValueToObject(tagStack[tagStack.length - 1].objPtr, textNodeName, processedText, textNodeName);
                            tagStack[tagStack.length - 1].textOnly = false; 
                        }
                        i = xmlString.length;
                    }
                }
            } else { // Text Content
                let textEnd = xmlString.indexOf('<', i);
                if (textEnd === -1) textEnd = xmlString.length;
                const text = xmlString.substring(i, textEnd);
                const trimmedText = text.trim(); 

                if (trimmedText.length > 0) {
                    let processedText = this._decodeXmlEntities(text);
                    if (this.customOptions.parsePrimitives) {
                        processedText = this._tryParsePrimitive(processedText);
                    }

                    if (tagStack.length > 0) {
                        const currentOpenTag = tagStack[tagStack.length - 1];
                        addValueToObject(currentOpenTag.objPtr, textNodeName, processedText, textNodeName);
                    } else if (Object.keys(root).length === 0) {
                        addValueToObject(root, textNodeName, processedText, textNodeName);
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

        const textNodeName = this.customOptions.textNodeName;
        const resultKeys = Object.keys(result);

        if (resultKeys.length === 1 && resultKeys[0] === textNodeName && stack.length === 0) {
            // Consistent object structure for root text
        } else if (resultKeys.length === 0 && stack.length === 0 && this.streamingBuffer.trim().length > 0) {
            // Buffer might contain only unparseable content or declarations
        }

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