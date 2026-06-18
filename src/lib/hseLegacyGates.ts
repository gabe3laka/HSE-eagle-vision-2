export function shouldShowLegacyAlertFeed({
  hseActive,
  localAlertsEnabled,
  debug,
}: {
  hseActive: boolean;
  localAlertsEnabled: boolean;
  debug: boolean;
}): boolean {
  return !hseActive || localAlertsEnabled || debug;
}

export function shouldRunLegacyAnalyzeScene(localAlertsEnabled: boolean): boolean {
  return localAlertsEnabled;
}
