/**
 * Product-view detector shared with the full QA chrome.
 * The simple bottom toolbar is no longer the QA shell; default index.html
 * boots assets/runtime/qa-chrome.mjs. This file keeps isProductView for
 * existing tests and product gates.
 */
export { isProductView } from './qa-chrome.mjs';
