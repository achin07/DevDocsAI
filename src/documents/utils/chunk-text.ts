export interface TextChunk {
  content: string;
  chunkIndex: number;
  tokenEstimate: number;
  metadata: {
    strategy: string;
    startChar: number;
    endChar: number;
  };
}

const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

export function chunkText(
  text: string,
  options?: {
    maxChars?: number;
    overlapChars?: number;
  },
): TextChunk[] {
  const maxChars = options?.maxChars ?? 1200;
  const overlapChars = options?.overlapChars ?? 150;

  const normalizedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalizedText) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalizedText.length) {
    let end = Math.min(start + maxChars, normalizedText.length);

    const paragraphBreak = normalizedText.lastIndexOf('\n\n', end);
    if (paragraphBreak > start + maxChars * 0.5) {
      end = paragraphBreak;
    }

    const content = normalizedText.slice(start, end).trim();

    if (content.length > 0) {
      chunks.push({
        content,
        chunkIndex,
        tokenEstimate: estimateTokens(content),
        metadata: {
          strategy: 'paragraph-aware-fixed-size',
          startChar: start,
          endChar: end,
        },
      });

      chunkIndex++;
    }

    if (end >= normalizedText.length) {
      break;
    }

    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}