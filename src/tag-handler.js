// src/tag-handler.js
import { addValueToObject } from "./dom-builder.js";
import { tryParsePrimitive, decodeXmlEntities, parseAttributes } from "./utils.js";
import {
  STATIC_OPENING_TAG_REGEX,
  STATIC_CLOSING_TAG_REGEX,
  COMMON_ENTITIES,
} from "./constants.js";

export function handleSpecialPrefixes(parserContext, buffer, charAfterLT) {
  const i = parserContext.parsingIndex;
  const len = buffer.length;
  const textNodeName = parserContext.customOptions.textNodeName;

  if (charAfterLT === "?") {
    if (buffer.startsWith("<?xml", i)) {
      const endDeclaration = buffer.indexOf("?>", i + 5);
      if (endDeclaration === -1) {
        parserContext.incompleteStructureState = {
          type: "xmldecl",
          lookingFor: "?>",
          at: i,
          partial: buffer.substring(i, len),
        };
        parserContext.parsingIndex = len;
        return { matched: true, shouldReturn: true, shouldContinue: false };
      }
      parserContext.parsingIndex = endDeclaration + 2;
      parserContext.incompleteStructureState = null;
      return { matched: true, shouldReturn: false, shouldContinue: true };
    }
  } else if (charAfterLT === "!") {
    if (i + 3 < len && buffer[i + 2] === "-" && buffer[i + 3] === "-") { // <!--
      const commentEnd = buffer.indexOf("-->", i + 4);
      if (commentEnd === -1) {
        parserContext.incompleteStructureState = {
          type: "comment",
          lookingFor: "-->",
          at: i,
          partial: buffer.substring(i, len),
        };
        parserContext.parsingIndex = len;
        return { matched: true, shouldReturn: true, shouldContinue: false };
      }
      parserContext.parsingIndex = commentEnd + 3;
      parserContext.incompleteStructureState = null;
      return { matched: true, shouldReturn: false, shouldContinue: true };
    } else if (buffer.startsWith("<![CDATA[", i)) {
      const cdataOpenTagEnd = i + 9;
      const cdataCloseMarker = "]]>";
      const cdataEnd = buffer.indexOf(cdataCloseMarker, cdataOpenTagEnd);
      if (cdataEnd === -1) { // Incomplete CDATA
        const partialContent = buffer.substring(cdataOpenTagEnd, len);
        let currentPartialData = "";
        if (parserContext.incompleteStructureState && parserContext.incompleteStructureState.type === 'cdata' && parserContext.incompleteStructureState.at === i) {
            currentPartialData = parserContext.incompleteStructureState.partialData || "";
        }
        
        parserContext.incompleteStructureState = {
          type: "cdata",
          lookingFor: cdataCloseMarker,
          at: i, 
          partialData: currentPartialData + partialContent,
        };
        // Provisional text for incomplete CDATA was handled by state-processor or main loop before,
        // For now, this function focuses on setting state for incomplete special tags.
        // The original logic in handleSpecialPrefixes did add to currentPointer/accumulator here.
        // Let's replicate that if it's intended to be part of this function's responsibility.
        // Based on prompt's provided `handleSpecialPrefixes` for `src/tag-handler.js`, it does add.
        if (partialContent.length > 0) { // Add the new segment provisionally
            if (parserContext.tagStack.length > 0 && parserContext.currentPointer) {
                addValueToObject(parserContext.currentPointer, textNodeName, partialContent, parserContext.customOptions);
            } else if (parserContext.tagStack.length === 0) {
                // Avoid duplicating if it's the first part of an already tracked incomplete CDATA
                if (!(parserContext.incompleteStructureState && parserContext.incompleteStructureState.type === 'cdata' && currentPartialData !== "")) {
                     // This logic is tricky; state-processor usually handles adding from partialData.
                     // The provided `handleSpecialPrefixes` has this direct add.
                }
            }
        }
        parserContext.parsingIndex = len;
        return { matched: true, shouldReturn: true, shouldContinue: false };
      } else { // CDATA finished in this chunk
        let text = buffer.substring(cdataOpenTagEnd, cdataEnd);
        parserContext.parsingIndex = cdataEnd + cdataCloseMarker.length;
        
        const prevPartialData = (parserContext.incompleteStructureState && parserContext.incompleteStructureState.type === 'cdata' && parserContext.incompleteStructureState.at === i) ? parserContext.incompleteStructureState.partialData : "";
        const fullTextContent = prevPartialData + text;

        const processedCDATA = parserContext.customOptions.parsePrimitives
          ? tryParsePrimitive(fullTextContent)
          : fullTextContent;

        if (fullTextContent.length > 0) {
          if (parserContext.tagStack.length > 0 && parserContext.currentPointer) {
            // If there was a prevPartialData, it might have been added provisionally.
            // The `addValueToObject` with `alwaysCreateTextNode: true` might append.
            // If `alwaysCreateTextNode: false` and it was the only text, it might replace.
            // This needs to be handled carefully to avoid duplication or data loss.
            // For now, assume addValueToObject handles it correctly or state-processor cleans up.
            addValueToObject(
              parserContext.currentPointer,
              textNodeName,
              processedCDATA,
              parserContext.customOptions,
            );
          } else if (parserContext.tagStack.length === 0) {
            parserContext.accumulator.push(processedCDATA);
          }
        }
        parserContext.incompleteStructureState = null;
        return { matched: true, shouldReturn: false, shouldContinue: true };
      }
    } else if (buffer.startsWith("<!DOCTYPE", i)) {
      const endDoctype = buffer.indexOf(">", i + 9);
      if (endDoctype === -1) {
        parserContext.incompleteStructureState = {
          type: "doctype",
          lookingFor: ">",
          at: i,
          partial: buffer.substring(i, len),
        };
        parserContext.parsingIndex = len;
        return { matched: true, shouldReturn: true, shouldContinue: false };
      }
      parserContext.parsingIndex = endDoctype + 1;
      parserContext.incompleteStructureState = null;
      return { matched: true, shouldReturn: false, shouldContinue: true };
    }
  }

  return { matched: false, shouldReturn: false, shouldContinue: false };
}

export function handleClosingTag(parserContext, tagString) {
  const textNodeName = parserContext.customOptions.textNodeName;
  const match = tagString.match(STATIC_CLOSING_TAG_REGEX);
  if (match) {
    const tagName = match[1];
    if (
      parserContext.tagStack.length > 0 &&
      parserContext.tagStack[parserContext.tagStack.length - 1].tagName === tagName
    ) {
      const closedTagState = parserContext.tagStack.pop();
      parserContext.currentPointer =
        parserContext.tagStack.length > 0
          ? parserContext.tagStack[parserContext.tagStack.length - 1].objPtr
          : null;

      if (
        !parserContext.customOptions.alwaysCreateTextNode &&
        closedTagState.textOnly &&
        closedTagState.objPtr.hasOwnProperty(textNodeName) &&
        Object.keys(closedTagState.objPtr).length === 1
      ) {
        const textVal = closedTagState.objPtr[textNodeName];
        if (parserContext.currentPointer) {
          for (const keyInParent in parserContext.currentPointer) {
            if (
              parserContext.currentPointer[keyInParent] === closedTagState.objPtr
            ) {
              parserContext.currentPointer[keyInParent] = textVal;
              break;
            } else if (
              Array.isArray(parserContext.currentPointer[keyInParent])
            ) {
              const arr = parserContext.currentPointer[keyInParent];
              const idx = arr.indexOf(closedTagState.objPtr);
              if (idx !== -1) {
                arr[idx] = textVal;
                break;
              }
            }
          }
        } else {
          for (let k = 0; k < parserContext.accumulator.length; k++) {
            if (
              typeof parserContext.accumulator[k] === "object" &&
              parserContext.accumulator[k] !== null
            ) {
              const rootTagNameFromAccumulator = Object.keys(
                parserContext.accumulator[k],
              )[0];
              if (
                rootTagNameFromAccumulator === closedTagState.tagName &&
                parserContext.accumulator[k][rootTagNameFromAccumulator] ===
                  closedTagState.objPtr
              ) {
                parserContext.accumulator[k][rootTagNameFromAccumulator] =
                  textVal;
                break;
              }
            }
          }
        }
      }
    }
    parserContext.parsingIndex += tagString.length;
    parserContext.incompleteStructureState = null;
    parserContext.reparsedSegmentContext = null;
    return true;
  }
  return false;
}

export function handleOpeningTag(parserContext, tagString, i) {
  const buffer = parserContext.streamingBuffer;
  const len = buffer.length;
  const textNodeName = parserContext.customOptions.textNodeName;
  const attributeNamePrefix =
    parserContext.customOptions.attributeNamePrefix !== undefined
      ? parserContext.customOptions.attributeNamePrefix
      : "@";

  const match = tagString.match(STATIC_OPENING_TAG_REGEX);
  if (match) {
    const tagName = match[1];
    if (
      parserContext.reparsedSegmentContext &&
      parserContext.reparsedSegmentContext.parentContext &&
      parserContext.reparsedSegmentContext.partialText !== undefined &&
      parserContext.currentPointer === parserContext.reparsedSegmentContext.parentContext
    ) {
      const { partialText, parentContext } =
        parserContext.reparsedSegmentContext;
      const textNodeNameToUse = parserContext.customOptions.textNodeName;

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
    parserContext.reparsedSegmentContext = null;

    const attributesString = (match[2] || "").trim();
    const isSelfClosing = match[3] === "/";
    const parsedAttributes = parseAttributes(
      attributesString,
      attributeNamePrefix,
      parserContext.customOptions,
      parserContext.attrRegex,
      decodeXmlEntities,
      tryParsePrimitive,
      COMMON_ENTITIES
    );
    const parentPath =
      parserContext.tagStack.length > 0
        ? parserContext.tagStack[parserContext.tagStack.length - 1].path
        : "";
    const currentPath = parentPath
      ? `${parentPath}.${tagName}`
      : tagName;
    const isSimpleStopNode = parserContext.simpleStopNodes.has(tagName);
    const isPathStopNode = parserContext.pathStopNodes.has(currentPath);
    const isStopNode =
      !isSelfClosing && (isSimpleStopNode || isPathStopNode);

    if (isStopNode) {
      const stopNodeObject = { ...parsedAttributes };
      if (parserContext.tagStack.length === 0) {
        parserContext.accumulator.push({ [tagName]: stopNodeObject });
      } else {
        addValueToObject(
          parserContext.currentPointer,
          tagName,
          stopNodeObject,
          parserContext.customOptions,
        );
      }
      const openTagEndOffset = tagString.length;
      const contentStartIndex = i + openTagEndOffset;
      let depth = 1;
      let searchPos = contentStartIndex;
      let rawContentEnd = -1;
      let closingTagLengthVal = 0;
      let contentSearchRegex = parserContext.stopNodeRegexCache[tagName];
      if (!contentSearchRegex) {
        const contentSearchRegexStr = `<\\s*${tagName}(?:\\s[^>]*)?>|<\\/\\s*${tagName}\\s*>`;
        contentSearchRegex = new RegExp(contentSearchRegexStr, "g");
        parserContext.stopNodeRegexCache[tagName] = contentSearchRegex;
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
          parserContext.customOptions,
        );
        parserContext.parsingIndex = rawContentEnd + closingTagLengthVal;
        parserContext.incompleteStructureState = null;
      } else {
        const newPartialContent = buffer.substring(
          contentStartIndex,
          len,
        );
        addValueToObject(
          stopNodeObject,
          textNodeName,
          newPartialContent,
          parserContext.customOptions,
        );
        parserContext.incompleteStructureState = {
          type: "stop_node_content",
          tagName,
          depth,
          contentStartIndex,
          stopNodeObjectRef: stopNodeObject,
          at: i,
        };
        parserContext.parsingIndex = len;
        return { processed: true, shouldReturn: true };
      }
    } else { // Regular opening tag
      const newObjShell = { ...parsedAttributes };
      if (parserContext.tagStack.length === 0) {
        parserContext.accumulator.push({ [tagName]: newObjShell });
        if (!isSelfClosing) {
          parserContext.tagStack.push({
            tagName,
            objPtr: newObjShell,
            path: currentPath,
            textOnly: true,
          });
          parserContext.currentPointer = newObjShell;
        } else {
          parserContext.currentPointer = null;
        }
      } else {
        if (parserContext.tagStack.length > 0)
          parserContext.tagStack[parserContext.tagStack.length - 1].textOnly = false;
        addValueToObject(
          parserContext.currentPointer,
          tagName,
          newObjShell,
          parserContext.customOptions,
        );
        if (!isSelfClosing) {
          parserContext.tagStack.push({
            tagName,
            objPtr: newObjShell,
            path: currentPath,
            textOnly: true,
          });
          parserContext.currentPointer = newObjShell;
        }
      }
      parserContext.parsingIndex = i + tagString.length;
      parserContext.incompleteStructureState = null;
    }
    return { processed: true, shouldReturn: false };
  }
  return { processed: false, shouldReturn: false };
}

export function handleFallbackText(parserContext, buffer, startIndex, textNodeName) {
  let endOfProblematicText = buffer.indexOf("<", startIndex + 1);
  if (endOfProblematicText === -1) endOfProblematicText = buffer.length;

  const fullFallbackText = buffer.substring(startIndex, endOfProblematicText);
  let textToProcessAsContent = fullFallbackText;

  parserContext.incompleteStructureState = null;

  if (
    endOfProblematicText === buffer.length &&
    fullFallbackText.startsWith("<")
  ) {
    if (fullFallbackText === "<") {
      parserContext.incompleteStructureState = {
        type: "tag_start_incomplete",
        at: startIndex,
        partial: "<",
      };
    } else if (fullFallbackText.startsWith("</")) {
      if (fullFallbackText.indexOf(">") === -1) {
        parserContext.incompleteStructureState = {
          type: "closing_tag_incomplete",
          at: startIndex,
          partial: fullFallbackText,
        };
      }
    } else if (fullFallbackText.startsWith("<")) {
      const potentialTagNameMatch = fullFallbackText.match(/^<([\w:-]+)/);
      if (potentialTagNameMatch && fullFallbackText.indexOf(">") === -1) {
        parserContext.incompleteStructureState = {
          type: "opening_tag_incomplete",
          at: startIndex,
          partial: fullFallbackText,
        };
      }
    }

    if (parserContext.incompleteStructureState) {
      textToProcessAsContent = "";
      if (parserContext.tagStack.length > 0 && parserContext.currentPointer) {
        parserContext.incompleteStructureState.parentOfPartial = parserContext.currentPointer;
        const fragmentText = parserContext.incompleteStructureState.partial;
        if (fragmentText && fragmentText.length > 0) {
          const decodedFragment = decodeXmlEntities(fragmentText, COMMON_ENTITIES);
          let processedFragment =
            parserContext.customOptions.parsePrimitives &&
            typeof decodedFragment === "string"
              ? tryParsePrimitive(decodedFragment)
              : decodedFragment;
          
          parserContext.incompleteStructureState.processedPartialForCleanup = processedFragment;

          let skipAddingProvisionalText = false;
          if (
            parserContext.reparsedSegmentContext &&
            parserContext.reparsedSegmentContext.parentContext ===
              parserContext.incompleteStructureState.parentOfPartial &&
            parserContext.reparsedSegmentContext.partialText === processedFragment
          ) {
            skipAddingProvisionalText = true;
          }

          if (!skipAddingProvisionalText && parserContext.incompleteStructureState.parentOfPartial === parserContext.currentPointer) {
            addValueToObject(
              parserContext.currentPointer,
              textNodeName,
              processedFragment,
              parserContext.customOptions,
            );
            if (
              parserContext.tagStack.length > 0 &&
              parserContext.tagStack[parserContext.tagStack.length - 1].objPtr ===
                parserContext.currentPointer
            ) {
              parserContext.tagStack[parserContext.tagStack.length - 1].textOnly = false;
            }
          }
        }
      } else if (parserContext.tagStack.length === 0) {
        parserContext.incompleteStructureState.parentOfPartial = parserContext.accumulator;
      }
    }
  }

  if (textToProcessAsContent.length > 0) {
    const decodedText = decodeXmlEntities(textToProcessAsContent, COMMON_ENTITIES);
    if (decodedText.trim().length > 0) {
      let processedContent = parserContext.customOptions.parsePrimitives
        ? tryParsePrimitive(decodedText)
        : decodedText;
      if (parserContext.tagStack.length > 0 && parserContext.currentPointer) {
        if (parserContext.tagStack.length > 0)
          parserContext.tagStack[parserContext.tagStack.length - 1].textOnly = false;
        addValueToObject(
          parserContext.currentPointer,
          textNodeName,
          processedContent,
          parserContext.customOptions,
        );
      } else if (parserContext.tagStack.length === 0) {
        parserContext.accumulator.push(processedContent);
      }
    }
  }
  return endOfProblematicText;
}
export function handleTextNode(parserContext, i) {
  const buffer = parserContext.streamingBuffer;
  const len = buffer.length;
  const textNodeName = parserContext.customOptions.textNodeName;
  // COMMON_ENTITIES, decodeXmlEntities, tryParsePrimitive, addValueToObject are available from module scope

  let textEnd = buffer.indexOf("<", i);
  if (textEnd === -1) textEnd = len;
  const rawText = buffer.substring(i, textEnd);

  if (rawText.length > 0) {
    const decodedText = decodeXmlEntities(rawText, COMMON_ENTITIES);
    if (decodedText.trim().length > 0) {
      let processedContent = parserContext.customOptions.parsePrimitives
        ? tryParsePrimitive(decodedText)
        : decodedText;

      if (parserContext.tagStack.length > 0 && parserContext.currentPointer) {
        if (parserContext.tagStack.length > 0) { // Ensure parent tag is not marked as textOnly
          parserContext.tagStack[parserContext.tagStack.length - 1].textOnly = false;
        }
        addValueToObject(
          parserContext.currentPointer,
          textNodeName,
          processedContent,
          parserContext.customOptions,
        );
      } else if (parserContext.tagStack.length === 0) { // Text node at the root level
        parserContext.accumulator.push(processedContent);
      }
    }
  }
  parserContext.parsingIndex = textEnd;
  parserContext.incompleteStructureState = null;
}