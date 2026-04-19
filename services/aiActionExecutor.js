/**
 * AI Action Executor
 * When the AI returns a structured action (e.g., "add_bill_item", "update_inventory"),
 * this executor validates and performs the actual database operation.
 * 
 * Safety:
 * - All actions are validated before execution
 * - Write operations are wrapped in transactions
 * - All actions are logged to admin_actions table
 */

const { pool } = require('../db');
const { v4: uuidv4 } = require('uuid');

class AIActionExecutor {

  /**
   * Execute an AI-suggested action
   * @param {string} action - Action type (e.g., "add_bill_item")
   * @param {object} params - Action parameters
   * @param {object} context - User context (shopId, userId)
   * @returns {object} Result of the action
   */
  async execute(action, params, context) {
    const { shopId, userId } = context;

    if (!shopId || !userId) {
      return { success: false, error: 'Missing shop or user context' };
    }

    // Validate the action is supported
    const handler = this.handlers[action];
    if (!handler) {
      return { success: false, error: `Unknown action: ${action}` };
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Execute the action
      const result = await handler.call(this, params, shopId, userId, connection);

      // Log the action
      await this._logAction(connection, action, params, result, shopId, userId);

      await connection.commit();
      return { success: true, ...result };

    } catch (error) {
      await connection.rollback();
      console.error(`[AI Action Executor] Error executing ${action}:`, error);
      return { success: false, error: error.message };
    } finally {
      connection.release();
    }
  }

  /**
   * Supported action handlers
   */
  handlers = {

    /**
     * Add an item to a bill
     */
    add_bill_item: async function (params, shopId, userId, conn) {
      const { product_name, quantity, bill_id } = params;

      if (!product_name || !quantity) {
        throw new Error('Product name and quantity are required');
      }

      // Find the product
      const [products] = await conn.execute(
        `SELECT BIN_TO_UUID(p.id) AS id, p.name, i.selling_price, i.current_quantity
         FROM products p
         JOIN inventory i ON i.product_id = p.id AND i.shop_id = p.shop_id
         WHERE p.shop_id = UUID_TO_BIN(?) AND LOWER(p.name) LIKE ?
         LIMIT 1`,
        [shopId, `%${product_name.toLowerCase()}%`]
      );

      if (products.length === 0) {
        throw new Error(`Product "${product_name}" not found`);
      }

      const product = products[0];

      if (product.current_quantity < quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.current_quantity}`);
      }

      return {
        action: 'add_bill_item',
        product: {
          id: product.id,
          name: product.name,
          unit_price: product.selling_price,
          quantity: quantity,
          total_price: product.selling_price * quantity,
        },
        message: `Ready to add ${quantity}x ${product.name} @ ${product.selling_price} each = ${product.selling_price * quantity}`,
      };
    },

    /**
     * Get stock level for a product
     */
    check_stock: async function (params, shopId, userId, conn) {
      const { product_name } = params;

      const [rows] = await conn.execute(
        `SELECT BIN_TO_UUID(p.id) AS id, p.name, i.current_quantity, i.selling_price
         FROM products p
         JOIN inventory i ON i.product_id = p.id AND i.shop_id = p.shop_id
         WHERE p.shop_id = UUID_TO_BIN(?) AND LOWER(p.name) LIKE ?
         LIMIT 5`,
        [shopId, `%${(product_name || '').toLowerCase()}%`]
      );

      return {
        action: 'check_stock',
        products: rows,
        message: rows.length > 0
          ? `Found ${rows.length} product(s) matching "${product_name}"`
          : `No products found matching "${product_name}"`,
      };
    },

    /**
     * Create a reorder/purchase draft
     */
    create_reorder_draft: async function (params, shopId, userId, conn) {
      const { product_id, quantity, supplier_id } = params;

      if (!product_id || !quantity) {
        throw new Error('Product ID and quantity are required for reorder');
      }

      // This creates a record in admin_actions as a draft — 
      // actual purchase order creation depends on your PO system
      return {
        action: 'create_reorder_draft',
        draft: {
          product_id,
          quantity,
          supplier_id: supplier_id || null,
          status: 'pending_approval',
        },
        message: `Reorder draft created for product ${product_id}: ${quantity} units`,
      };
    },

    /**
     * Log an expense
     */
    log_expense: async function (params, shopId, userId, conn) {
      const { category, description, amount, expense_date } = params;

      if (!category || !amount) {
        throw new Error('Category and amount are required for expense');
      }

      const id = uuidv4();
      await conn.execute(
        `INSERT INTO expenses (id, shop_id, category, description, amount, expense_date, created_by)
         VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, UUID_TO_BIN(?))`,
        [id, shopId, category, description || '', amount, expense_date || new Date().toISOString().split('T')[0], userId]
      );

      return {
        action: 'log_expense',
        expense_id: id,
        message: `Expense logged: ${category} — ${amount}`,
      };
    },
  };

  /**
   * Log an AI action for audit trail
   */
  async _logAction(conn, action, params, result, shopId, userId) {
    try {
      const id = uuidv4();
      await conn.execute(
        `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details)
         VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?)`,
        [
          id,
          userId,
          shopId,
          `ai_action:${action}`,
          JSON.stringify({ params, result: { message: result.message } }),
        ]
      );
    } catch (err) {
      console.warn('[AI Action Executor] Failed to log action:', err.message);
    }
  }
}

module.exports = new AIActionExecutor();
