// middleware/roleMiddleware.js
const permissionHelper = require('../helpers/permissionHelper');

// Role-based access control
const roles = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    SHOP_OWNER: 'Shop Owner',
    SHOP_MANAGER: 'Shop Manager',
    ACCOUNTANT: 'Accountant',
    CASHIER: 'Cashier',
    INVENTORY_MANAGER: 'Inventory Manager',
    HR_MANAGER: 'HR Manager',
    SALES_REP: 'Sales Representative',
    VIEWER: 'Viewer'
};

// Module access configurations
const moduleAccess = {
    // Dashboard - everyone can view
    dashboard: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
               roles.ACCOUNTANT, roles.CASHIER, roles.INVENTORY_MANAGER, roles.HR_MANAGER, 
               roles.SALES_REP, roles.VIEWER]
    },
    
    // Products
    products: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
               roles.INVENTORY_MANAGER, roles.CASHIER, roles.SALES_REP, roles.VIEWER],
        create: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        delete: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER]
    },
    
    // Bills/Invoices
    bills: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
               roles.ACCOUNTANT, roles.CASHIER, roles.SALES_REP],
        create: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
                 roles.CASHIER, roles.SALES_REP],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.ACCOUNTANT],
        delete: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER],
        void: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER]
    },
    
    // Employees
    employees: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
               roles.HR_MANAGER, roles.ACCOUNTANT],
        create: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.HR_MANAGER],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.HR_MANAGER],
        delete: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER],
        manage_salary: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.ACCOUNTANT],
        manage_loans: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.ACCOUNTANT],
        manage_attendance: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.HR_MANAGER]
    },
    
    // Customers
    customers: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
               roles.CASHIER, roles.SALES_REP, roles.ACCOUNTANT],
        create: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
                 roles.CASHIER, roles.SALES_REP],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.SALES_REP],
        delete: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER],
        manage_credit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.ACCOUNTANT]
    },
    
    // Suppliers
    suppliers: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
               roles.INVENTORY_MANAGER, roles.ACCOUNTANT],
        create: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        delete: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER],
        manage_payments: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.ACCOUNTANT]
    },
    
    // Inventory
    inventory: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, 
               roles.INVENTORY_MANAGER, roles.CASHIER, roles.SALES_REP],
        manage: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        adjust: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        stock_in: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        stock_out: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER]
    },
    
    // Raw Materials
    raw_materials: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        create: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        delete: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER]
    },
    
    // Expenses
    expenses: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.ACCOUNTANT],
        create: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.ACCOUNTANT],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.ACCOUNTANT],
        delete: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER],
        approve: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER]
    },
    
    // Reports
    reports: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.ACCOUNTANT],
        sales: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.ACCOUNTANT],
        inventory: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.INVENTORY_MANAGER],
        financial: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.ACCOUNTANT],
        employee: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.HR_MANAGER],
        export: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER, roles.ACCOUNTANT]
    },
    
    // Shop Settings
    shop_settings: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER],
        edit: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER],
        manage_users: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER],
        manage_roles: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER],
        manage_backup: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER]
    },
    
    // Feedback
    feedback: {
        view: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER],
        respond: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER, roles.SHOP_MANAGER],
        manage: [roles.SUPER_ADMIN, roles.ADMIN, roles.SHOP_OWNER]
    },
    
    // Admin only
    admin: {
        access: [roles.SUPER_ADMIN, roles.ADMIN]
    }
};

// Middleware factory for module access
function allowModule(moduleName, action = 'view') {
    return (req, res, next) => {
        if (!req.session?.userId) {
            req.session.returnTo = req.originalUrl;
            req.flash('error', 'Please log in to access this page');
            return res.redirect('/login');
        }
        
        const userRole = req.session.roleName;
        const allowedRoles = moduleAccess[moduleName]?.[action] || [];
        
        if (allowedRoles.includes(userRole)) {
            next();
        } else {
            req.flash('error', `You don't have permission to ${action} ${moduleName}`);
            res.status(403).render('errors/403', {
                title: 'Access Denied',
                message: `You don't have permission to ${action} ${moduleName.replace('_', ' ')}.`,
                requiredRoles: allowedRoles,
                userRole: userRole
            });
        }
    };
}

// Specific middleware for each module
const productAccess = {
    view: allowModule('products', 'view'),
    create: allowModule('products', 'create'),
    edit: allowModule('products', 'edit'),
    delete: allowModule('products', 'delete')
};

const billAccess = {
    view: allowModule('bills', 'view'),
    create: allowModule('bills', 'create'),
    edit: allowModule('bills', 'edit'),
    delete: allowModule('bills', 'delete'),
    void: allowModule('bills', 'void')
};

const employeeAccess = {
    view: allowModule('employees', 'view'),
    create: allowModule('employees', 'create'),
    edit: allowModule('employees', 'edit'),
    delete: allowModule('employees', 'delete'),
    manageSalary: allowModule('employees', 'manage_salary'),
    manageLoans: allowModule('employees', 'manage_loans'),
    manageAttendance: allowModule('employees', 'manage_attendance')
};

const customerAccess = {
    view: allowModule('customers', 'view'),
    create: allowModule('customers', 'create'),
    edit: allowModule('customers', 'edit'),
    delete: allowModule('customers', 'delete'),
    manageCredit: allowModule('customers', 'manage_credit')
};

const supplierAccess = {
    view: allowModule('suppliers', 'view'),
    create: allowModule('suppliers', 'create'),
    edit: allowModule('suppliers', 'edit'),
    delete: allowModule('suppliers', 'delete'),
    managePayments: allowModule('suppliers', 'manage_payments')
};

const inventoryAccess = {
    view: allowModule('inventory', 'view'),
    manage: allowModule('inventory', 'manage'),
    adjust: allowModule('inventory', 'adjust'),
    stockIn: allowModule('inventory', 'stock_in'),
    stockOut: allowModule('inventory', 'stock_out')
};

const expenseAccess = {
    view: allowModule('expenses', 'view'),
    create: allowModule('expenses', 'create'),
    edit: allowModule('expenses', 'edit'),
    delete: allowModule('expenses', 'delete'),
    approve: allowModule('expenses', 'approve')
};

const reportAccess = {
    view: allowModule('reports', 'view'),
    sales: allowModule('reports', 'sales'),
    inventory: allowModule('reports', 'inventory'),
    financial: allowModule('reports', 'financial'),
    employee: allowModule('reports', 'employee'),
    export: allowModule('reports', 'export')
};

const shopAccess = {
    view: allowModule('shop_settings', 'view'),
    edit: allowModule('shop_settings', 'edit'),
    manageUsers: allowModule('shop_settings', 'manage_users'),
    manageRoles: allowModule('shop_settings', 'manage_roles'),
    manageBackup: allowModule('shop_settings', 'manage_backup')
};

const feedbackAccess = {
    view: allowModule('feedback', 'view'),
    respond: allowModule('feedback', 'respond'),
    manage: allowModule('feedback', 'manage')
};

const adminAccess = {
    access: allowModule('admin', 'access')
};

module.exports = {
    roles,
    moduleAccess,
    allowModule,
    // Specific access controls
    productAccess,
    billAccess,
    employeeAccess,
    customerAccess,
    supplierAccess,
    inventoryAccess,
    expenseAccess,
    reportAccess,
    shopAccess,
    feedbackAccess,
    adminAccess,
    // Keep existing middleware
    isAuthenticated: permissionHelper.isAuthenticated,
    checkRole: permissionHelper.checkRole,
    checkPermission: permissionHelper.checkPermission,
    checkAnyPermission: permissionHelper.checkAnyPermission
};