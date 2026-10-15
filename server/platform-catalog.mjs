// One public catalog for creation, exports and account-matrix labels. API
// capabilities are discovered separately; listing a platform grants no access.
export const PLATFORM_IDS = ['xiaohongshu', 'douyin', 'tiktok', 'youtube', 'instagram'];
export const PLATFORM_NAMES = { xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' };
export const CREATOR_URLS = { xiaohongshu: 'https://creator.xiaohongshu.com/', douyin: 'https://creator.douyin.com/', tiktok: 'https://www.tiktok.com/tiktokstudio/upload', youtube: 'https://studio.youtube.com/', instagram: 'https://www.instagram.com/' };
export const PUBLISH_LIMITS = { xiaohongshu: { title: 20, body: 1000 }, douyin: { title: 20, body: 1000 }, tiktok: { title: 90, body: 2000 }, youtube: { title: 100, body: 4000 }, instagram: { title: 100, body: 2000 } };
export const PLATFORM_WORK = {
  xiaohongshu: { key: 'xhs-note', kind: 'image', name: '小红书 · 场景种草图文', description: '3:4 封面与图文正文', instruction: '小红书图文：3:4 静态封面，清晰正文；封面画面不要包含视频时长或运镜指令。' },
  douyin: { key: 'dy-video', kind: 'video', name: '抖音 · 场景短片', description: '9:16 场景短片', instruction: '抖音视频：9:16 竖屏，开场场景→卖点展示→行动引导；首尾帧分别描述静态状态，动作与运镜交给视频步骤。' },
  tiktok: { key: 'tiktok-video', kind: 'video', name: 'TikTok · 场景短片', description: '9:16 短视频与发布描述', instruction: 'TikTok：9:16 竖屏短视频，前几秒交代真实场景与问题，中段展示产品实际使用，结尾只保留一个行动引导；字幕与发布描述分开。沿用项目指定语言和受众，不臆造海外经历。' },
  youtube: { key: 'youtube-short', kind: 'video', name: 'YouTube · Shorts 短片', description: '9:16 Shorts 与标题描述', instruction: 'YouTube Shorts：9:16 竖屏短视频，一条只解答一个具体问题，标题说明价值而非夸张承诺；发布描述补充事实与适用条件，分镜独立。这里制作 Shorts，不是长视频。' },
  instagram: { key: 'instagram-reel', kind: 'video', name: 'Instagram · Reels 短片', description: '9:16 Reels 与配文', instruction: 'Instagram Reels：9:16 竖屏短视频，以场景和产品细节建立视觉连贯性，配文用短段落补充事实；标签仅使用相关主题，不堆砌。沿用项目语言和语气。' },
};
export const hasBuiltinPageAssistant = platform => platform === 'xiaohongshu' || platform === 'douyin';
