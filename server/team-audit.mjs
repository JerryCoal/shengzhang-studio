export function teamAuditLabel(method, path) {
  const value = path.toLowerCase();
  if (value.startsWith('/api/team/users')) return method === 'POST' ? '团队成员已添加' : '团队成员设置已更新';
  if (value.includes('/settings/') || value.startsWith('/api/integrations/') || value === '/api/research/settings') return '模型或服务连接已更新';
  if (value.startsWith('/api/team/feishu') || value.endsWith('/feishu-sync') || value.endsWith('/feishu-plan')) return '飞书协作设置或同步已完成';
  if (value.includes('/creation-profile')) return '账号身份与创作方案已保存';
  if (value.includes('/creation-selection') || value.endsWith('/activate')) return '当前创作账号已选择';
  if (value.startsWith('/api/mcp/')) return '平台账号连接操作已完成';
  if (value.includes('/mcp/publish')) return '平台发布请求已处理';
  if (value.includes('/publications/')) return '发布记录或运营数据已更新';
  if (value.endsWith('/publications')) return '发布计划已创建';
  if (value.startsWith('/api/creative-skills')) return '创作规则已更新';
  if (value === '/api/content-rules') return '内容检查规则已更新';
  if (value.startsWith('/api/editor-drafts')) return '个人编辑草稿已保存';
  if (value.includes('/brief-import')) return '介绍文档处理已完成';
  if (value.includes('/research/')) return '内容研究操作已完成';
  if (value.endsWith('/export')) return '内容导出已准备';
  if (value.includes('/assets/')) return '创作内容处理已完成';
  if (value.includes('/strategies')) return '策略操作已完成';
  if (value.startsWith('/api/accounts')) return '平台账号资料已更新';
  if (value === '/api/appearance' || value === '/api/guide') return '个人使用设置已更新';
  return '工作区内容已更新';
}
