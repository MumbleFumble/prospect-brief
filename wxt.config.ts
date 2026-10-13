import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Prospect Brief',
    description:
      'Generate a one-page account brief for any company website: overview, tech stack, news, and talking points.',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage', 'webRequest'],
    host_permissions: ['https://api.anthropic.com/*', 'https://news.google.com/*'],
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    action: {
      default_title: 'Generate prospect brief',
      default_icon: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
      },
    },
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
});
