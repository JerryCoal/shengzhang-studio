import { mediaPrompt } from '../server/prompts.mjs';
import { resolveAccountCreation, assertAssetCreationAccount } from '../server/account-creation.mjs';
import { skillWorkflowId } from '../server/skill-workflows.mjs';
import { resolveBuiltinSkills } from '../server/builtin-skills.mjs';
import type { Asset, Project, State } from './types';
import { contentProjectForAsset } from '../server/content-workflow.mjs';

// A long or invalid imported rule should produce feedback, never crash a dialog.
export function previewMediaPrompt(state: State, project: Project, asset: Asset, input: Parameters<typeof mediaPrompt>[2]) {
  try {
    const { creativeSkill, accountContext } = resolveAccountCreation(state, contentProjectForAsset(project, asset), asset.channel, skillWorkflowId(input.purpose));
    assertAssetCreationAccount(asset, accountContext);
    const builtinSkills = resolveBuiltinSkills(state, skillWorkflowId(input.purpose));
    return { recipe: mediaPrompt(project, asset, { ...input, creativeSkill, builtinSkills, accountContext }, state.contentRules), error: '' };
  } catch (failure) {
    return { recipe: null, error: failure instanceof Error ? failure.message : '无法生成提示词预览，请检查本步骤的 Skills 设置。' };
  }
}
