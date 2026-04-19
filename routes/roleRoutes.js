const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { checkPermission } = require('../helpers/permissionHelper');

// All role routes require 'shop.roles' permission
router.use(checkPermission('shop.roles'));

// Role management routes
router.get('/', roleController.listRoles);
router.get('/create', roleController.showCreateRole);
router.post('/create', roleController.createRole);
router.get('/:id/edit', roleController.showEditRole);
router.post('/:id/edit', roleController.updateRole);
router.get('/:id/delete', roleController.deleteRole);
router.get('/:id/permissions', roleController.viewRolePermissions);

module.exports = router;