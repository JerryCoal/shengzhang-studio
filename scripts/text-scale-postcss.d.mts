export default function textScale(): {
  postcssPlugin: string;
  Declaration(declaration: { prop: string; value: string; parent?: unknown }): void;
};
