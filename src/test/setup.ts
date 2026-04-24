import "@testing-library/jest-dom";
// fake-indexeddb auto-installs window.indexedDB / IDBKeyRange polyfills so
// boundary tests (H6) can exercise getUnsynced* against a real IDB.
import "fake-indexeddb/auto";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
