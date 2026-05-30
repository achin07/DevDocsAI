export type GitaSectionType = 'TEXT' | 'SYNONYMS' | 'TRANSLATION' | 'PURPORT';

export interface TextChunk {
  content: string;
  chunkIndex: number;

  tokenEstimate: number;
  charCount: number;

  startChar: number;
  endChar: number;

  pageStart?: number;
  pageEnd?: number;

  sectionTitle?: string;

  strategy: string;

  previousChunkIndex?: number;
  nextChunkIndex?: number;

  contextHeader: string;

  metadata: {
    strategy: string;
    sourceName?: string;
    maxChars: number;
    overlapChars: number;

    documentType: 'gita-structured' | 'generic';
    sectionType?: GitaSectionType;

    chapterNumber?: number;
    chapterTitle?: string;
    textNumber?: string;

    includeInSemanticIndex?: boolean;
    searchPriority?: 'low' | 'medium' | 'high';
  };
}

type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
  sourceName?: string;

  /**
   * For Gita-style PDFs:
   * Sanskrit/original text is often not useful for English semantic search,
   * so default false.
   */
  includeOriginalText?: boolean;

  /**
   * Synonyms are useful for word-meaning queries, so default true.
   */
  includeSynonyms?: boolean;
};

type ParsedMarker = {
  type: 'CHAPTER' | 'TEXT' | 'SYNONYMS' | 'TRANSLATION' | 'PURPORT';
  index: number;
  endIndex: number;

  chapterNumber?: number;
  chapterTitle?: string;
  textNumber?: string;
};

type ActiveContext = {
  chapterNumber?: number;
  chapterTitle?: string;
  textNumber?: string;
};

const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

const normalizeText = (text: string): string => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const buildContextHeader = (params: {
  sourceName?: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  chapterNumber?: number;
  chapterTitle?: string;
  textNumber?: string;
  sectionType?: GitaSectionType;
  sectionTitle?: string;
}): string => {
  const lines: string[] = [];

  if (params.sourceName) {
    lines.push(`Source: ${params.sourceName}`);
  }

  if (params.chapterNumber) {
    const chapterLine = params.chapterTitle
      ? `Chapter ${params.chapterNumber}: ${params.chapterTitle}`
      : `Chapter ${params.chapterNumber}`;

    lines.push(chapterLine);
  }

  if (params.textNumber) {
    lines.push(`Text: ${params.textNumber}`);
  }

  if (params.sectionType) {
    lines.push(`Section: ${params.sectionType}`);
  }

  if (params.sectionTitle) {
    lines.push(`Section title: ${params.sectionTitle}`);
  }

  lines.push(`Chunk: ${params.chunkIndex}`);
  lines.push(`Character range: ${params.startChar}-${params.endChar}`);

  return lines.join('\n');
};

const addNeighbourIndexes = (chunks: TextChunk[]): TextChunk[] => {
  return chunks.map((chunk, index) => ({
    ...chunk,
    previousChunkIndex: index > 0 ? chunks[index - 1].chunkIndex : undefined,
    nextChunkIndex: index < chunks.length - 1 ? chunks[index + 1].chunkIndex : undefined,
  }));
};

const findGitaMarkers = (text: string): ParsedMarker[] => {
  const markers: ParsedMarker[] = [];

  /**
   * Supported examples:
   *
   * CHAPTER 1- 'OBSERVING THE ARMIES'
   * CHAPTER 2 - Contents of the Gita Summarized
   * TEXT-1
   * TEXT 1
   * TEXTS 1-2
   * SYNONYMS
   * TRANSLATION
   * PURPORT
   */
  const markerRegex =
    /^(?:\s*)(CHAPTER\s+(\d+)\s*[-–—]\s*['"“”]?(.+?)['"“”]?\s*|TEXTS?\s*[-–—]?\s*(\d+(?:\s*[-–—]\s*\d+)?)\s*|SYNONYMS\s*|TRANSLATION\s*|PURPORT\s*)$/gim;

  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    const fullMarker = match[1].trim();
    const markerUpper = fullMarker.toUpperCase();

    if (markerUpper.startsWith('CHAPTER')) {
      markers.push({
        type: 'CHAPTER',
        index: match.index,
        endIndex: markerRegex.lastIndex,
        chapterNumber: Number(match[2]),
        chapterTitle: match[3]?.trim(),
      });

      continue;
    }

    if (markerUpper.startsWith('TEXT')) {
      const normalizedTextNumber = match[4]?.replace(/\s+/g, '').replace(/[–—]/g, '-');

      markers.push({
        type: 'TEXT',
        index: match.index,
        endIndex: markerRegex.lastIndex,
        textNumber: normalizedTextNumber,
      });

      continue;
    }

    if (markerUpper === 'SYNONYMS') {
      markers.push({
        type: 'SYNONYMS',
        index: match.index,
        endIndex: markerRegex.lastIndex,
      });

      continue;
    }

    if (markerUpper === 'TRANSLATION') {
      markers.push({
        type: 'TRANSLATION',
        index: match.index,
        endIndex: markerRegex.lastIndex,
      });

      continue;
    }

    if (markerUpper === 'PURPORT') {
      markers.push({
        type: 'PURPORT',
        index: match.index,
        endIndex: markerRegex.lastIndex,
      });
    }
  }

  return markers;
};

const shouldUseGitaChunking = (markers: ParsedMarker[]): boolean => {
  const hasChapter = markers.some((marker) => marker.type === 'CHAPTER');
  const hasText = markers.some((marker) => marker.type === 'TEXT');
  const hasTranslationOrPurport = markers.some(
    (marker) => marker.type === 'TRANSLATION' || marker.type === 'PURPORT',
  );

  return hasChapter && hasText && hasTranslationOrPurport;
};

const splitLongContentParagraphAware = (params: {
  content: string;
  absoluteStartChar: number;
  maxChars: number;
  overlapChars: number;
}): Array<{
  content: string;
  startChar: number;
  endChar: number;
}> => {
  const { content, absoluteStartChar, maxChars, overlapChars } = params;

  const parts: Array<{
    content: string;
    startChar: number;
    endChar: number;
  }> = [];

  let localStart = 0;

  while (localStart < content.length) {
    let localEnd = Math.min(localStart + maxChars, content.length);

    const paragraphBreak = content.lastIndexOf('\n\n', localEnd);

    if (paragraphBreak > localStart + maxChars * 0.5) {
      localEnd = paragraphBreak;
    }

    const partContent = content.slice(localStart, localEnd).trim();

    if (partContent.length > 0) {
      const leadingWhitespace = content
        .slice(localStart, localEnd)
        .length - content.slice(localStart, localEnd).trimStart().length;

      const trailingWhitespace = content
        .slice(localStart, localEnd)
        .length - content.slice(localStart, localEnd).trimEnd().length;

      parts.push({
        content: partContent,
        startChar: absoluteStartChar + localStart + leadingWhitespace,
        endChar: absoluteStartChar + localEnd - trailingWhitespace,
      });
    }

    if (localEnd >= content.length) {
      break;
    }

    localStart = Math.max(0, localEnd - overlapChars);
  }

  return parts;
};

const createGitaChunk = (params: {
  content: string;
  chunkIndex: number;

  startChar: number;
  endChar: number;

  sourceName?: string;
  maxChars: number;
  overlapChars: number;

  context: ActiveContext;
  sectionType: GitaSectionType;

  strategy: string;
  includeInSemanticIndex: boolean;
  searchPriority: 'low' | 'medium' | 'high';
}): TextChunk => {
  const sectionTitleParts: string[] = [];

  if (params.context.chapterNumber) {
    sectionTitleParts.push(
      params.context.chapterTitle
        ? `Chapter ${params.context.chapterNumber}: ${params.context.chapterTitle}`
        : `Chapter ${params.context.chapterNumber}`,
    );
  }

  if (params.context.textNumber) {
    sectionTitleParts.push(`Text ${params.context.textNumber}`);
  }

  sectionTitleParts.push(params.sectionType);

  const sectionTitle = sectionTitleParts.join(' | ');

  const contextHeader = buildContextHeader({
    sourceName: params.sourceName,
    chunkIndex: params.chunkIndex,
    startChar: params.startChar,
    endChar: params.endChar,
    chapterNumber: params.context.chapterNumber,
    chapterTitle: params.context.chapterTitle,
    textNumber: params.context.textNumber,
    sectionType: params.sectionType,
    sectionTitle,
  });

  return {
    content: params.content,
    chunkIndex: params.chunkIndex,

    tokenEstimate: estimateTokens(`${contextHeader}\n\n${params.content}`),
    charCount: params.content.length,

    startChar: params.startChar,
    endChar: params.endChar,

    sectionTitle,
    strategy: params.strategy,

    contextHeader,

    metadata: {
      strategy: params.strategy,
      sourceName: params.sourceName,
      maxChars: params.maxChars,
      overlapChars: params.overlapChars,

      documentType: 'gita-structured',
      sectionType: params.sectionType,

      chapterNumber: params.context.chapterNumber,
      chapterTitle: params.context.chapterTitle,
      textNumber: params.context.textNumber,

      includeInSemanticIndex: params.includeInSemanticIndex,
      searchPriority: params.searchPriority,
    },
  };
};

const chunkGitaStructuredText = (
  text: string,
  options: Required<Pick<ChunkOptions, 'maxChars' | 'overlapChars'>> &
    Pick<ChunkOptions, 'sourceName' | 'includeOriginalText' | 'includeSynonyms'>,
): TextChunk[] => {
  const markers = findGitaMarkers(text);

  if (!shouldUseGitaChunking(markers)) {
    return [];
  }

  const chunks: TextChunk[] = [];
  const strategy = 'gita-contextual-section-aware';

  let context: ActiveContext = {};
  let chunkIndex = 0;

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const nextMarker = markers[i + 1];

    if (marker.type === 'CHAPTER') {
      context = {
        chapterNumber: marker.chapterNumber,
        chapterTitle: marker.chapterTitle,
        textNumber: undefined,
      };

      continue;
    }

    if (marker.type === 'TEXT') {
      context = {
        ...context,
        textNumber: marker.textNumber,
      };
    }

    const sectionType = marker.type as GitaSectionType;

    const rawBlockEnd = nextMarker ? nextMarker.index : text.length;
    const rawBlock = text.slice(marker.endIndex, rawBlockEnd);

    const trimmedBlock = rawBlock.trim();

    if (!trimmedBlock) {
      continue;
    }

    const leadingWhitespaceLength = rawBlock.length - rawBlock.trimStart().length;
    const absoluteStartChar = marker.endIndex + leadingWhitespaceLength;

    const shouldKeepSection =
      sectionType === 'TRANSLATION' ||
      sectionType === 'PURPORT' ||
      (sectionType === 'SYNONYMS' && options.includeSynonyms !== false) ||
      (sectionType === 'TEXT' && options.includeOriginalText === true);

    if (!shouldKeepSection) {
      continue;
    }

    const includeInSemanticIndex =
      sectionType === 'TRANSLATION' ||
      sectionType === 'PURPORT' ||
      sectionType === 'SYNONYMS';

    const searchPriority =
      sectionType === 'TRANSLATION' || sectionType === 'PURPORT'
        ? 'high'
        : sectionType === 'SYNONYMS'
          ? 'medium'
          : 'low';

    /**
     * TRANSLATION is usually short and should stay as one chunk.
     * SYNONYMS is useful as one separate glossary-like chunk unless too long.
     * PURPORT can be long, so split it paragraph-aware.
     */
    const shouldSplit =
      sectionType === 'PURPORT' || trimmedBlock.length > options.maxChars;

    const blockParts = shouldSplit
      ? splitLongContentParagraphAware({
          content: trimmedBlock,
          absoluteStartChar,
          maxChars: options.maxChars,
          overlapChars: options.overlapChars,
        })
      : [
          {
            content: trimmedBlock,
            startChar: absoluteStartChar,
            endChar: absoluteStartChar + trimmedBlock.length,
          },
        ];

    for (const part of blockParts) {
      chunks.push(
        createGitaChunk({
          content: part.content,
          chunkIndex,

          startChar: part.startChar,
          endChar: part.endChar,

          sourceName: options.sourceName,
          maxChars: options.maxChars,
          overlapChars: options.overlapChars,

          context,
          sectionType,

          strategy,
          includeInSemanticIndex,
          searchPriority,
        }),
      );

      chunkIndex++;
    }
  }

  return addNeighbourIndexes(chunks);
};

const findSectionTitle = (text: string, startChar: number): string | undefined => {
  const textBeforeChunk = text.slice(0, startChar);
  const lines = textBeforeChunk.split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    const markdownHeadingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (markdownHeadingMatch) {
      return markdownHeadingMatch[1].trim();
    }

    const chapterMatch = line.match(/^CHAPTER\s+([0-9IVXLC]+).*/i);
    if (chapterMatch) {
      return line;
    }
  }

  return undefined;
};

const chunkGenericText = (
  text: string,
  options: Required<Pick<ChunkOptions, 'maxChars' | 'overlapChars'>> &
    Pick<ChunkOptions, 'sourceName'>,
): TextChunk[] => {
  const chunks: TextChunk[] = [];
  const strategy = 'contextual-paragraph-aware-fixed-size';

  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    let end = Math.min(start + options.maxChars, text.length);

    const paragraphBreak = text.lastIndexOf('\n\n', end);

    if (paragraphBreak > start + options.maxChars * 0.5) {
      end = paragraphBreak;
    }

    const content = text.slice(start, end).trim();

    if (content.length > 0) {
      const sectionTitle = findSectionTitle(text, start);

      const contextHeader = buildContextHeader({
        sourceName: options.sourceName,
        chunkIndex,
        startChar: start,
        endChar: end,
        sectionTitle,
      });

      chunks.push({
        content,
        chunkIndex,

        tokenEstimate: estimateTokens(`${contextHeader}\n\n${content}`),
        charCount: content.length,

        startChar: start,
        endChar: end,

        sectionTitle,
        strategy,

        contextHeader,

        metadata: {
          strategy,
          sourceName: options.sourceName,
          maxChars: options.maxChars,
          overlapChars: options.overlapChars,

          documentType: 'generic',

          includeInSemanticIndex: true,
          searchPriority: 'medium',
        },
      });

      chunkIndex++;
    }

    if (end >= text.length) {
      break;
    }

    start = Math.max(0, end - options.overlapChars);
  }

  return addNeighbourIndexes(chunks);
};

export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
  const maxChars = options?.maxChars ?? 1200;
  const overlapChars = options?.overlapChars ?? 150;

  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return [];
  }

  const normalizedOptions = {
    maxChars,
    overlapChars,
    sourceName: options?.sourceName,
    includeOriginalText: options?.includeOriginalText ?? false,
    includeSynonyms: options?.includeSynonyms ?? true,
  };

  const gitaChunks = chunkGitaStructuredText(normalizedText, normalizedOptions);

  if (gitaChunks.length > 0) {
    return gitaChunks;
  }

  return chunkGenericText(normalizedText, normalizedOptions);
}