export type GitaSectionType = 'TEXT' | 'SYNONYMS' | 'TRANSLATION' | 'PURPORT';

export type DocumentType = 'gita-structured' | 'generic';

export type ChunkStrategy =
  | 'gita-hybrid-structured-window-semantic-ready'
  | 'generic-paragraph-window-semantic-ready';

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

  strategy: ChunkStrategy;

  previousChunkIndex?: number;
  nextChunkIndex?: number;

  /**
   * Human-readable context that can be prepended before embedding or before
   * sending retrieved chunks to the LLM.
   *
   * Important:
   * - Keep the raw `content` clean.
   * - Keep retrieval/citation context here.
   */
  contextHeader: string;

  metadata: {
    strategy: ChunkStrategy;
    sourceName?: string;

    maxChars: number;
    overlapChars: number;

    documentType: DocumentType;
    sectionType?: GitaSectionType;

    chapterNumber?: number;
    chapterTitle?: string;
    textNumber?: string;

    /**
     * These fields are for the next phase: embeddings + semantic retrieval.
     *
     * semanticGroupId:
     *   Stable logical group, e.g. gita-ch1-text1-purport.
     *   Useful for joining neighboring chunks from the same verse/purport.
     *
     * semanticAnchor:
     *   Short natural-language label describing what the chunk is about.
     *   Useful for debugging retrieved chunks.
     *
     * embeddingText:
     *   Text that should be embedded later.
     *   It includes metadata context + content, because embedding only raw
     *   paragraph text often loses chapter/text identity.
     */
    semanticGroupId?: string;
    semanticAnchor?: string;
    embeddingText?: string;

    includeInSemanticIndex?: boolean;
    searchPriority?: 'low' | 'medium' | 'high';

    /**
     * Tells later retrieval whether this chunk was produced from:
     * - a natural document boundary, e.g. TRANSLATION
     * - a paragraph/window split, e.g. PURPORT Part 2
     */
    chunkBoundaryType?: 'section' | 'window';
    partNumber?: number;
  };
}

type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
  sourceName?: string;

  /**
   * For Gita-style PDFs:
   * Sanskrit/original text is often noisy after PDF extraction, so default false.
   */
  includeOriginalText?: boolean;

  /**
   * Synonyms can be useful for word-meaning queries.
   * For first RAG version, you can set this false if retrieval becomes noisy.
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

type SplitPart = {
  content: string;
  startChar: number;
  endChar: number;
  partNumber?: number;
  chunkBoundaryType: 'section' | 'window';
};

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 150;

const estimateTokens = (text: string): number => {
  /**
   * Rough estimate only.
   * Good enough for chunk metadata, not for billing/token-limit enforcement.
   */
  return Math.ceil(text.length / 4);
};

const removePdfNoise = (text: string): string => {
  /**
   * This removes repeated footer/header noise from the Bhagavad-gita PDF.
   * Keep this conservative. Aggressive cleaning can accidentally delete content.
   */
  return text
    .replace(/Copyright © 1998 The Bhaktivedanta Book Trust Int'?l\. All Rights Reserved\./gi, '')
    .replace(/Bhaktivedanta Book Trust Int'?l\. All Rights Reserved\./gi, '');
};

const normalizeText = (text: string): string => {
  return removePdfNoise(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

    /**
     * Many PDFs extract visual spacing as many spaces.
     * This turns "Bhagavad-gétä   is   the" into "Bhagavad-gétä is the".
     */
    .replace(/[ \t]{2,}/g, ' ')

    /**
     * Remove spaces before newline and collapse too many blank lines.
     */
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const cleanBlockContent = (text: string): string => {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
};

const buildSemanticGroupId = (params: {
  documentType: DocumentType;
  chapterNumber?: number;
  textNumber?: string;
  sectionType?: GitaSectionType;
  sectionTitle?: string;
  chunkIndex: number;
}): string => {
  if (params.documentType === 'gita-structured') {
    const chapter = params.chapterNumber ? `ch${params.chapterNumber}` : 'ch-unknown';
    const text = params.textNumber ? `text${slugify(params.textNumber)}` : 'text-unknown';
    const section = params.sectionType ? params.sectionType.toLowerCase() : 'section-unknown';

    return `gita-${chapter}-${text}-${section}`;
  }

  const section = params.sectionTitle ? slugify(params.sectionTitle) : 'generic';
  return `generic-${section}-chunk${params.chunkIndex}`;
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
  partNumber?: number;
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

  if (params.partNumber) {
    lines.push(`Part: ${params.partNumber}`);
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
   * - CHAPTER 1 -
   * CHAPTER 1 - Observing the Armies
   * CHAPTER 1- 'OBSERVING THE ARMIES'
   * TEXT 1
   * TEXT-1
   * TEXTS 1-2
   * SYNONYMS
   * TRANSLATION
   * PURPORT
   *
   * NOTE:
   * The marker must be alone on a line. This avoids matching normal prose.
   */
  const markerRegex =
    /^\s*(?:-?\s*CHAPTER\s+(\d+)\s*-?\s*(?:[-–—]\s*['"“”]?(.+?)['"“”]?)?\s*|TEXTS?\s*[-–—]?\s*(\d+(?:\s*[-–—]\s*\d+)?)\s*|SYNONYMS\s*|TRANSLATION\s*|PURPORT\s*)$/gim;

  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    const fullMarker = match[0].trim();
    const markerUpper = fullMarker.toUpperCase();

    if (markerUpper.includes('CHAPTER')) {
      markers.push({
        type: 'CHAPTER',
        index: match.index,
        endIndex: markerRegex.lastIndex,
        chapterNumber: Number(match[1]),
        chapterTitle: match[2]?.trim(),
      });

      continue;
    }

    if (markerUpper.startsWith('TEXT')) {
      const normalizedTextNumber = match[3]?.replace(/\s+/g, '').replace(/[–—]/g, '-');

      markers.push({
        type: 'TEXT',
        index: match.index,
        endIndex: markerRegex.lastIndex,
        textNumber: normalizedTextNumber,
      });

      continue;
    }

    if (markerUpper === 'SYNONYMS') {
      markers.push({ type: 'SYNONYMS', index: match.index, endIndex: markerRegex.lastIndex });
      continue;
    }

    if (markerUpper === 'TRANSLATION') {
      markers.push({ type: 'TRANSLATION', index: match.index, endIndex: markerRegex.lastIndex });
      continue;
    }

    if (markerUpper === 'PURPORT') {
      markers.push({ type: 'PURPORT', index: match.index, endIndex: markerRegex.lastIndex });
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
}): SplitPart[] => {
  /**
   * Window strategy:
   * - Try to split near paragraph boundaries.
   * - Fall back to a hard maxChars split if no good paragraph boundary exists.
   * - Use small overlap so retrieval does not lose continuity.
   *
   * This is used only when a natural section is too large, mainly PURPORT.
   */
  const { content, absoluteStartChar, maxChars, overlapChars } = params;
  const parts: SplitPart[] = [];

  let localStart = 0;
  let partNumber = 1;

  while (localStart < content.length) {
    let localEnd = Math.min(localStart + maxChars, content.length);

    const paragraphBreak = content.lastIndexOf('\n\n', localEnd);

    if (paragraphBreak > localStart + maxChars * 0.5) {
      localEnd = paragraphBreak;
    }

    const rawSlice = content.slice(localStart, localEnd);
    const partContent = rawSlice.trim();

    if (partContent.length > 0) {
      const leadingWhitespace = rawSlice.length - rawSlice.trimStart().length;
      const trailingWhitespace = rawSlice.length - rawSlice.trimEnd().length;

      parts.push({
        content: partContent,
        startChar: absoluteStartChar + localStart + leadingWhitespace,
        endChar: absoluteStartChar + localEnd - trailingWhitespace,
        partNumber,
        chunkBoundaryType: 'window',
      });

      partNumber++;
    }

    if (localEnd >= content.length) {
      break;
    }

    /**
     * Guard against invalid overlap values creating infinite loops.
     */
    const safeOverlap = Math.min(overlapChars, Math.floor(maxChars / 2));
    localStart = Math.max(0, localEnd - safeOverlap);
  }

  return parts;
};

const buildEmbeddingText = (params: {
  contextHeader: string;
  content: string;
  sectionType?: GitaSectionType;
}): string => {
  /**
   * This is the text you should embed later.
   *
   * Why include contextHeader?
   * A chunk like "He was confused..." is weak by itself.
   * "Chapter 1 | Text 1 | Purport | He was confused..." embeds with much
   * better identity.
   */
  return `${params.contextHeader}\n\n${params.content}`;
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

  strategy: ChunkStrategy;
  includeInSemanticIndex: boolean;
  searchPriority: 'low' | 'medium' | 'high';

  chunkBoundaryType: 'section' | 'window';
  partNumber?: number;
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

  if (params.partNumber) {
    sectionTitleParts.push(`Part ${params.partNumber}`);
  }

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
    partNumber: params.partNumber,
  });

  const semanticGroupId = buildSemanticGroupId({
    documentType: 'gita-structured',
    chapterNumber: params.context.chapterNumber,
    textNumber: params.context.textNumber,
    sectionType: params.sectionType,
    sectionTitle,
    chunkIndex: params.chunkIndex,
  });

  const semanticAnchor = [
    params.context.chapterNumber ? `Chapter ${params.context.chapterNumber}` : undefined,
    params.context.textNumber ? `Text ${params.context.textNumber}` : undefined,
    params.sectionType,
    params.partNumber ? `Part ${params.partNumber}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');

  const embeddingText = buildEmbeddingText({
    contextHeader,
    content: params.content,
    sectionType: params.sectionType,
  });

  return {
    content: params.content,
    chunkIndex: params.chunkIndex,

    tokenEstimate: estimateTokens(embeddingText),
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

      semanticGroupId,
      semanticAnchor,
      embeddingText,

      includeInSemanticIndex: params.includeInSemanticIndex,
      searchPriority: params.searchPriority,

      chunkBoundaryType: params.chunkBoundaryType,
      partNumber: params.partNumber,
    },
  };
};

const shouldKeepGitaSection = (
  sectionType: GitaSectionType,
  options: Pick<ChunkOptions, 'includeOriginalText' | 'includeSynonyms'>,
): boolean => {
  /**
   * V1 RAG decision:
   * - TRANSLATION and PURPORT are the main semantic-search content.
   * - SYNONYMS are optional because they may help word-meaning questions,
   *   but can also pollute retrieval.
   * - TEXT/original Sanskrit is default false because PDF extraction is noisy.
   */
  return (
    sectionType === 'TRANSLATION' ||
    sectionType === 'PURPORT' ||
    (sectionType === 'SYNONYMS' && options.includeSynonyms !== false) ||
    (sectionType === 'TEXT' && options.includeOriginalText === true)
  );
};

const getSectionSearchConfig = (
  sectionType: GitaSectionType,
): {
  includeInSemanticIndex: boolean;
  searchPriority: 'low' | 'medium' | 'high';
} => {
  switch (sectionType) {
    case 'TRANSLATION':
    case 'PURPORT':
      return { includeInSemanticIndex: true, searchPriority: 'high' };

    case 'SYNONYMS':
      return { includeInSemanticIndex: true, searchPriority: 'medium' };

    case 'TEXT':
    default:
      return { includeInSemanticIndex: false, searchPriority: 'low' };
  }
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
  const strategy: ChunkStrategy = 'gita-hybrid-structured-window-semantic-ready';

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
    const cleanedBlock = cleanBlockContent(rawBlock);

    if (!cleanedBlock) {
      continue;
    }

    const leadingWhitespaceLength = rawBlock.length - rawBlock.trimStart().length;
    const absoluteStartChar = marker.endIndex + leadingWhitespaceLength;

    if (!shouldKeepGitaSection(sectionType, options)) {
      continue;
    }

    const { includeInSemanticIndex, searchPriority } = getSectionSearchConfig(sectionType);

    /**
     * Hybrid chunking policy:
     *
     * 1. Structured:
     *    Split by CHAPTER / TEXT / TRANSLATION / PURPORT markers.
     *
     * 2. Window:
     *    If a section is too long, split paragraph-aware with overlap.
     *    This is mainly for PURPORT.
     *
     * 3. Semantic-ready:
     *    Each chunk gets semanticGroupId + semanticAnchor + embeddingText.
     *    The real embedding-based semantic search comes in the next phase.
     */
    const shouldWindowSplit =
      sectionType === 'PURPORT' || cleanedBlock.length > options.maxChars;

    const blockParts: SplitPart[] = shouldWindowSplit
      ? splitLongContentParagraphAware({
          content: cleanedBlock,
          absoluteStartChar,
          maxChars: options.maxChars,
          overlapChars: options.overlapChars,
        })
      : [
          {
            content: cleanedBlock,
            startChar: absoluteStartChar,
            endChar: absoluteStartChar + cleanedBlock.length,
            chunkBoundaryType: 'section',
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

          chunkBoundaryType: part.chunkBoundaryType,
          partNumber: part.partNumber,
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
  const strategy: ChunkStrategy = 'generic-paragraph-window-semantic-ready';

  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    let end = Math.min(start + options.maxChars, text.length);

    const paragraphBreak = text.lastIndexOf('\n\n', end);

    if (paragraphBreak > start + options.maxChars * 0.5) {
      end = paragraphBreak;
    }

    const content = cleanBlockContent(text.slice(start, end));

    if (content.length > 0) {
      const sectionTitle = findSectionTitle(text, start);

      const contextHeader = buildContextHeader({
        sourceName: options.sourceName,
        chunkIndex,
        startChar: start,
        endChar: end,
        sectionTitle,
      });

      const semanticGroupId = buildSemanticGroupId({
        documentType: 'generic',
        sectionTitle,
        chunkIndex,
      });

      const semanticAnchor = sectionTitle ?? `Generic chunk ${chunkIndex}`;

      const embeddingText = buildEmbeddingText({
        contextHeader,
        content,
      });

      chunks.push({
        content,
        chunkIndex,

        tokenEstimate: estimateTokens(embeddingText),
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

          semanticGroupId,
          semanticAnchor,
          embeddingText,

          includeInSemanticIndex: true,
          searchPriority: 'medium',

          chunkBoundaryType: 'window',
        },
      });

      chunkIndex++;
    }

    if (end >= text.length) {
      break;
    }

    const safeOverlap = Math.min(options.overlapChars, Math.floor(options.maxChars / 2));
    start = Math.max(0, end - safeOverlap);
  }

  return addNeighbourIndexes(chunks);
};

export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options?.overlapChars ?? DEFAULT_OVERLAP_CHARS;

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

  /**
   * Try domain-specific Gita chunking first.
   * If the document does not have enough Gita markers, fall back to generic chunking.
   */
  const gitaChunks = chunkGitaStructuredText(normalizedText, normalizedOptions);

  if (gitaChunks.length > 0) {
    return gitaChunks;
  }

  return chunkGenericText(normalizedText, normalizedOptions);
}
