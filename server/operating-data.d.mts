import type { Project, MetricSnapshot } from '../src/types';
export const METRICS: { key:keyof MetricSnapshot['metrics']; label:string; description:string }[];
export function saveMetricSnapshot(project:Project,input:unknown,clock?:()=>number): MetricSnapshot;
export function latestMetricSnapshots(project:Project,includeSamples?:boolean): MetricSnapshot[];
export function operatingSummary(project:Project,includeSamples?:boolean): { published:number;recorded:number;imported:number;valid:number;metrics:{key:string;label:string;description:string;covered:number;total:number|null}[] };
