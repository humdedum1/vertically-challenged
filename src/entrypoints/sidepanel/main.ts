import { mount } from 'svelte';
import { migrateSettings } from '../../settings/migrate';
import App from '../../sidepanel/App.svelte';
import { applyAppearance, readCachedAppearance } from '../../sidepanel/appearance';
import { SettingsState } from '../../sidepanel/settings-state.svelte';
import '../../sidepanel/styles/base.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount point');

// Apply the last-known appearance before mounting so the first frame has the right
// theme, mode and density; storage then reconciles asynchronously.
const settings = new SettingsState(migrateSettings(readCachedAppearance()));
applyAppearance(settings.value.appearance);
void settings.start();

mount(App, { target, props: { settings } });
