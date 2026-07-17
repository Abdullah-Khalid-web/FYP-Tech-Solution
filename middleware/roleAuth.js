// middleware/roleAuth.js
const RoleHelper = require('../helpers/roleHelper');
const permissionHelper = require('../helpers/permissionHelper');

/**
 * Middleware to check if user has required role
 * @param {Array} allowedRoles - Array of allowed role names
 */
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.session?.userId) {
            req.flash('error', 'Please login first');
            return res.redirect('/login');
        }

        const roleHelper = new RoleHelper(req.session);
        const userRole = roleHelper.role;

        if (allowedRoles.includes(userRole)) {
            return next();
        }

        // Access denied - show 403 page
        return res.status(403).render('errors/403', {
            title: 'Access Denied',
            message: 'You do not have permission to access this page.',
            requiredRole: allowedRoles,
            userRole: userRole
        });
    };
}

/**
 * Middleware to check if user has required permission
 * @param {string} permissionSlug - Permission slug to check
 */
function requirePermission(permissionSlug) {
    return async (req, res, next) => {
        if (!req.session?.userId) {
            req.flash('error', 'Please login first');
            return res.redirect('/login');
        }

        const hasPerm = await permissionHelper.hasPermission(req.session.userId, permissionSlug);
        
        if (hasPerm) {
            return next();
        }

        // Access denied - show 403 page
        return res.status(403).render('errors/403', {
            title: 'Access Denied',
            message: 'You do not have permission to access this page.',
            requiredPermission: permissionSlug
        });
    };
}

/**
 * Middleware to check if user can access sales pages
 */
function requireSalesAccess(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    
    if (roleHelper.canAccessSales()) {
        return next();
    }

    return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You need sales access to view this page.',
        requiredRole: ['Shop Owner', 'Shop Manager', 'Accountant', 'Cashier', 'Sales Representative', 'Admin', 'Super Admin'],
        userRole: roleHelper.role
    });
}

/**
 * Middleware to check if user can access inventory pages
 */
function requireInventoryAccess(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    
    if (roleHelper.canAccessInventory()) {
        return next();
    }

    return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You need inventory access to view this page.',
        requiredRole: ['Shop Owner', 'Shop Manager', 'Inventory Manager', 'Admin', 'Super Admin'],
        userRole: roleHelper.role
    });
}

/**
 * Middleware to check if user can view employees
 */
function requireViewEmployees(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    
    if (roleHelper.canViewEmployees()) {
        return next();
    }

    return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You need employee management access to view this page.',
        requiredRole: ['Shop Owner', 'Shop Manager', 'HR Manager', 'Accountant', 'Admin', 'Super Admin'],
        userRole: roleHelper.role
    });
}

/**
 * Middleware to check if user can manage employees
 */
function requireEmployeeManagement(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    
    if (roleHelper.canManageEmployees()) {
        return next();
    }

    return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You need employee management access to view this page.',
        requiredRole: ['Shop Owner', 'Shop Manager', 'HR Manager', 'Admin', 'Super Admin'],
        userRole: roleHelper.role
    });
}

/**
 * Middleware to check if user can access finance pages
 */
function requireFinanceAccess(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    
    if (roleHelper.canAccessFinance()) {
        return next();
    }

    return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You need finance access to view this page.',
        requiredRole: ['Shop Owner', 'Accountant', 'Admin', 'Super Admin'],
        userRole: roleHelper.role
    });
}

/**
 * Middleware to check if user can access reports
 */
function requireReportAccess(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    
    if (roleHelper.canAccessReports()) {
        return next();
    }

    return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You need report access to view this page.',
        requiredRole: ['Shop Owner', 'Shop Manager', 'Accountant', 'Admin', 'Super Admin'],
        userRole: roleHelper.role
    });
}

/**
 * Middleware to check if user can manage settings
 */
function requireSettingsAccess(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    
    if (roleHelper.canManageSettings()) {
        return next();
    }

    return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You need settings access to view this page.',
        requiredRole: ['Shop Owner', 'Admin', 'Super Admin'],
        userRole: roleHelper.role
    });
}

/**
 * Middleware to check if user can view shop settings.
 * Shop Owner/Admin/Super Admin always pass; other roles pass if granted the
 * granular 'shop.view' permission (e.g. via the Roles & Permissions admin panel).
 */
function requireSettingsView(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    if (roleHelper.canManageSettings()) {
        return next();
    }

    permissionHelper.hasPermission(req.session.userId, 'shop.view').then((hasPerm) => {
        if (hasPerm) return next();

        return res.status(403).render('errors/403', {
            title: 'Access Denied',
            message: 'You do not have permission to view shop settings.',
            requiredPermission: 'shop.view',
            userRole: roleHelper.role
        });
    });
}

/**
 * Middleware to check if user can change shop settings.
 * Shop Owner/Admin/Super Admin always pass; other roles pass if granted the
 * granular 'shop.edit' permission.
 */
function requireSettingsEdit(req, res, next) {
    if (!req.session?.userId) {
        req.flash('error', 'Please login first');
        return res.redirect('/login');
    }

    const roleHelper = new RoleHelper(req.session);
    if (roleHelper.canManageSettings()) {
        return next();
    }

    permissionHelper.hasPermission(req.session.userId, 'shop.edit').then((hasPerm) => {
        if (hasPerm) return next();

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to change shop settings.'
            });
        }

        return res.status(403).render('errors/403', {
            title: 'Access Denied',
            message: 'You do not have permission to change shop settings.',
            requiredPermission: 'shop.edit',
            userRole: roleHelper.role
        });
    });
}

/**
 * Generic middleware factory: Shop Owner/Admin/Super Admin always pass (they
 * rely on the isAdmin() bypass rather than explicit role_permissions rows);
 * every other role must hold the given granular permission slug, as granted
 * via the Roles & Permissions admin panel. Accepts a single slug or an array
 * (any one of which is sufficient).
 *
 * This is the single building block every module's access control should use
 * so that grants made in the admin panel actually take effect everywhere,
 * instead of each module hardcoding its own hardcoded role list.
 */
function requirePermissionOrAdmin(slugOrSlugs, deniedMessage) {
    const slugs = Array.isArray(slugOrSlugs) ? slugOrSlugs : [slugOrSlugs];

    return (req, res, next) => {
        if (!req.session?.userId) {
            req.session.returnTo = req.originalUrl;
            req.flash('error', 'Please login first');
            return res.redirect('/login');
        }

        const roleHelper = new RoleHelper(req.session);
        if (roleHelper.isAdmin()) {
            return next();
        }

        Promise.all(slugs.map((slug) => permissionHelper.hasPermission(req.session.userId, slug)))
            .then((results) => {
                if (results.some(Boolean)) {
                    return next();
                }

                const message = deniedMessage || 'You do not have permission to access this page.';

                if (req.xhr || req.headers.accept?.includes('json')) {
                    return res.status(403).json({ success: false, message });
                }

                return res.status(403).render('errors/403', {
                    title: 'Access Denied',
                    message,
                    requiredPermission: slugs.length === 1 ? slugs[0] : slugs.join(' or '),
                    userRole: roleHelper.role
                });
            })
            .catch(next);
    };
}

module.exports = {
    requireRole,
    requirePermission,
    requireSalesAccess,
    requireInventoryAccess,
    requireViewEmployees,
    requireEmployeeManagement,
    requireFinanceAccess,
    requireReportAccess,
    requireSettingsAccess,
    requireSettingsView,
    requireSettingsEdit,
    requirePermissionOrAdmin
};