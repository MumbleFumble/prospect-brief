import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  // Step 2+ will add: header capture, tech detection, news fetch, LLM calls.
  console.log('Prospect Brief background worker loaded');
});
