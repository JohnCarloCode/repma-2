import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './test/server';
import { installMatchMedia, resetViewport } from './test/viewport';

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
