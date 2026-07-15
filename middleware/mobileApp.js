// middleware/mobileApp.js
//
// The Capacitor mobile app shell loads the same server-rendered pages as the
// web app, but appends a custom token to its WebView User-Agent (configured
// in mobile/capacitor.config.json). This lets the server tell "the phone app"
// apart from a normal browser without any separate mobile-only routes.
const MOBILE_APP_UA_TOKEN = 'ManageHubMobileApp';

/**
 * Sets req.isMobileApp / res.locals.isMobileApp for every request, based on
 * the User-Agent the Capacitor shell identifies itself with.
 */
function detectMobileApp(req, res, next) {
  const userAgent = req.headers['user-agent'] || '';
  const isMobileApp = userAgent.includes(MOBILE_APP_UA_TOKEN);
  req.isMobileApp = isMobileApp;
  res.locals.isMobileApp = isMobileApp;
  next();
}

/**
 * Phase 1 of the mobile app is read-only for certain modules (products,
 * sales, customers, suppliers, employees, feedback, reports) — the shop
 * owner can browse their shop from their phone but not edit anything there
 * yet. Settings and My Profile are exempt and stay fully editable.
 *
 * Apply this at the router-mount level for those modules' routers. It only
 * blocks state-changing methods; GET requests (viewing) always pass through.
 */
function mobileReadOnly(req, res, next) {
  if (!req.isMobileApp) return next();

  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!isMutating) return next();

  if (req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json')) {
    return res.status(403).json({
      success: false,
      message: 'This action is not available in the mobile app yet. Please use the web dashboard.'
    });
  }

  return res.status(403).render('errors/403', {
    title: 'Not Available on Mobile',
    message: 'Editing isn\'t available in the mobile app yet — please use the web dashboard for this action.'
  });
}

module.exports = { detectMobileApp, mobileReadOnly, MOBILE_APP_UA_TOKEN };
