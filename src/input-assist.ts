export const inputTags = {
  goal: ['建立新品认知', '解释使用方法', '展示真实使用场景', '引导了解产品详情'],
  audience: ['日常通勤场景', '周末户外场景', '居家使用场景', '首次了解此类产品的人'],
  sellingPoints: ['重点展示便携性（以资料为准）', '说明与常见用法的区别', '突出使用步骤与细节'],
  facts: ['规格：[待补充]\n材质：[待补充]\n价格：[待核实]', '使用方法：[待补充]\n适用范围：[待核实]'],
  tone: ['自然、具体，像真实体验分享', '简洁专业，避免夸张形容', '轻松亲切，少用营销口号', '缺少依据的信息保留为待补充'],
  strategy: ['围绕一个真实使用场景展开', '先回答用户最关心的问题', '突出一个主要卖点，不堆砌信息', '结合已采用的反馈说明本轮改动'],
  copy: ['开头先说使用场景', '拆成短段落，便于手机阅读', '保留产品事实，减少空泛形容', '结尾提出一个自然的互动问题'],
  cover: ['主体清晰，背景简洁', '柔和自然光，真实摄影感', '保留标题区和边缘留白', '保持参考图的包装、标识和比例'],
  frame: ['固定主体位置，保持包装一致', '开场全景，产品清晰可辨', '结束时产品特写，背景保持一致'],
  motion: ['缓慢推近产品，镜头平稳', '从全景平滑过渡到细节特写', '保持主体和包装一致，不突然变形', '自然收束，不新增画面文字'],
  query: ['产品规格', '使用方法', '目标受众', '品牌定位', '产品外观'],
  title: ['[产品名称]，适合怎样的日常', '[使用场景]里的一个小细节', '关于[产品]，先说清这件事'],
};
export type AssistKind = keyof typeof inputTags;
export function appendInput(value: string, addition: string, maxLength: number) {
  if (value.includes(addition)) return value;
  const next = value.trim() ? `${value.trimEnd()}\n${addition}` : addition;
  if (next.length > maxLength) throw new Error(`添加后会超过 ${maxLength} 字，请先精简输入，或只复制需要的语料句子。`);
  return next;
}
