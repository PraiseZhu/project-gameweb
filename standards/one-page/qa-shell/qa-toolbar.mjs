import { bootQaChrome } from './qa-chrome.mjs';

if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  try {
    const [config, presets] = await Promise.all(['config.json', 'qa-devices.json'].map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('预览配置不可用');
      return response.json();
    }));
    bootQaChrome(config, presets);
  } catch (error) { document.getElementById('status').textContent = error.message; }
}
