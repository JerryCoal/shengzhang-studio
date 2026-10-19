export const XHS_MAX_TOPICS: number;
export const XHS_MAX_TOPIC_LENGTH: number;
export function splitXhsTopics(body: string): { content: string; tags: string[] };
export function prepareXhsTopics(body: string, selectedTags?: string[]): { content: string; tags: string[]; bodyWithTopics: string };
