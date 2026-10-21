// The one Netlify Function for the API. Every /api/* request comes here and
// lib/app.js routes it. The visitor's IP and country come from Netlify's
// context (visitors can't fake these), so rate limits and lockouts hold.
import { handle } from '../../lib/app.js';

export default (request, context = {}) =>
  handle(request, {
    ip: context.ip,
    country: context.geo?.country?.code,
    waitUntil: typeof context.waitUntil === 'function' ? (promise) => context.waitUntil(promise) : undefined
  });

export const config = {
  path: '/api/*'
};
