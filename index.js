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
        this.customOptions = mergedOptions;

        this.attrRegex = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
        this.commentRegex = /<!--/g;
        this.cdataOpenRegex = /<!\[CDATA\[/g;
        this.doctypeRegex = /<!DOCTYPE/g;
        this.xmlDeclRegex = /<\?xml/g;
        this.closingTagRegex = /<\/\s*([\w:-]+)\s*>/g; 
        this.openingTagRegex = /<\s*([\w:-]+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*\s*)?(\/?)\>/g;
        
        this.stopNodeRegexCache = {};
        
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
        this.reset();
    }

    reset() {
        this.streamingBuffer = "";
        this._activelyStreaming = false;
        this.rootObject = {};
        this.currentPointer = this.rootObject;
        this.tagStack = [];
        this.parsingIndex = 0;
        this.incompleteStructureState = null;
        this.reparsedSegmentContext = null; // For tracking text to retract
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
                    attrValue = true; // Attribute without value
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

    _processBuffer() {
        const textNodeName = this.customOptions.textNodeName;
        const attributeNamePrefix = this.customOptions.attributeNamePrefix !== undefined ? this.customOptions.attributeNamePrefix : "@";
        const buffer = this.streamingBuffer;
        let len = buffer.length; 

        if (this.incompleteStructureState) {
            const state = this.incompleteStructureState;
            const searchStartIndex = Math.max(this.parsingIndex, state.at || 0);
            let endIdx;

            switch (state.type) {
                case 'comment':
                    endIdx = buffer.indexOf(state.lookingFor, searchStartIndex);
                    if (endIdx !== -1 && endIdx >= (state.at || 0)) {
                        this.parsingIndex = endIdx + state.lookingFor.length;
                        this.incompleteStructureState = null; 
                    } else { return; } 
                    break;
                case 'cdata':
                    // We are in this state because a previous chunk ended mid-CDATA.
                    // this.parsingIndex is at the start of the new data for this CDATA.
                    const cdataCloseMarker = state.lookingFor; // "]]>"
                    // searchStartIndex is already Math.max(this.parsingIndex, state.at || 0)
                    // but for cdata continuation, we should always search from this.parsingIndex
                    
                    endIdx = buffer.indexOf(cdataCloseMarker, this.parsingIndex);

                    if (endIdx !== -1) { // Found ']]>' in the current buffer continuation
                        const newContentSegment = buffer.substring(this.parsingIndex, endIdx);
                        if (this.tagStack.length > 0 && (this.customOptions.alwaysCreateTextNode || newContentSegment.trim().length > 0)) {
                             let textToAdd = this.customOptions.parsePrimitives ? this._tryParsePrimitive(newContentSegment) : newContentSegment;
                             addValueToObject(this.currentPointer, textNodeName, textToAdd, textNodeName); // Append
                        }
                        this.parsingIndex = endIdx + cdataCloseMarker.length;
                        this.incompleteStructureState = null; 
                    } else { // ']]>' still not found in the rest of the current buffer
                        const newPartialContent = buffer.substring(this.parsingIndex, len);
                        if (this.tagStack.length > 0 && (this.customOptions.alwaysCreateTextNode || newPartialContent.trim().length > 0)) {
                            let textToAdd = this.customOptions.parsePrimitives ? this._tryParsePrimitive(newPartialContent) : newPartialContent;
                            addValueToObject(this.currentPointer, textNodeName, textToAdd, textNodeName); // Append
                        }
                        this.parsingIndex = len; // Consumed entire buffer
                        // state remains 'cdata'
                        return; // Need more data
                    } 
                    break;
                case 'doctype':
                case 'xmldecl':
                    endIdx = buffer.indexOf(state.lookingFor, searchStartIndex);
                    if (endIdx !== -1 && endIdx >= (state.at || 0)) {
                        this.parsingIndex = endIdx + state.lookingFor.length;
                        this.incompleteStructureState = null; 
                    } else { return; } 
                    break;
                case 'tag_start_incomplete': 
                    if (this.parsingIndex + 1 < len) { 
                        this.incompleteStructureState = null; 
                    } else { return; } 
                    break;
                case 'opening_tag_incomplete':
                case 'closing_tag_incomplete':
                    if (state.at !== undefined) {
                        this.parsingIndex = state.at;
                        // Store context for potential text retraction if this segment is successfully re-parsed as a tag
                        this.reparsedSegmentContext = {
                            originalIndex: state.at,
                            partialText: state.partial,
                            parentContext: state.parentOfPartial, // Parent to which partial text was added
                            tagType: state.type === 'opening_tag_incomplete' ? 'opening' : 'closing'
                        };
                    }
                    this.incompleteStructureState = null;
                    break;
                case 'stop_node_content':
                    let { tagName: stopNodeTagName, depth: stopNodeDepth, contentStartIndex: stopNodeContentStartIndex, stopNodeObjectRef } = state; // Renamed to avoid conflict
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

                    while (currentSearchPos < len && (execMatch = contentSearchRegex.exec(buffer)) !== null) {
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
                        const newContentSegment = buffer.substring(this.parsingIndex, rawContentEnd);
                        addValueToObject(stopNodeObjectRef, textNodeName, newContentSegment, textNodeName);
                        this.parsingIndex = rawContentEnd + closingTagLength;
                        this.incompleteStructureState = null;
                    } else {
                        const existingContent = stopNodeObjectRef[textNodeName] || "";
                        const newPartialContent = buffer.substring(this.parsingIndex, len);
                        if (newPartialContent.length > 0) {
                            stopNodeObjectRef[textNodeName] = existingContent + newPartialContent;
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
            if (buffer[i] === '<') {
                if (i + 1 >= len) {
                    this.incompleteStructureState = { type: 'tag_start_incomplete', at: i };
                    return;
                }
                let match;
                let matchedPrefix = false;

                this.commentRegex.lastIndex = i;
                if ((match = this.commentRegex.exec(buffer)) && match.index === i) {
                    const commentEnd = buffer.indexOf("-->", i + match[0].length);
                    if (commentEnd === -1) {
                        this.incompleteStructureState = { type: 'comment', lookingFor: '-->', at: i }; return;
                    }
                    this.parsingIndex = commentEnd + 3; matchedPrefix = true; this.incompleteStructureState = null;
                }

                if (!matchedPrefix && (this.cdataOpenRegex.lastIndex = i, match = this.cdataOpenRegex.exec(buffer)) && match.index === i) {
                    const cdataOpenTagEnd = i + match[0].length;
                    const cdataCloseMarker = "]]>";
                    const cdataEnd = buffer.indexOf(cdataCloseMarker, cdataOpenTagEnd);

                    if (cdataEnd === -1) { // Unterminated CDATA in this chunk
                        const partialContent = buffer.substring(cdataOpenTagEnd, len);
                        if (this.tagStack.length > 0 && (this.customOptions.alwaysCreateTextNode || partialContent.trim().length > 0)) {
                            let textToAdd = this.customOptions.parsePrimitives ? this._tryParsePrimitive(partialContent) : partialContent;
                            addValueToObject(this.currentPointer, textNodeName, textToAdd, textNodeName);
                        }
                        this.incompleteStructureState = { 
                            type: 'cdata', 
                            lookingFor: cdataCloseMarker, 
                            at: i, // Original start of <![CDATA[
                        };
                        this.parsingIndex = len; // Consumed entire buffer for this CDATA part
                        return; // Need more data to find ']]>'
                    } else { // Terminated CDATA
                        let text = buffer.substring(cdataOpenTagEnd, cdataEnd);
                        this.parsingIndex = cdataEnd + cdataCloseMarker.length;
                        if (this.tagStack.length > 0) addValueToObject(this.currentPointer, textNodeName, this.customOptions.parsePrimitives ? this._tryParsePrimitive(text) : text, textNodeName);
                        this.incompleteStructureState = null;
                    }
                    matchedPrefix = true;
                }

                if (!matchedPrefix && (this.doctypeRegex.lastIndex = i, match = this.doctypeRegex.exec(buffer)) && match.index === i) {
                    const endDeclaration = buffer.indexOf(">", i + match[0].length);
                    if (endDeclaration === -1) {
                        this.incompleteStructureState = { type: 'doctype', lookingFor: '>', at: i }; return;
                    }
                    this.parsingIndex = endDeclaration + 1; matchedPrefix = true; this.incompleteStructureState = null;
                }

                if (!matchedPrefix && (this.xmlDeclRegex.lastIndex = i, match = this.xmlDeclRegex.exec(buffer)) && match.index === i) {
                    const endDeclaration = buffer.indexOf("?>", i + match[0].length);
                    if (endDeclaration === -1) {
                        this.incompleteStructureState = { type: 'xmldecl', lookingFor: '?>', at: i }; return;
                    }
                    this.parsingIndex = endDeclaration + 2; matchedPrefix = true; this.incompleteStructureState = null;
                }

                if (matchedPrefix) { continue; }

                if (buffer[i + 1] === '/') { // Potential Closing Tag
                    this.closingTagRegex.lastIndex = i;
                    match = this.closingTagRegex.exec(buffer);
                    if (match && match.index === i) {
                        // This is a fully matched closing tag by regex
                        const tagName = match[1];
                        if (this.tagStack.length > 0 && this.tagStack[this.tagStack.length - 1].tagName === tagName) {
                            const closedTagState = this.tagStack.pop();
                            this.currentPointer = (this.tagStack.length > 0) ? this.tagStack[this.tagStack.length - 1].objPtr : this.rootObject;
                            if (!this.customOptions.alwaysCreateTextNode && closedTagState.textOnly && closedTagState.objPtr.hasOwnProperty(textNodeName) && Object.keys(closedTagState.objPtr).length === 1) {
                                const textVal = closedTagState.objPtr[textNodeName];
                                for (const keyInParent in this.currentPointer) {
                                    if (this.currentPointer[keyInParent] === closedTagState.objPtr) { this.currentPointer[keyInParent] = textVal; break; }
                                    else if (Array.isArray(this.currentPointer[keyInParent])) { const arr = this.currentPointer[keyInParent]; const idx = arr.indexOf(closedTagState.objPtr); if (idx !== -1) { arr[idx] = textVal; break; } }
                                }
                            }
                        }
                        this.parsingIndex = i + match[0].length; this.incompleteStructureState = null;
                        this.reparsedSegmentContext = null; // Clear if a closing tag is fully matched
                    } else {
                        // ClosingTagRegex failed to match. _handleFallbackText will decide if it's an incomplete tag at buffer end or just text.
                        this.parsingIndex = this._handleFallbackText(buffer, i, textNodeName);
                        // incompleteStructureState might be set by _handleFallbackText
                    }
                } else { // Potential Opening Tag
                    this.openingTagRegex.lastIndex = i;
                    match = this.openingTagRegex.exec(buffer);
                    if (match && match.index === i) {
                        // This is a fully matched opening/self-closing tag by regex
                        const tagName = match[1];

                        // Check if we just re-parsed an incomplete opening tag
                        if (this.reparsedSegmentContext &&
                            this.reparsedSegmentContext.originalIndex === i &&
                            this.reparsedSegmentContext.tagType === 'opening') {
                            
                            const { partialText, parentContext } = this.reparsedSegmentContext;
                            if (parentContext && parentContext.hasOwnProperty(textNodeName)) {
                                if (typeof parentContext[textNodeName] === 'string') {
                                    if (parentContext[textNodeName].endsWith(partialText)) {
                                        parentContext[textNodeName] = parentContext[textNodeName].slice(0, -partialText.length);
                                        if (parentContext[textNodeName] === "") {
                                            delete parentContext[textNodeName];
                                        }
                                    }
                                } else if (Array.isArray(parentContext[textNodeName])) {
                                    // If it's an array, try to remove the last element if it matches
                                    const lastIdx = parentContext[textNodeName].length - 1;
                                    if (lastIdx >= 0 && parentContext[textNodeName][lastIdx] === partialText) {
                                        parentContext[textNodeName].pop();
                                        if (parentContext[textNodeName].length === 0) {
                                            delete parentContext[textNodeName];
                                        }
                                    }
                                }
                            }
                        }
                        this.reparsedSegmentContext = null; // Clear after use or if not applicable

                        const attributesString = (match[2] || "").trim();
                        const isSelfClosing = match[3] === '/';
                        
                        const parsedAttributes = this._parseAttributes(attributesString, attributeNamePrefix);
                        const parentPath = this.tagStack.length > 0 ? this.tagStack[this.tagStack.length - 1].path : '';
                        const currentPath = parentPath ? `${parentPath}.${tagName}` : tagName;
                        const isSimpleStopNode = this.simpleStopNodes.has(tagName);
                        const isPathStopNode = this.pathStopNodes.has(currentPath);
                        const isStopNode = !isSelfClosing && (isSimpleStopNode || isPathStopNode);

                        if (this.tagStack.length > 0) this.tagStack[this.tagStack.length - 1].textOnly = false;

                        if (isStopNode) {
                            const stopNodeObject = { ...parsedAttributes };
                            addValueToObject(this.currentPointer, tagName, stopNodeObject, undefined);
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
                            while (searchPos < len && (execMatchStop = contentSearchRegex.exec(buffer)) !== null) {
                                const matchedStopTag = execMatchStop[0];
                                if (matchedStopTag.startsWith("</") || matchedStopTag.startsWith("<\\/")) {
                                    depth--;
                                    if (depth === 0) { rawContentEnd = execMatchStop.index; closingTagLengthVal = matchedStopTag.length; break; }
                                } else if (!/\/\s*>$/.test(matchedStopTag)) { depth++; }
                                searchPos = contentSearchRegex.lastIndex;
                            }

                            if (rawContentEnd !== -1) {
                                const rawContent = buffer.substring(contentStartIndex, rawContentEnd);
                                addValueToObject(stopNodeObject, textNodeName, rawContent, textNodeName);
                                this.parsingIndex = rawContentEnd + closingTagLengthVal;
                                this.incompleteStructureState = null;
                            } else {
                                const existingContent = stopNodeObject[textNodeName] || "";
                                const newPartialContent = buffer.substring(contentStartIndex, len);
                                stopNodeObject[textNodeName] = existingContent + newPartialContent;
                                this.incompleteStructureState = { 
                                    type: 'stop_node_content', tagName: tagName, depth: depth,
                                    contentStartIndex: contentStartIndex, 
                                    stopNodeObjectRef: stopNodeObject, at: i
                                };
                                this.parsingIndex = len; return; 
                            }
                        } else {
                            const newObj = parsedAttributes;
                            addValueToObject(this.currentPointer, tagName, newObj, undefined);
                            if (!isSelfClosing) {
                                this.tagStack.push({ tagName: tagName, objPtr: newObj, textOnly: true, path: currentPath });
                                this.currentPointer = newObj;
                            }
                            this.parsingIndex = i + match[0].length; this.incompleteStructureState = null;
                        }
                    } else {
                        // OpeningTagRegex failed to match. _handleFallbackText will decide.
                        this.parsingIndex = this._handleFallbackText(buffer, i, textNodeName);
                         // incompleteStructureState might be set by _handleFallbackText
                    }
                }
            } else { // Text Content
                let textEnd = buffer.indexOf('<', i);
                if (textEnd === -1) textEnd = len;
                const rawText = buffer.substring(i, textEnd);
                if (rawText.length > 0) {
                    const decodedText = this._decodeXmlEntities(rawText);
                    const isRawTextPurelyWhitespace = rawText.trim().length === 0; 

                    const canAddTextAtRoot = this.tagStack.length === 0 &&
                                           Object.keys(this.rootObject).length === 0 &&
                                           !isRawTextPurelyWhitespace;

                    if (this.tagStack.length > 0 || canAddTextAtRoot) {
                        const isDecodedTextPurelyWhitespace = decodedText.trim().length === 0;

                        if ((this.customOptions.alwaysCreateTextNode && !isRawTextPurelyWhitespace) ||
                            (!this.customOptions.alwaysCreateTextNode && !isDecodedTextPurelyWhitespace)) {
                            
                            let processedContent = this.customOptions.parsePrimitives ? this._tryParsePrimitive(decodedText) : decodedText;
                            
                            if (!this.customOptions.alwaysCreateTextNode && typeof processedContent === 'string' && processedContent.trim().length === 0) {
                                // Skip
                            } else {
                                addValueToObject(this.currentPointer, textNodeName, processedContent, textNodeName);
                            }
                        }
                    }
                }
                this.parsingIndex = textEnd; this.incompleteStructureState = null;
            }
        }
    }

    _handleFallbackText(buffer, startIndex, textNodeName) {
        let endOfProblematicText = buffer.indexOf('<', startIndex + 1);
        if (endOfProblematicText === -1) endOfProblematicText = buffer.length;
        
        const text = buffer.substring(startIndex, endOfProblematicText);
        let actualParentOfPartialText = null; 

        if (text.length > 0) {
            const decodedText = this._decodeXmlEntities(text);
            const isDecodedTextNonWhitespace = decodedText.trim().length > 0;

            const canAddTextAtRoot = this.tagStack.length === 0 &&
                                   Object.keys(this.rootObject).length === 0 &&
                                   isDecodedTextNonWhitespace;

            if (this.tagStack.length > 0) {
                if ((this.customOptions.alwaysCreateTextNode && text.trim().length > 0) || 
                    (!this.customOptions.alwaysCreateTextNode && isDecodedTextNonWhitespace)) {
                    let processedContent = this.customOptions.parsePrimitives ? this._tryParsePrimitive(decodedText) : decodedText;
                    if (this.customOptions.alwaysCreateTextNode || (typeof processedContent === 'string' && processedContent.trim().length > 0) || (typeof processedContent !== 'string') ) {
                       addValueToObject(this.currentPointer, textNodeName, processedContent, textNodeName);
                       actualParentOfPartialText = this.currentPointer;
                    }
                }
            } else if (canAddTextAtRoot) {
                 let processedContent = this.customOptions.parsePrimitives ? this._tryParsePrimitive(decodedText) : decodedText;
                 addValueToObject(this.rootObject, textNodeName, processedContent, textNodeName);
                 actualParentOfPartialText = this.rootObject;
            }
        }

        if (endOfProblematicText === buffer.length && text.startsWith('<') && text.length > 1) {
            if (text.startsWith('</')) { 
                if (text.indexOf('>') === -1) {
                     this.incompleteStructureState = { type: 'closing_tag_incomplete', at: startIndex, partial: text, parentOfPartial: actualParentOfPartialText };
                } else {
                     this.incompleteStructureState = null; 
                }
            } else { 
                const potentialTagName = text.substring(1).split(/\s|=|>|\[|\//)[0];
                if (text.indexOf('>') === -1 && /^[a-zA-Z_][\w:-]*$/.test(potentialTagName) && potentialTagName.length > 0) {
                     this.incompleteStructureState = { type: 'opening_tag_incomplete', at: startIndex, partial: text, parentOfPartial: actualParentOfPartialText };
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
            throw new Error("XML chunk for 'parseStream' is accepted in String, Buffer, null, undefined or empty string form.");
        }
        
        if (currentXmlString) {
            this.streamingBuffer += currentXmlString;
            if (!this._activelyStreaming && currentXmlString.trim().length > 0) {
                 this._activelyStreaming = true;
            }
        }

        const isFreshParser = Object.keys(this.rootObject).length === 0 && this.tagStack.length === 0 && !this.incompleteStructureState && this.parsingIndex === 0 && this.streamingBuffer === currentXmlString;

        if (isFreshParser && xmlChunk === "") {
            return { _partial: true, _status: "Waiting for data or empty stream" };
        }
        if (isFreshParser && (xmlChunk === null || xmlChunk === undefined) && this.streamingBuffer.trim() === "") {
            return { _partial: false };
        }

        // Special handling for end of stream (xmlChunk is null or undefined)
        if (xmlChunk === null || xmlChunk === undefined) {
            if (this.incompleteStructureState) {
                const state = this.incompleteStructureState;
                const stateType = state.type;

                // if (stateType === 'cdata' && state.startIndex !== undefined) { // Old logic based on startIndex
                if (stateType === 'cdata') {
                    // If incompleteStructureState is still 'cdata' here, it means ']]>' was never found.
                    // All partial content should have been added by _processBuffer.
                    // The document is considered partial. The generic _partial calculation later will handle this
                    // by checking `!!this.incompleteStructureState`.
                    // No specific text addition or state clearing needed here that isn't already handled,
                    // as _processBuffer would have run one last time.
                } else if ((stateType === 'opening_tag_incomplete' || stateType === 'closing_tag_incomplete') && state.partial) {
                    const partialText = state.partial;
                    // If _handleFallbackText already added this text, this might duplicate.
                    // However, _handleFallbackText now stores parentOfPartial.
                    // If the stream ends and this state is still active, it means the tag was never completed.
                    // The text added by _handleFallbackText should remain.
                    // We just need to ensure the state is cleared so it's not considered an open tag for _partial.
                    // The text was already added by _handleFallbackText.
                    this.incompleteStructureState = null; 
                    // If all remaining buffer was this partial tag, advance parsingIndex
                    if (this.parsingIndex < this.streamingBuffer.length && this.streamingBuffer.substring(this.parsingIndex).trim() === "") {
                        this.parsingIndex = this.streamingBuffer.length;
                    }
                }
            }
        }

        if (this.streamingBuffer.length === this.parsingIndex &&
            (xmlChunk === null || xmlChunk === undefined || (typeof currentXmlString === 'string' && currentXmlString.length === 0)) &&
            this.incompleteStructureState) {
             const result = JSON.parse(JSON.stringify(this.rootObject));
             result._partial = true; 
             // Status messages removed to align with test expectations
             // if (this.incompleteStructureState.type) { 
             //    result._status = "Waiting for data for " + this.incompleteStructureState.type;
             // } else {
             //    result._status = "Waiting for data";
             // }
             return result;
        }
        
        this._processBuffer();

        const returnObject = JSON.parse(JSON.stringify(this.rootObject)); 
        let isReturnPartial = (this.tagStack.length > 0 || !!this.incompleteStructureState);
        
        if (xmlChunk === null || xmlChunk === undefined) { 
            if (this.incompleteStructureState && 
                (this.incompleteStructureState.type === 'doctype' || this.incompleteStructureState.type === 'xmldecl')) {
                if (Object.keys(this.rootObject).length === 0 && this.tagStack.length === 0) {
                    isReturnPartial = false; 
                    this.incompleteStructureState = null; 
                }
            } else if (this.incompleteStructureState) { 
                isReturnPartial = true;
            } else if (this.tagStack.length > 0) { 
                isReturnPartial = true;
            } else {
                isReturnPartial = false;
            }
            returnObject._partial = isReturnPartial;

            if (!isReturnPartial) { // When stream ends and parsing is complete
                this.streamingBuffer = "";
                this.parsingIndex = 0;
                this._activelyStreaming = false;
            }
            // Removed status for empty document to align with test expectations
            // if (!returnObject._partial && Object.keys(this.rootObject).length === 0 && this.streamingBuffer.trim() === "") {
            //      returnObject._status = "Empty document";
            // }
        } else {
            returnObject._partial = isReturnPartial;
        }

        // If it's the end of the stream and the document is effectively empty (only processing instructions, comments),
        // and no actual content tags were processed, reflect that.
        if ((xmlChunk === null || xmlChunk === undefined) && !returnObject._partial && Object.keys(this.rootObject).length === 0 && this.streamingBuffer.trim() !== "") {
            const tempBuffer = this.streamingBuffer.replace(/<\?xml[^?]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/g, '').trim();
            if (tempBuffer === "") {
                // returnObject._status = "Empty document"; // Keep this commented to align with tests
            }
        }
        
        return returnObject;
    }
}

    module.exports = PartialXMLStreamParser;