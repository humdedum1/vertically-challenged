import { mount } from 'svelte';
import App from '../../sidepanel/App.svelte';
import '../../sidepanel/styles/base.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount point');

mount(App, { target });
