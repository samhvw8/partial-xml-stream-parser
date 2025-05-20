// PartialXMLStreamParser.js (Lenient Streaming Focus)
// import { DEFAULT_STREAM_OPTIONS } from "./src/options.js"; // Removed
import { processXmlChunk, finalizeStreamResult } from "./src/stream-processor.js";
import { coreProcessBuffer } from "./src/core-parser.js";
import { initializeParserOptions, resetParserState } from "./src/parser-setup.js";

class PartialXMLStreamParser {
  constructor(options) {
    initializeParserOptions(this, options);
    this.reset(); // Calls the modified reset method below
  }

  reset() {
    resetParserState(this);
  }

  _processBuffer() {
    coreProcessBuffer(this);
  }

  // _handleFallbackText removed

  parseStream(xmlChunk) {
    const chunkProcessingResult = processXmlChunk(this, xmlChunk);

    if (chunkProcessingResult.earlyExitResult) {
      return chunkProcessingResult.earlyExitResult;
    }

    // Only call _processBuffer if the chunk processor determined it's necessary
    // and there's actually something in the streamingBuffer to process,
    // or if there's an incomplete state that needs resolving even with an empty new chunk.
    if (chunkProcessingResult.shouldProcessBuffer && (this.streamingBuffer.length > 0 || this.incompleteStructureState)) {
      this._processBuffer();
    } else if (chunkProcessingResult.shouldProcessBuffer && xmlChunk === null && this.incompleteStructureState) {
      // Special case for EOF with only incomplete state and empty buffer.
      this._processBuffer();
    }


    return finalizeStreamResult(this, xmlChunk);
  }
}

module.exports = PartialXMLStreamParser;
