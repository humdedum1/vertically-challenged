import { mount } from 'svelte';
import { migrateSettings } from '../../settings/migrate';
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

mount(App, { target, props: { settings, themes } });
