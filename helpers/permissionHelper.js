// helpers/permissionHelper.js
const { pool } = require('../db');

// Convert BINARY(16) to UUID string
function binToUuid(buffer) {
    if (!buffer) return null;
    const hex = buffer.toString('hex');
    return [
        hex.substring(0, 8),
        hex.substring(8, 12),
        hex.substring(12, 16),
        hex.substring(16, 20),
        hex.substring(20, 32)
    ].join('-');
}

// Convert UUID to BINARY(16)
function uuidToBin(uuid) {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

// Check if user has permission
async function hasPermission(userId, permissionSlug) {
    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM (
                SELECT u.id FROM users u
                INNER JOIN role_permissions rp ON u.role_id = rp.role_id
                INNER JOIN permissions p ON rp.permission_id = p.id
                WHERE u.id = UUID_TO_BIN(?) AND p.slug = ? AND p.status = 'active'
                
                UNION
                
                SELECT u.id FROM users u
                INNER JOIN user_permissions up ON u.id = up.user_id
                INNER JOIN permissions p ON up.permission_id = p.id
                WHERE u.id = UUID_TO_BIN(?) AND p.slug = ? AND p.status = 'active'
            ) as user_perms`,
            [userId, permissionSlug, userId, permissionSlug]
        );
        
        return rows[0].count > 0;
    } catch (err) {
        console.error('Error checking permission:', err);
        return false;
    }
}

// Get all user permissions
async function getUserPermissions(userId) {
    try {
        const [rows] = await pool.execute(
            `SELECT DISTINCT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.slug,
                p.module,
                p.description
            FROM (
                SELECT permission_id FROM role_permissions rp
                WHERE rp.role_id = (SELECT role_id FROM users WHERE id = UUID_TO_BIN(?))
                
                UNION
                
                SELECT permission_id FROM user_permissions up
                WHERE up.user_id = UUID_TO_BIN(?)
            ) as user_perms
            JOIN permissions p ON user_perms.permission_id = p.id
            WHERE p.status = 'active'
            ORDER BY p.module, p.name`,
            [userId, userId]
        );
        
        // Group by module
        const permissionsByModule = {};
        rows.forEach(perm => {
            if (!permissionsByModule[perm.module]) {
                permissionsByModule[perm.module] = [];
            }
            permissionsByModule[perm.module].push(perm);
        });
        
        return {
            list: rows,
            byModule: permissionsByModule
        };
    } catch (err) {
        console.error('Error getting user permissions:', err);
        return { list: [], byModule: {} };
    }
}

// Check if user has specific role
function hasRole(userRole, allowedRoles) {
    return allowedRoles.includes(userRole);
}

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
    if (!req.session?.userId) {
        req.session.returnTo = req.originalUrl;
        req.flash('error', 'Please log in to access this page');
        return res.redirect('/login');
    }
    next();
}

// Middleware to check role
function checkRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.session?.userId) {
            req.session.returnTo = req.originalUrl;
            req.flash('error', 'Please log in to access this page');
            return res.redirect('/login');
        }
        
        const userRole = req.session.roleName;
        
        if (allowedRoles.includes(userRole)) {
            next();
        } else {
            // For API requests
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(403).json({ 
                    error: 'Access denied. You don\'t have the required role to perform this action.' 
                });
            }
            
            // For page requests
            req.flash('error', 'You do not have permission to access this page');
            res.status(403).render('errors/403', {
                title: 'Access Denied',
                message: 'You don\'t have the required role to access this page.',
                requiredRoles: allowedRoles,
                userRole: userRole
            });
        }
    };
}

// Middleware to check permission
function checkPermission(permissionSlug) {
    return async (req, res, next) => {
        if (!req.session?.userId) {
            req.session.returnTo = req.originalUrl;
            req.flash('error', 'Please log in to access this page');
            return res.redirect('/login');
        }
        
        const hasPerm = await hasPermission(req.session.userId, permissionSlug);
        
        if (!hasPerm) {
            // For API requests
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(403).json({ 
                    error: 'Access denied. You don\'t have permission to perform this action.' 
                });
            }
            
            // For page requests
            req.flash('error', 'You do not have permission to access this page');
            return res.status(403).render('errors/403', {
                title: 'Access Denied',
                message: 'You don\'t have permission to access this page.',
                requiredPermission: permissionSlug,
                userRole: req.session.roleName
            });
        }
        
        next();
    };
}

// Check if user has any of the permissions
async function hasAnyPermission(userId, permissionSlugs) {
    for (const slug of permissionSlugs) {
        if (await hasPermission(userId, slug)) {
            return true;
        }
    }
    return false;
}

// Middleware to check any permission
function checkAnyPermission(permissionSlugs) {
    return async (req, res, next) => {
        if (!req.session?.userId) {
            req.session.returnTo = req.originalUrl;
            req.flash('error', 'Please log in to access this page');
            return res.redirect('/login');
        }
        
        const hasAny = await hasAnyPermission(req.session.userId, permissionSlugs);
        
        if (!hasAny) {
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(403).json({ 
                    error: 'Access denied. You don\'t have permission to perform this action.' 
                });
            }
            
            req.flash('error', 'You do not have permission to access this page');
            return res.status(403).render('errors/403', {
                title: 'Access Denied',
                message: 'You don\'t have permission to access this page.',
                requiredPermissions: permissionSlugs,
                userRole: req.session.roleName
            });
        }
        
        next();
    };
}

module.exports = {
    hasPermission,
    getUserPermissions,
    hasRole,
    isAuthenticated,
    checkRole,
    checkPermission,
    checkAnyPermission,
    hasAnyPermission,
    binToUuid,
    uuidToBin
};