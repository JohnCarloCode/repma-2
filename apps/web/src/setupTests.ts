import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './test/server';
import { installMatchMedia, resetViewport } from './test/viewport';

// findBy*/waitFor default to 1s, which a first render can exceed when every workspace's suite runs at once (`npm run check`).
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no ResizeObserver; Headless UI's Menu observes its button with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// …nor getAnimations, which Headless UI's `transition` (the mobile drawer) waits on.
Element.prototype.getAnimations ??= () => [];

installMatchMedia();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetViewport();
  localStorage.clear();
});
afterAll(() => server.close());
