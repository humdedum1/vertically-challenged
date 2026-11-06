import { mount } from 'svelte';
import { browser } from 'wxt/browser';
import { migrateSettings } from '../../settings/migrate';
import { POPUP_TOKEN_KEY, parseSurface, popupTokenOk } from '../../shared/surface';
import App from '../../sidepanel/App.svelte';
import { applyAppearance, applyCachedAppearance } from '../../sidepanel/appearance';
import { customCss } from '../../sidepanel/custom-css.svelte';
import { SettingsState } from '../../sidepanel/settings-state.svelte';
import { ThemeRegistry } from '../../sidepanel/theme-registry.svelte';
import '../../sidepanel/styles/base.css';
import '../../sidepanel/styles/skin-dense.css';
import '../../sidepanel/styles/skin-glass.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount point');

async function start(el: HTMLElement): Promise<void> {
  // An in-page popup renders only when our overlay script framed it (clickjacking guard).
  if (parseSurface(location.search).surface === 'popup') {
    const stored = (await browser.storage.local.get(POPUP_TOKEN_KEY))[POPUP_TOKEN_KEY];
    if (!popupTokenOk(location.search, stored)) return;
  }
  // The cached theme CSS and settings are applied before mounting so the first frame is
  // already right; storage then reconciles asynchronously (settings, then custom themes).
  const settings = new SettingsState(migrateSettings(applyCachedAppearance()));
  const themes = new ThemeRegistry();
  if (!document.getElementById('vc-theme')) {
    applyAppearance(settings.value, themes.resolveReady(settings.value.appearance.themeId));
  }
  void settings.start();
  customCss.start();
  void themes.start();

  mount(App, { target: el, props: { settings, themes } });
}

void start(target);
