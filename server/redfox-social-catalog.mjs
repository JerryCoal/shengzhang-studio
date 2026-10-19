// Verified against the public Redfox interface documentation in .tools/redfox-docs.
const operation = (path, priceCny, label, interfaceNo) => ({ path, method: 'POST', priceCny, kind: 'data', label, interfaceNo });
export const REDFOX_SOCIAL_OPERATIONS = Object.freeze({
  'social.search.douyin': operation('/story/api/dy/data/searchWork', .04, '抖音作品搜索', 'OWIBYU1V'),
  'social.detail.douyin': operation('/story/api/dy/data/workDetail', .04, '抖音作品详情', 'FK67XDVQ'),
  'social.search.xiaohongshu': operation('/story/api/xhsUser/searchArticle', .04, '小红书作品搜索', '384C6W6B'),
  'social.detail.xiaohongshu': operation('/story/api/xhsUser/queryWorkDetail', .04, '小红书作品详情', 'KR1LPTBF'),
  'social.comments.xiaohongshu': operation('/story/api/xhs/commentSubmit', .06, '小红书评论采集提交', '5AM3X4HZ'),
  'social.comments-result.xiaohongshu': operation('/story/api/xhs/commentResult', 0, '小红书评论结果查询', 'LO93CE5K'),
  'social.search.tiktok': operation('/story/api/tiktok/ability/searchVideo', .06, 'TikTok 作品搜索', 'PXZXY8KQ'),
  'social.detail.tiktok': operation('/story/api/tiktok/ability/awemeDetail', .06, 'TikTok 作品详情', '6SE9WIHJ'),
  'social.comments.tiktok': operation('/story/api/tiktok/ability/commentList', .06, 'TikTok 评论读取', 'API_1790581645603'),
  'social.search.youtube': operation('/story/api/youtube/searchVideo', .06, 'YouTube 作品搜索', 'GC5SC5HS'),
  'social.detail.youtube': operation('/story/api/youtube/videoDetail', .06, 'YouTube 作品详情', '609DF2IR'),
  'social.comments.youtube': operation('/story/api/youtube/videoComments', .06, 'YouTube 评论读取', 'WULKP6JP'),
  'social.search.instagram': operation('/story/api/ins/search', .06, 'Instagram 作品搜索', 'GM0TISWI'),
  'social.detail.instagram': operation('/story/api/ins/postDetail', .06, 'Instagram 作品详情', 'Z9M88QI8'),
  'social.comments.instagram': operation('/story/api/ins/postComment', .06, 'Instagram 评论读取', 'U1SGKF2G'),
});
export function redfoxSocialCapabilities() {
  return ['xiaohongshu', 'douyin', 'tiktok', 'youtube', 'instagram'].map(platform => ({ platform, search: true, detail: true, comments: platform !== 'douyin',
    note: platform === 'douyin' ? '支持公开作品搜索和详情；数据可能延迟更新，当前接口没有评论读取。' : platform === 'xiaohongshu' ? '近期搜索优先读取最新内容；补充页和缺失详情仅在明确开启后读取。评论为异步采集：仅提交一次，后续查询结果免费。' : platform === 'youtube' ? '每次评论仅读一页。无精确发布时间的视频只保留为线索，不用于近期比较。' : '评论每次仅读取一页，不自动翻页或重试。',
    costs: { searchCny: REDFOX_SOCIAL_OPERATIONS[`social.search.${platform}`].priceCny, detailCny: REDFOX_SOCIAL_OPERATIONS[`social.detail.${platform}`].priceCny,
      ...(platform !== 'douyin' ? { commentsCny: .06 } : {}), searchMaxRequestsPerKeyword: platform === 'youtube' ? 4 : 1 } }));
}
