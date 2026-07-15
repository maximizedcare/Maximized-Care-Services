import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4187' },
  webServer: {
    command: 'npm run serve',
    url: 'http://localhost:4187',
    // reuseExistingServer trusts whatever already answers on this port. Port 4187 is
    // deliberately obscure: 4173 (Vite's preview default) is commonly occupied by an
    // unrelated project, and when it is, this suite silently tests that project's page
    // instead of this one — passing and failing for reasons that have nothing to do
    // with the site. If you change this port, pick one nothing else defaults to.
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },

    // Pixel 5 (Chromium), NOT iPhone 12 — devices['iPhone 12'] carries
    // defaultBrowserType:'webkit', and WebKit omits <a> elements from sequential
    // focus by default (Safari's "Press Tab to highlight each item" is off). Keyboard
    // order assertions are only meaningful on a browser that tabs to links.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },

    // Real Safari engine, for the checks that do not depend on link tab order.
    // Safari keyboard behaviour itself must still be verified manually with VoiceOver.
    { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },

    // 320px is the 1.4.10 Reflow floor — its own project so the assertion is unambiguous.
    { name: 'reflow', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 800 } } },
  ],
});
