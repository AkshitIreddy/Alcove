/**
 * scripts/shims/xmldom-browser.mjs — `@xmldom/xmldom`, for a browser.
 *
 * Aliased in vite.config.ts. Nothing in `src/` imports @xmldom/xmldom; the
 * only importer in the whole tree is one file inside pixi.js:
 *
 *   node_modules/pixi.js/lib/environment-webworker/WebWorkerAdapter.mjs
 *     parseXML: (xml) => new DOMParser().parseFromString(xml, 'text/xml')
 *
 * That adapter is what Pixi installs when Pixi itself is running inside a Web
 * Worker, and `parseXML` exists for Pixi's SVG asset loader. This app runs
 * Pixi on the main thread (the art worker in features/bookshelf/artWorker.ts
 * is the app's own and does not contain Pixi), and loads no SVG through Pixi's
 * asset system — every piece of art is drawn to a canvas and uploaded as a
 * texture. So a full XML DOM implementation, 57.2kB minified, was shipping in
 * the chunk the shelf boots from to serve a call that cannot happen.
 *
 * This is NOT a stub that throws. Every environment the app actually runs in —
 * Chromium, the Tauri WebView2 host, a Worker — has a native `DOMParser`, and
 * a native one is strictly better than the polyfill: faster, spec-exact, and
 * already loaded. So the shim forwards to it, and only complains in the
 * genuinely impossible case where there is no DOMParser at all. If some future
 * feature does start loading SVG through Pixi's loader, it keeps working.
 */

const NativeDOMParser = globalThis.DOMParser;

class ShimDOMParser {
  parseFromString(source, mimeType = 'text/xml') {
    if (typeof NativeDOMParser !== 'function') {
      throw new Error(
        'xmldom shim: no native DOMParser in this environment. See scripts/shims/xmldom-browser.mjs — ' +
          'if Pixi now needs to parse XML somewhere without one, drop the alias in vite.config.ts.',
      );
    }
    return new NativeDOMParser().parseFromString(source, mimeType);
  }
}

/**
 * `DOMParser` is the only binding pixi imports. The rest are exported because
 * the package exports them and a bare `import * as xmldom` should not come
 * back half empty — each is the platform's own where the platform has one.
 */
export const DOMParser = ShimDOMParser;
export const XMLSerializer = globalThis.XMLSerializer;
export const DOMImplementation = globalThis.DOMImplementation;

export default { DOMParser, XMLSerializer, DOMImplementation };
