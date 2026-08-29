import '@testing-library/jest-dom';

class ResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 1200,
            height: 800,
            top: 0,
            left: 0,
            bottom: 800,
            right: 1200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
        } as unknown as ResizeObserverEntry,
      ],
      this,
    );
  }

  unobserve() {}
  disconnect() {}
}

if (typeof global.ResizeObserver === 'undefined') {
  // eslint-disable-next-line
  (global as any).ResizeObserver = ResizeObserver;
}

/**
 * IntersectionObserver is not implemented in jsdom. Provide a no-op mock so
 * components that use it (e.g. infinite-scroll sentinel) can be unit tested
 * without errors. The observer never fires intersection callbacks in tests —
 * tests that need to exercise the scroll trigger should call the callback
 * directly via the mock or simulate it with userEvent.
 */
if (typeof global.IntersectionObserver === 'undefined') {
  class IntersectionObserver {
    callback: IntersectionObserverCallback;
    readonly root: Element | null = null;
    readonly rootMargin: string = '0px';
    readonly thresholds: ReadonlyArray<number> = [];

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
  }

  // eslint-disable-next-line
  (global as any).IntersectionObserver = IntersectionObserver;
}
