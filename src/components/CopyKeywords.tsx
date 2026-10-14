import { useContext, useMemo } from 'react';
import { Context } from '../context';
import { useAppearance } from '../appearance';
import { projectKeywords, splitCopyKeywords } from '../copy-keywords.mjs';
import type { Project } from '../types';

export function CopyKeywords({ text, project, keywords }: { text: string; project?: Project; keywords?: string[] }) {
  const context = useContext(Context), appearance = useAppearance();
  const source = project || context?.project;
  const terms = useMemo(() => keywords || projectKeywords(source), [keywords, source]);
  const parts = useMemo(() => splitCopyKeywords(text, terms), [text, terms]);
  if (!appearance?.preferences.emphasize) return <>{text}</>;
  return <>{parts.map((part, index) => part.keyword ? <strong className="copy-keyword" data-copy-keyword key={index}>{part.text}</strong> : part.text)}</>;
}
