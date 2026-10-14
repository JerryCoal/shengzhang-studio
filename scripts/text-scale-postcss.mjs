// Scale text at its existing hierarchy without zooming artwork, videos, or layout.
export default function textScale() {
  return {
    postcssPlugin: 'studio-text-scale',
    Declaration(declaration) {
      if (declaration.prop !== 'font-size' || declaration.value.includes('--studio-font-scale')) return;
      const value = declaration.value.trim();
      if (!/^(?:\d*\.?\d+px|clamp\([\d\s.,pxvw]+\))$/.test(value)) return;
      if (/\.(?:banner-flower|planning-flower|note-flower)\b/.test(declaration.parent?.selector || '')) return;
      declaration.value = `calc(${value} * var(--studio-font-scale, 1))`;
    },
  };
}
textScale.postcss = true;
