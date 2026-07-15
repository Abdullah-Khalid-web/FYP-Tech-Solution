const { pool } = require('../db');
const { binToUuid, uuidToBin } = require('../helpers/permissionHelper');

// List all roles
exports.listRoles = async (req, res) => {
    try {
        const [roles] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                role_name,
                description,
                status,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
            FROM roles
            ORDER BY 
                CASE 
                    WHEN role_name = 'Super Admin' THEN 1
                    WHEN role_name = 'Admin' THEN 2
                    WHEN role_name = 'Shop Owner' THEN 3
                    ELSE 4
                END,
                role_name`
        );

        // Get user count for each role
        for (let role of roles) {
            const [users] = await pool.execute(
                `SELECT COUNT(*) as count FROM users WHERE role_id = UUID_TO_BIN(?)`,
                [role.id]
            );
            role.userCount = users[0].count;
        }

        res.render('roles/index', {
            title: 'Role Management',
            roles,
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error('Error listing roles:', err);
        res.render('roles/index', {
            title: 'Role Management',
            roles: [],
            error: 'Failed to load roles'
        });
    }
};

// Show create role form
exports.showCreateRole = async (req, res) => {
    try {
        // Get all permissions grouped by module
        const [permissions] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                slug,
                description,
                module
            FROM permissions
            WHERE status = 'active'
            ORDER BY 
                CASE 
                    WHEN module = 'dashboard' THEN 1
                    WHEN module = 'products' THEN 2
                    WHEN module = 'raw_materials' THEN 3
                    WHEN module = 'ingredients' THEN 4
                    WHEN module = 'inventory' THEN 5
                    WHEN module = 'bills' THEN 6
                    WHEN module = 'customers' THEN 7
                    WHEN module = 'suppliers' THEN 8
                    WHEN module = 'employees' THEN 9
                    WHEN module = 'expenses' THEN 10
                    WHEN module = 'cash' THEN 11
                    WHEN module = 'feedback' THEN 12
                    WHEN module = 'reports' THEN 13
                    WHEN module = 'shop_settings' THEN 14
                    WHEN module = 'subscriptions' THEN 15
                    WHEN module = 'profile' THEN 16
                    ELSE 99
                END,
                name`
        );

        // Group permissions by module
        const permissionsByModule = {};
        permissions.forEach(perm => {
            if (!permissionsByModule[perm.module]) {
                permissionsByModule[perm.module] = [];
            }
            permissionsByModule[perm.module].push(perm);
        });

        res.render('roles/create', {
            title: 'Create Role',
            permissionsByModule,
            error: req.query.error
        });
    } catch (err) {
        console.error('Error showing create role:', err);
        res.redirect('/roles?error=Failed to load permissions');
    }
};

// Create new role
exports.createRole = async (req, res) => {
    const { role_name, description, permissions } = req.body;

    if (!role_name) {
        return res.redirect('/roles/create?error=Role name is required');
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
        // Check if role already exists
        const [existing] = await conn.execute(
            'SELECT id FROM roles WHERE role_name = ?',
            [role_name]
        );

        if (existing.length > 0) {
            await conn.rollback();
            conn.release();
            return res.redirect('/roles/create?error=Role name already exists');
        }

        // Insert role
        const [roleResult] = await conn.execute(
            `INSERT INTO roles (id, role_name, description, status, created_at, updated_at)
             VALUES (UUID_TO_BIN(UUID()), ?, ?, 'active', NOW(), NOW())`,
            [role_name, description || null]
        );

        // Get the role ID
        const [[{ id }]] = await conn.execute(
            'SELECT id FROM roles WHERE role_name = ? ORDER BY created_at DESC LIMIT 1',
            [role_name]
        );

        // Assign permissions if any
        if (permissions && permissions.length > 0) {
            const permissionArray = Array.isArray(permissions) ? permissions : [permissions];
            
            for (const permId of permissionArray) {
                await conn.execute(
                    `INSERT INTO role_permissions (id, role_id, permission_id, created_at)
                     VALUES (UUID_TO_BIN(UUID()), ?, UUID_TO_BIN(?), NOW())`,
                    [id, permId]
                );
            }
        }

        await conn.commit();
        conn.release();

        res.redirect('/roles?success=Role created successfully');
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('Error creating role:', err);
        res.redirect('/roles/create?error=Failed to create role');
    }
};

// Show edit role form
exports.showEditRole = async (req, res) => {
    const { id } = req.params;

    try {
        // Get role details
        const [roles] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                role_name,
                description,
                status
            FROM roles
            WHERE id = UUID_TO_BIN(?)`,
            [id]
        );

        if (!roles.length) {
            return res.redirect('/roles?error=Role not found');
        }

        // Get all permissions grouped by module
        const [allPermissions] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                slug,
                description,
                module
            FROM permissions
            WHERE status = 'active'
            ORDER BY 
                CASE 
                    WHEN module = 'dashboard' THEN 1
                    WHEN module = 'products' THEN 2
                    WHEN module = 'raw_materials' THEN 3
                    WHEN module = 'ingredients' THEN 4
                    WHEN module = 'inventory' THEN 5
                    WHEN module = 'bills' THEN 6
                    WHEN module = 'customers' THEN 7
                    WHEN module = 'suppliers' THEN 8
                    WHEN module = 'employees' THEN 9
                    WHEN module = 'expenses' THEN 10
                    WHEN module = 'cash' THEN 11
                    WHEN module = 'feedback' THEN 12
                    WHEN module = 'reports' THEN 13
                    WHEN module = 'shop_settings' THEN 14
                    WHEN module = 'subscriptions' THEN 15
                    WHEN module = 'profile' THEN 16
                    ELSE 99
                END,
                name`
        );

        // Get role's current permissions
        const [rolePermissions] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(permission_id) as permission_id
            FROM role_permissions
            WHERE role_id = UUID_TO_BIN(?)`,
            [id]
        );

        const rolePermIds = rolePermissions.map(rp => rp.permission_id);

        // Group permissions by module
        const permissionsByModule = {};
        allPermissions.forEach(perm => {
            if (!permissionsByModule[perm.module]) {
                permissionsByModule[perm.module] = [];
            }
            permissionsByModule[perm.module].push({
                ...perm,
                assigned: rolePermIds.includes(perm.id)
            });
        });

        res.render('roles/edit', {
            title: 'Edit Role',
            role: roles[0],
            permissionsByModule,
            error: req.query.error
        });
    } catch (err) {
        console.error('Error showing edit role:', err);
        res.redirect('/roles?error=Failed to load role');
    }
};

// Update role
exports.updateRole = async (req, res) => {
    const { id } = req.params;
    const { role_name, description, status, permissions } = req.body;

    if (!role_name) {
        return res.redirect(`/roles/${id}/edit?error=Role name is required`);
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
        // Update role
        await conn.execute(
            `UPDATE roles 
             SET role_name = ?, description = ?, status = ?, updated_at = NOW()
             WHERE id = UUID_TO_BIN(?)`,
            [role_name, description || null, status || 'active', id]
        );

        // Delete old permissions
        await conn.execute(
            'DELETE FROM role_permissions WHERE role_id = UUID_TO_BIN(?)',
            [id]
        );

        // Assign new permissions
        if (permissions && permissions.length > 0) {
            const permissionArray = Array.isArray(permissions) ? permissions : [permissions];
            
            for (const permId of permissionArray) {
                await conn.execute(
                    `INSERT INTO role_permissions (id, role_id, permission_id, created_at)
                     VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), NOW())`,
                    [id, permId]
                );
            }
        }

        await conn.commit();
        conn.release();

        res.redirect('/roles?success=Role updated successfully');
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('Error updating role:', err);
        res.redirect(`/roles/${id}/edit?error=Failed to update role`);
    }
};

// Delete role
exports.deleteRole = async (req, res) => {
    const { id } = req.params;

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
        // Check if role is assigned to any users
        const [users] = await conn.execute(
            'SELECT COUNT(*) as count FROM users WHERE role_id = UUID_TO_BIN(?)',
            [id]
        );

        if (users[0].count > 0) {
            await conn.rollback();
            conn.release();
            return res.redirect('/roles?error=Cannot delete role assigned to users');
        }

        // Delete role permissions
        await conn.execute(
            'DELETE FROM role_permissions WHERE role_id = UUID_TO_BIN(?)',
            [id]
        );

        // Delete role
        await conn.execute(
            'DELETE FROM roles WHERE id = UUID_TO_BIN(?)',
            [id]
        );

        await conn.commit();
        conn.release();

        res.redirect('/roles?success=Role deleted successfully');
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('Error deleting role:', err);
        res.redirect('/roles?error=Failed to delete role');
    }
};

// View role permissions
exports.viewRolePermissions = async (req, res) => {
    const { id } = req.params;

    try {
        const [role] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                role_name,
                description
            FROM roles
            WHERE id = UUID_TO_BIN(?)`,
            [id]
        );

        if (!role.length) {
            return res.redirect('/roles?error=Role not found');
        }

        const [permissions] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.slug,
                p.description,
                p.module
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            WHERE rp.role_id = UUID_TO_BIN(?)
            ORDER BY p.module, p.name`,
            [id]
        );

        res.render('roles/permissions', {
            title: 'Role Permissions',
            role: role[0],
            permissions
        });
    } catch (err) {
        console.error('Error viewing role permissions:', err);
        res.redirect('/roles?error=Failed to load permissions');
    }
};