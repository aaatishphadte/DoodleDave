// One interface over the web portals' SDKs. The build picks the platform:
//   npm run build            -> web (Cloudflare)  no ads
//   npm run build:itch       -> itch              no ads (monetize via the itch page: price / donations)
//   npm run build:poki       -> poki              Poki SDK: commercial + rewarded breaks
//   npm run build:crazygames -> crazygames        CrazyGames SDK v3: midgame + rewarded ads
//   npm run build:exe        -> exe               desktop app, no ads
// Every SDK call is wrapped so a blocked/failed SDK never breaks the game.

/* global __PLATFORM__ */
const NAME = typeof __PLATFORM__ !== 'undefined' ? __PLATFORM__ : 'web';

const SDK_URL = {
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const timeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

let ready = false;
let playing = false;
let audioHooks = { mute() {}, unmute() {} };

const sdk = {
  poki: {
    async init() { await loadScript(SDK_URL.poki); await window.PokiSDK.init(); },
    loadingDone() { window.PokiSDK.gameLoadingFinished(); },
    start() { window.PokiSDK.gameplayStart(); },
    stop() { window.PokiSDK.gameplayStop(); },
    midgame() { return window.PokiSDK.commercialBreak(() => audioHooks.mute()); },
    rewarded() { return window.PokiSDK.rewardedBreak(() => audioHooks.mute()); },
  },
  crazygames: {
    async init() { await loadScript(SDK_URL.crazygames); await window.CrazyGames.SDK.init(); },
    loadingDone() { window.CrazyGames.SDK.game.loadingStop?.(); },
    start() { window.CrazyGames.SDK.game.gameplayStart(); },
    stop() { window.CrazyGames.SDK.game.gameplayStop(); },
    ad(type) {
      return new Promise(resolve => {
        window.CrazyGames.SDK.ad.requestAd(type, {
          adStarted: () => audioHooks.mute(),
          adFinished: () => resolve(true),
          adError: () => resolve(false),
        });
      });
    },
    midgame() { return this.ad('midgame'); },
    rewarded() { return this.ad('rewarded'); },
  },
}[NAME];

export const platform = {
  name: NAME,
  hasAds: !!sdk,
  hasRewarded: !!sdk,
  // Portals don't allow links that send players off-site.
  allowExternalLinks: !sdk,

  setAudioHooks(hooks) { audioHooks = hooks; },

  async init() {
    if (!sdk) return;
    try { await timeout(sdk.init(), 6000); ready = true; }
    catch (e) { console.warn(`[platform] ${NAME} SDK unavailable (ad blocker?)`, e); }
  },

  loadingDone() { if (ready) try { sdk.loadingDone(); } catch { /* ignore */ } },

  gameplayStart() {
    if (playing) return;
    playing = true;
    if (ready) try { sdk.start(); } catch { /* ignore */ }
  },

  gameplayStop() {
    if (!playing) return;
    playing = false;
    if (ready) try { sdk.stop(); } catch { /* ignore */ }
  },

  // Interstitial between pages / before a restart. Always resolves.
  async midgameAd() {
    if (!ready) return;
    this.gameplayStop();
    try { await timeout(sdk.midgame(), 60000); } catch { /* ignore */ }
    audioHooks.unmute();
  },

  // Rewarded video. Resolves true only if the player watched it to the end.
  async rewardedAd() {
    if (!ready) return false;
    this.gameplayStop();
    let ok = false;
    try { ok = !!(await timeout(sdk.rewarded(), 90000)); } catch { ok = false; }
    audioHooks.unmute();
    return ok;
  },
};
