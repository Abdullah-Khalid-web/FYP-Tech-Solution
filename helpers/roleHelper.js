// helpers/roleHelper.js
class RoleHelper {
    constructor(session) {
        this.session = session || {};
        this.role = session?.roleName || 'No Role';
        this.roleId = session?.roleId || null;
        this.userId = session?.userId || null;
        
        console.log('RoleHelper initialized with role:', this.role); // Debug log
    }
    
    isAdmin() {
        const adminRoles = ['Super Admin', 'Admin', 'Shop Owner'];
        const result = adminRoles.includes(this.role);
        console.log(`isAdmin check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    isManager() {
        const managerRoles = ['Shop Owner', 'Shop Manager'];
        const result = managerRoles.includes(this.role);
        console.log(`isManager check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    canAccessSales() {
        const roles = ['Shop Owner', 'Shop Manager', 'Accountant', 'Cashier', 'Sales Representative', 'Admin', 'Super Admin'];
        const result = roles.includes(this.role);
        console.log(`canAccessSales check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    canViewEmployees() {
        const roles = ['Shop Owner', 'Shop Manager', 'HR Manager', 'Accountant', 'Admin', 'Super Admin'];
        const result = roles.includes(this.role);
        console.log(`canViewEmployees check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    canAccessInventory() {
        const roles = ['Shop Owner', 'Shop Manager', 'Inventory Manager', 'Admin', 'Super Admin'];
        const result = roles.includes(this.role);
        console.log(`canAccessInventory check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    canManageEmployees() {
        const roles = ['Shop Owner', 'Shop Manager', 'HR Manager', 'Admin', 'Super Admin'];
        const result = roles.includes(this.role);
        console.log(`canManageEmployees check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    canAccessFinance() {
        const roles = ['Shop Owner', 'Accountant', 'Admin', 'Super Admin'];
        const result = roles.includes(this.role);
        console.log(`canAccessFinance check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    canAccessReports() {
        const roles = ['Shop Owner', 'Shop Manager', 'Accountant', 'Admin', 'Super Admin'];
        const result = roles.includes(this.role);
        console.log(`canAccessReports check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    canManageSettings() {
        const roles = ['Shop Owner', 'Admin', 'Super Admin'];
        const result = roles.includes(this.role);
        console.log(`canManageSettings check for role ${this.role}: ${result}`); // Debug log
        return result;
    }
    
    getRoleLevel() {
        const levels = {
            'Super Admin': 100,
            'Admin': 90,
            'Shop Owner': 80,
            'Shop Manager': 70,
            'Accountant': 60,
            'HR Manager': 50,
            'Inventory Manager': 40,
            'Cashier': 30,
            'Sales Representative': 20,
            'Viewer': 10,
            'No Role': 0
        };
        return levels[this.role] || 0;
    }
    
    getAllowedQuickActions() {
        const actions = [];
        
        // Products - available to all logged-in users
        actions.push({
            url: '/products',
            icon: 'fa-box',
            bg: 'bg-primary',
            label: 'Products'
        });
        
        // Bills - for sales roles (Shop Owner can access)
        if (this.canAccessSales()) {
            actions.push({
                url: '/bills',
                icon: 'fa-receipt',
                bg: 'bg-success',
                label: 'Create Bill'
            });
        }
        
        // Suppliers
        actions.push({
            url: '/suppliers',
            icon: 'fa-truck',
            bg: 'bg-info',
            label: 'Suppliers'
        });
        
        // Employees - for HR/Manager roles (Shop Owner can access)
        if (this.canViewEmployees()) {
            actions.push({
                url: '/EmpMgmt',
                icon: 'fa-users',
                bg: 'bg-warning',
                label: 'Employees'
            });
        }
        
        // Reports - for finance roles (Shop Owner can access)
        if (this.canAccessReports()) {
            actions.push({
                url: '/reports',
                icon: 'fa-chart-bar',
                bg: 'bg-secondary',
                label: 'Reports'
            });
        }
        
        // Feedback - available to all
        actions.push({
            url: '/feedback',
                icon: 'fa-comment',
            bg: 'bg-primary',
            label: 'Feedback'
        });
        
        // Shop Settings - admin only (Shop Owner can access)
        if (this.canManageSettings()) {
            actions.push({
                url: '/shop_setting',
                icon: 'fa-cog',
                bg: 'bg-dark',
                label: 'Settings'
            });
        }
        
        // Expenses - finance roles (Shop Owner can access)
        if (this.canAccessFinance()) {
            actions.push({
                url: '/expenses',
                icon: 'fa-money-bill',
                bg: 'bg-secondary',
                label: 'Expenses'
            });
        }
        
        // Raw Materials - inventory roles (Shop Owner can access)
        if (this.canAccessInventory()) {
            actions.push({
                url: '/raw',
                icon: 'fa-cubes',
                bg: 'bg-primary',
                label: 'Raw Material'
            });
        }
        
        // Customers - sales roles (Shop Owner can access)
        if (this.canAccessSales()) {
            actions.push({
                url: '/customer',
                icon: 'fa-user',
                bg: 'bg-primary',
                label: 'Customer'
            });
        }
        
        console.log('Allowed quick actions for role', this.role, ':', actions.length); // Debug log
        return actions;
    }
}

module.exports = RoleHelper;