export type ResearchImageEvidence = { images: { url?: string; description?: string }[]; analysis?: string; analysisSource?: 'source-provided'; status: 'not-verified' };
export function researchImageEvidence(input: unknown, secrets?: string[]): ResearchImageEvidence | undefined;
