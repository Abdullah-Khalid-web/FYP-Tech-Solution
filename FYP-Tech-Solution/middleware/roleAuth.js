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

module.exports = {
    requireRole,
    requirePermission,
    requireSalesAccess,
    requireInventoryAccess,
    requireViewEmployees,
    requireEmployeeManagement,
    requireFinanceAccess,
    requireReportAccess,
    requireSettingsAccess
};