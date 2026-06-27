/** sessionStorage handoff key: the Settings → Organizations "Live now" list
 *  stashes a session id here and navigates to Live, which consumes it once to
 *  auto-join (the merged feed needs the Live camera + overlays). */
export const PENDING_SV_JOIN_KEY = "hse_sv_join";
