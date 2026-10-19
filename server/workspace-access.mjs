// Team access is deliberately distinct from the stateless web relay. A caller
// must have a verified team session and pass the host's credential policy.
export function canUseTeamWorkspace(req, config) {
  return config.teamMode === true && !!req.teamUser?.userId
    && typeof config.authorizeCredentials === 'function'
    && config.authorizeCredentials(req) === true;
}

export function canEditSharedSettings(req, config) {
  return config.teamMode !== true || canUseTeamWorkspace(req, config) && req.teamUser.role === 'admin';
}
