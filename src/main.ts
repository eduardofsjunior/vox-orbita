import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { App } from './ui/app';
import { detectLocale, setLocale, t } from './i18n';

function supported(): boolean {
  try {
    if (typeof AudioContext === 'undefined') return false;
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

const root = document.getElementById('app')!;
setLocale(detectLocale());

if (!supported()) {
  const div = document.createElement('div');
  div.className = 'fatal';
  div.textContent = t('export.noneNotice');
  root.append(div);
} else {
  const app = new App(root);
  // Test/debug hooks (used by the Playwright smoke test).
  (window as unknown as { __vox: unknown }).__vox = app.testApi;
}
