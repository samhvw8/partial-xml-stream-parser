import { STATIC_OPENING_TAG_REGEX } from "./constants.js";
import { addValueToObject } from "./dom-builder.js";

export function processXmlChunk(parserContext, xmlChunk) {
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

  const isFirstEverChunk = !parserContext._originalBufferHadContent && parserContext.streamingBuffer === "" && parserContext._rootDeterminationBuffer === "" && parserContext._plainTextAccumulator === "" && parserContext.accumulator.length === 0 && parserContext.tagStack.length === 0;
  if (!parserContext._originalBufferHadContent && currentXmlString.length > 0) {
      parserContext._originalBufferHadContent = true;
  }

  // --- BEGIN Conditional XML Parsing Logic ---
  if (parserContext._treatAsPlainText) {
    if (xmlChunk !== null && currentXmlString) {
      parserContext._plainTextAccumulator += currentXmlString;
    }
    const isPartialPlainText = xmlChunk !== null;
    let resultXml = [];
    if (parserContext._plainTextAccumulator.length > 0) {
      resultXml = [parserContext._plainTextAccumulator];
    } else if (xmlChunk === null && !parserContext._originalBufferHadContent && parserContext._plainTextAccumulator === "") {
      resultXml = null;
    }
    return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: isPartialPlainText }, xml: resultXml } };
  }

  if (parserContext.allowedRootNodes && !parserContext._rootTagDecisionMade) {
    if (currentXmlString) {
      parserContext._rootDeterminationBuffer += currentXmlString;
    }

    const bufferToInspect = parserContext._rootDeterminationBuffer;
    const trimmedBufferForTagCheck = bufferToInspect.trimStart();

    if (trimmedBufferForTagCheck.length > 0) {
      if (trimmedBufferForTagCheck.startsWith("<")) { // XML encoded
        const tagMatch = STATIC_OPENING_TAG_REGEX.exec(trimmedBufferForTagCheck);
        if (tagMatch) {
          const rootTagName = tagMatch[1];
          if (parserContext.allowedRootNodes.has(rootTagName)) {
            parserContext._rootTagDecisionMade = true;
            currentXmlString = bufferToInspect;
            parserContext.streamingBuffer = "";
            parserContext.parsingIndex = 0;
            parserContext._rootDeterminationBuffer = "";
          } else {
            parserContext._treatAsPlainText = true;
            parserContext._rootTagDecisionMade = true;
            parserContext._plainTextAccumulator = bufferToInspect;
            parserContext._rootDeterminationBuffer = "";
            return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: xmlChunk !== null }, xml: [parserContext._plainTextAccumulator] } };
          }
        } else {
          const partialTagNameMatch = trimmedBufferForTagCheck.match(/^<([\w:-]+)/);
          if (xmlChunk === null) {
              parserContext._treatAsPlainText = true;
              parserContext._rootTagDecisionMade = true;
              parserContext._plainTextAccumulator = bufferToInspect;
              parserContext._rootDeterminationBuffer = "";
              return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: false }, xml: [parserContext._plainTextAccumulator] } };
          } else if (partialTagNameMatch) {
              const potentialTagName = partialTagNameMatch[1];
              const isPotentiallyAllowed = [...parserContext.allowedRootNodes].some(ar => ar.startsWith(potentialTagName));
              const isExactButIncompleteAllowed = parserContext.allowedRootNodes.has(potentialTagName);

              if (isExactButIncompleteAllowed || isPotentiallyAllowed) {
                  return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: true }, xml: [] } };
              } else {
                  parserContext._treatAsPlainText = true;
                  parserContext._rootTagDecisionMade = true;
                  parserContext._plainTextAccumulator = bufferToInspect;
                  parserContext._rootDeterminationBuffer = "";
                  return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: true }, xml: [parserContext._plainTextAccumulator] } };
              }
          } else {
              return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: true }, xml: [] } };
          }
        }
      } else {
        parserContext._treatAsPlainText = true;
        parserContext._rootTagDecisionMade = true;
        parserContext._plainTextAccumulator = bufferToInspect;
        parserContext._rootDeterminationBuffer = "";
        return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: xmlChunk !== null }, xml: [parserContext._plainTextAccumulator] } };
      }
    } else {
      if (xmlChunk === null) {
          parserContext._rootTagDecisionMade = true;
          if (bufferToInspect.length > 0) {
              parserContext._treatAsPlainText = true;
              parserContext._plainTextAccumulator = bufferToInspect;
              parserContext._rootDeterminationBuffer = "";
              return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: false }, xml: [parserContext._plainTextAccumulator] } };
          } else {
              parserContext._rootDeterminationBuffer = "";
              return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: false }, xml: null } };
          }
      } else {
          if (bufferToInspect.length > 0) {
              parserContext._treatAsPlainText = true;
              parserContext._rootTagDecisionMade = true;
              parserContext._plainTextAccumulator = bufferToInspect;
              parserContext._rootDeterminationBuffer = "";
              return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: true }, xml: [parserContext._plainTextAccumulator] } };
          } else {
               if (isFirstEverChunk && currentXmlString === "") {
                  return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: true }, xml: null } };
               }
               return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: true }, xml: [] } };
          }
      }
    }
  } else if (!parserContext.allowedRootNodes && !parserContext._rootTagDecisionMade) {
    parserContext._rootTagDecisionMade = true;
  }
  // --- END Conditional XML Parsing Logic ---

  if (xmlChunk === null || xmlChunk === undefined) {
      parserContext._activelyStreaming = false;
  } else if (currentXmlString || (parserContext.streamingBuffer && parserContext.streamingBuffer.length > 0) || (parserContext.accumulator && parserContext.accumulator.length > 0)) {
      if (!parserContext._activelyStreaming && (currentXmlString.trim().length > 0 || (parserContext.streamingBuffer.trim().length > 0 && parserContext.parsingIndex < parserContext.streamingBuffer.length))) {
          parserContext._activelyStreaming = true;
      }
  }

  let combinedXmlString = currentXmlString;
  const originalIncompleteState = parserContext.incompleteStructureState;

  if (originalIncompleteState && originalIncompleteState.partial) {
    const fragment = originalIncompleteState.partial;
    combinedXmlString = fragment + currentXmlString;
    parserContext.parsingIndex = 0;

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

      parserContext.reparsedSegmentContext = {
        partialText: textToCleanup,
        parentContext: originalIncompleteState.parentOfPartial,
      };
    }
    parserContext.incompleteStructureState = null;
  }

  if (combinedXmlString) {
    if (!parserContext._activelyStreaming && combinedXmlString.trim().length > 0) {
      parserContext._activelyStreaming = true;
    }
    if (
      parserContext.parsingIndex === 0 &&
      originalIncompleteState &&
      originalIncompleteState.partial &&
      combinedXmlString.startsWith(originalIncompleteState.partial) &&
      combinedXmlString !== currentXmlString
    ) {
      parserContext.streamingBuffer = combinedXmlString;
    } else {
      parserContext.streamingBuffer += combinedXmlString;
    }
  } else if (xmlChunk === "" && isFirstEverChunk) {
    // Handled by the isFreshParserCallForEmptyStream check below
  }

  const isFreshParserCallForEmptyStreamCheck =
    parserContext.accumulator.length === 0 &&
    parserContext.tagStack.length === 0 &&
    !parserContext.incompleteStructureState &&
    parserContext.parsingIndex === 0 &&
    parserContext.streamingBuffer === "" &&
    parserContext._rootDeterminationBuffer === "" &&
    parserContext._plainTextAccumulator === "";

  if (
    isFreshParserCallForEmptyStreamCheck &&
    currentXmlString === "" &&
    (xmlChunk === "" || xmlChunk === null || xmlChunk === undefined)
  ) {
    if (xmlChunk === null || xmlChunk === undefined) {
      return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: false }, xml: null } };
    } else {
      return { shouldProcessBuffer: false, earlyExitResult: { metadata: { partial: true }, xml: null } };
    }
  }

  if (xmlChunk === null || xmlChunk === undefined) {
    parserContext.streamingBufferBeforeClear = parserContext.streamingBuffer;
  }
  // The decision to call _processBuffer is now returned
  return { shouldProcessBuffer: true, earlyExitResult: null };
}

export function finalizeStreamResult(parserContext, xmlChunk) {
  if (parserContext.parsingIndex > 0) {
    const sliceAmount = parserContext.parsingIndex;

    if (
      parserContext.incompleteStructureState &&
      parserContext.incompleteStructureState.at !== undefined
    ) {
      parserContext.incompleteStructureState.at -= sliceAmount;
      if (parserContext.incompleteStructureState.at < 0) {
        parserContext.incompleteStructureState.at = 0;
      }

      if (
        parserContext.incompleteStructureState.type === "stop_node_content" &&
        parserContext.incompleteStructureState.contentStartIndex !== undefined
      ) {
        parserContext.incompleteStructureState.contentStartIndex -= sliceAmount;
        if (parserContext.incompleteStructureState.contentStartIndex < 0)
          parserContext.incompleteStructureState.contentStartIndex = 0;
      }
    }
    if (
      parserContext.reparsedSegmentContext &&
      parserContext.reparsedSegmentContext.originalIndex !== undefined
    ) {
      if (parserContext.reparsedSegmentContext.originalIndex < sliceAmount) {
        parserContext.reparsedSegmentContext = null;
      } else {
        parserContext.reparsedSegmentContext.originalIndex -= sliceAmount;
      }
    }

    parserContext.streamingBuffer = parserContext.streamingBuffer.substring(sliceAmount);
    parserContext.parsingIndex = 0;
  }

  let finalXmlContent = parserContext.accumulator.length > 0 ? parserContext.accumulator : [];
  let isReturnPartial =
    parserContext.tagStack.length > 0 || !!parserContext.incompleteStructureState;

  let isSpecialOnlyAtEOF = false;

  if (xmlChunk === null || xmlChunk === undefined) { // EOF
    if (parserContext.incompleteStructureState) {
      const stateType = parserContext.incompleteStructureState.type;
      const isSpecialIncomplete = stateType === "doctype" || stateType === "xmldecl" || stateType === "comment";

      if (isSpecialIncomplete && parserContext.accumulator.length === 0 && parserContext.tagStack.length === 0) {
        const remainingBufferIsJustPartial = (parserContext.streamingBufferBeforeClear || parserContext.streamingBuffer).trim() === (parserContext.incompleteStructureState.partial || "").trim();
        if (remainingBufferIsJustPartial) {
          isReturnPartial = false;
          parserContext.incompleteStructureState = null;
          isSpecialOnlyAtEOF = true;
          finalXmlContent = [];
        } else {
          isReturnPartial = true;
        }
      } else if ( (stateType === "opening_tag_incomplete" || stateType === "tag_start_incomplete" || stateType === "closing_tag_incomplete") && parserContext.incompleteStructureState.partial) {
          isReturnPartial = true;
          const fragment = parserContext.incompleteStructureState.partial;
          if (parserContext.accumulator.length === 0 && !parserContext._treatAsPlainText) {
              finalXmlContent = [{ [parserContext.customOptions.textNodeName]: fragment }];
          } else if (parserContext.tagStack.length > 0 && parserContext.currentPointer && !parserContext._treatAsPlainText) {
               let needsAdding = true;
               if (parserContext.currentPointer.hasOwnProperty(parserContext.customOptions.textNodeName)) {
                  const currentText = parserContext.currentPointer[parserContext.customOptions.textNodeName];
                  if ((typeof currentText === 'string' && currentText.endsWith(fragment)) ||
                      (Array.isArray(currentText) && currentText.some(t => typeof t === 'string' && t.endsWith(fragment)))) {
                      needsAdding = false;
                  }
               }
               if(needsAdding) addValueToObject(parserContext.currentPointer, parserContext.customOptions.textNodeName, fragment, parserContext.customOptions);
               finalXmlContent = parserContext.accumulator.length > 0 ? parserContext.accumulator : [];
          }
      } else {
        isReturnPartial = true;
      }
    } else if (parserContext.tagStack.length > 0) {
      isReturnPartial = true;
    } else {
      isReturnPartial = false;
    }

    if (!isReturnPartial) {
      const effectiveBufferContent = parserContext.streamingBufferBeforeClear || parserContext.streamingBuffer;
      const tempBufferForNullCheck = effectiveBufferContent.replace(/<\?xml[^?]*\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/g, "").trim();

      if (isSpecialOnlyAtEOF) {
          finalXmlContent = [];
      } else if (parserContext.accumulator.length === 0 && tempBufferForNullCheck === "") {
           if (!parserContext._originalBufferHadContent && effectiveBufferContent === "") {
              finalXmlContent = null;
          } else {
              finalXmlContent = [];
          }
      } else if (parserContext.accumulator.length === 0 && tempBufferForNullCheck !== "" && !parserContext._treatAsPlainText) {
          finalXmlContent = [tempBufferForNullCheck];
      } else if (parserContext.accumulator.length > 0) {
          finalXmlContent = parserContext.accumulator;
      } else {
          finalXmlContent = [];
      }

      parserContext.streamingBuffer = ""; parserContext.parsingIndex = 0; parserContext._activelyStreaming = false;
      parserContext._originalBufferHadContent = false; parserContext.incompleteStructureState = null;
      parserContext.streamingBufferBeforeClear = ""; parserContext._lastClearedIncompleteStateWasSpecial = isSpecialOnlyAtEOF;
    } else {
       if (!(parserContext.incompleteStructureState && (parserContext.incompleteStructureState.type === "opening_tag_incomplete" || parserContext.incompleteStructureState.type === "tag_start_incomplete" || parserContext.incompleteStructureState.type === "closing_tag_incomplete"))) {
          finalXmlContent = parserContext.accumulator.length > 0 ? parserContext.accumulator : [];
      }
      if (parserContext.incompleteStructureState) parserContext.reparsedSegmentContext = null;
    }
  }

  const result = {
    metadata: { partial: isReturnPartial },
    xml: finalXmlContent,
  };

  if (xmlChunk === null && !result.metadata.partial) {
      if (isSpecialOnlyAtEOF) { 
          result.xml = [];
      } else if (result.xml && result.xml.length === 0 && !parserContext._originalBufferHadContent && (parserContext.streamingBufferBeforeClear || parserContext.streamingBuffer).trim() === "") {
          result.xml = null;
      } else if (result.xml === null && parserContext._originalBufferHadContent && (parserContext.streamingBufferBeforeClear || parserContext.streamingBuffer).trim() === "" && parserContext.accumulator.length === 0) {
          result.xml = [];
      }
  }

  return result;
}