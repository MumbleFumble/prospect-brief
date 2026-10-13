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
    },
  },
});
