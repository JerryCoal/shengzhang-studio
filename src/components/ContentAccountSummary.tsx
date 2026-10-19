import { useStudio } from '../context';
import type { Asset } from '../types';
import { contentProjectForAsset } from '../../server/content-workflow.mjs';
import { resolveAccountCreation } from '../../server/account-creation.mjs';
import type { SkillWorkflowId } from '../../server/skill-workflows.mjs';

/** A content draft's account is independent from the account currently browsed. */
export function ContentAccountSummary({ asset, workflowId }: { asset: Asset; workflowId: SkillWorkflowId }) {
  const { state, project } = useStudio();
  if (!project) return null;
  try {
    const creation = resolveAccountCreation(state, contentProjectForAsset(project, asset), asset.channel, workflowId);
    const account = creation.accountContext?.accounts.find(item => item.platform === asset.channel);
    return <div className="content-account-summary">
      <p className="info-box"><b>本篇账号：{account?.accountName || '未指定'}</b>{account && ' · 身份 R' + account.profileRevision + ' · ' + (account.presetName || '默认方案')}</p>
      <details className="content-fold"><summary>查看本次身份与创作规则</summary><p>默认规则{creation.creativeSkill ? ' + ' + creation.creativeSkill.name + ' · v' + creation.creativeSkill.version : ''}</p>{account && <><pre>{account.identityMarkdown || '未填写额外身份记忆'}</pre>{account.instruction && <p>{account.instruction}</p>}</>}</details>
    </div>;
  } catch (error) {
    return <p className="error-text" role="alert">{error instanceof Error ? error.message : '本篇账号暂不可用'}</p>;
  }
}
