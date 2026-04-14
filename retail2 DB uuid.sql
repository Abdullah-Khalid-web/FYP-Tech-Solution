-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Dec 27, 2025 at 07:05 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

-- Enable UUID functions
SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='TRADITIONAL,ALLOW_INVALID_DATES';

-- Create function to generate UUID if not exists
DROP FUNCTION IF EXISTS BIN_TO_UUID;
DROP FUNCTION IF EXISTS UUID_TO_BIN;

CREATE FUNCTION IF NOT EXISTS UUID_TO_BIN(uuid CHAR(36))
RETURNS BINARY(16) DETERMINISTIC
RETURN UNHEX(REPLACE(uuid, '-', ''));

CREATE FUNCTION IF NOT EXISTS BIN_TO_UUID(bin BINARY(16))
RETURNS CHAR(36) DETERMINISTIC
RETURN LOWER(CONCAT(
    HEX(SUBSTR(bin, 1, 4)), '-',
    HEX(SUBSTR(bin, 5, 2)), '-',
    HEX(SUBSTR(bin, 7, 2)), '-',
    HEX(SUBSTR(bin, 9, 2)), '-',
    HEX(SUBSTR(bin, 11, 6))
));


-- Table structure for table `pricing_plans`
CREATE TABLE `pricing_plans` (
  `id` BINARY(16) PRIMARY KEY,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `monthly_price` decimal(10,2) NOT NULL,
  `quarterly_price` decimal(10,2) NOT NULL,
  `yearly_price` decimal(10,2) NOT NULL,
  `features` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`features`)),
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  INDEX idx_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Table structure for table `roles`
CREATE TABLE roles (
    id BINARY(16) PRIMARY KEY,
    role_name VARCHAR(100) NOT NULL,
    description TEXT,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT current_timestamp(),
    updated_at TIMESTAMP DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    INDEX idx_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `permissions`
CREATE TABLE permissions (
    id BINARY(16) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    module VARCHAR(100) DEFAULT NULL, -- users, products, billing, inventory etc
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (`status`),
    INDEX idx_module (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Table structure for table `role_permissions`
CREATE TABLE role_permissions (
    id BINARY(16) PRIMARY KEY,
    role_id BINARY(16) NOT NULL,
    permission_id BINARY(16) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,

    UNIQUE KEY unique_role_permission (role_id, permission_id),
    INDEX idx_role_id (`role_id`),
    INDEX idx_permission_id (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Table structure for table `user_permissions`
CREATE TABLE user_permissions (
    id BINARY(16) PRIMARY KEY,
    user_id BINARY(16) NOT NULL,
    permission_id BINARY(16) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,

    UNIQUE KEY unique_user_permission (user_id, permission_id),
    INDEX idx_user_id (`user_id`),
    INDEX idx_permission_id (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Table structure for table `shops`
CREATE TABLE `shops` (
  `id` BINARY(16) PRIMARY KEY,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `logo` varchar(255) DEFAULT NULL,
  `plan` varchar(50) DEFAULT NULL,
  `currency` varchar(10) DEFAULT NULL,
  `primary_color` varchar(50) DEFAULT NULL,
  `secondary_color` varchar(50) NOT NULL,
  `status` varchar(20) DEFAULT NULL CHECK (`status` in ('active','inactive','suspended')),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  INDEX idx_email (`email`),
  INDEX idx_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `subscriptions`
CREATE TABLE `subscriptions` (
  `id` BINARY(16) PRIMARY KEY,
  `shop_id` BINARY(16) NOT NULL,
  `plan_name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `duration` enum('monthly','quarterly','yearly') NOT NULL,
  `started_at` date NOT NULL,
  `expires_at` date NOT NULL,
  `status` enum('active','expired','cancelled','pending') DEFAULT 'active',
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_details` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
  INDEX idx_shop_id (`shop_id`),
  INDEX idx_status (`status`),
  INDEX idx_expires_at (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `users`
CREATE TABLE `users` (
  `id` BINARY(16) PRIMARY KEY,
  `shop_id` BINARY(16) NOT NULL,
  `role_id` BINARY(16) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL UNIQUE,
  `password` varchar(255) NOT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `salary` decimal(10,2) DEFAULT NULL,
  `loan` decimal(10,2) DEFAULT NULL,
  `cnic` varchar(20) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL CHECK (`status` in ('active','inactive')),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `notes` varchar(250) DEFAULT NULL,
  `profile_picture` varchar(255) DEFAULT NULL,
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
  INDEX idx_shop_id (`shop_id`),
  INDEX idx_email (`email`),
  INDEX idx_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `admin_actions`
CREATE TABLE `admin_actions` (
  `id` BINARY(16) PRIMARY KEY ,
  `admin_id` BINARY(16) NOT NULL,
  `shop_id` BINARY(16) DEFAULT NULL,
  `action_type` varchar(100) NOT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
  INDEX idx_admin_id (`admin_id`),
  INDEX idx_shop_id (`shop_id`),
  INDEX idx_action_type (`action_type`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `backups`
CREATE TABLE `backups` (
  `id` BINARY(16) PRIMARY KEY ,
  `shop_id` BINARY(16) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `file_path` varchar(500) DEFAULT NULL,
  `file_size` bigint(20) DEFAULT NULL,
  `status` enum('pending','completed','failed') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
  INDEX idx_shop_id (`shop_id`),
  INDEX idx_status (`status`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `feedback`
CREATE TABLE `feedback` (
  `id` BINARY(16) PRIMARY KEY ,
  `shop_id` BINARY(16) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `rating` int(11) DEFAULT NULL,
  `status` enum('new','read','replied','resolved') DEFAULT 'new',
  `admin_notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE CASCADE,
  INDEX idx_shop_id (`shop_id`),
  INDEX idx_status (`status`),
  INDEX idx_rating (`rating`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `customers`
CREATE TABLE IF NOT EXISTS customers (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) DEFAULT NULL,
    email VARCHAR(255) DEFAULT NULL,
    address TEXT,
    type ENUM('regular', 'wholesale', 'corporate', 'vip') DEFAULT 'regular',
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Pakistan',
    notes TEXT,
    reference VARCHAR(255),
    discount DECIMAL(5,2) DEFAULT 0,
    credit_limit DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    UNIQUE KEY unique_phone_per_shop (shop_id, phone),
    INDEX idx_shop_id (shop_id),
    INDEX idx_phone (phone),
    INDEX idx_email (email),
    INDEX idx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Create user_loan table (Master loan record)
CREATE TABLE user_loan (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    loan_number VARCHAR(50) NOT NULL UNIQUE,
    loan_type ENUM('full', 'installment') NOT NULL DEFAULT 'full',
    total_amount DECIMAL(12,2) NOT NULL,
    total_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_balance DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - total_paid) STORED,
    installments INT DEFAULT 1,
    installment_amount DECIMAL(12,2),
    description TEXT,
    loan_date DATE NOT NULL,
    status ENUM('active', 'paid', 'cancelled') DEFAULT 'active',
    created_by BINARY(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_shop_id (shop_id),
    INDEX idx_user_id (user_id),
    INDEX idx_loan_number (loan_number),
    INDEX idx_status (status),
    INDEX idx_loan_date (loan_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Create user_loan_ledger table (Transaction records)
CREATE TABLE user_loan_ledger (
    id BINARY(16) PRIMARY KEY,
    loan_id BINARY(16) NOT NULL,
    shop_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    transaction_type ENUM('credit', 'debit') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    payment_method VARCHAR(50) DEFAULT 'cash',
    reference_id BINARY(16),
    reference_type ENUM('salary_deduction', 'direct_payment', 'adjustment', 'other') DEFAULT 'direct_payment',
    created_by BINARY(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES user_loan(id) ON DELETE CASCADE,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_loan_id (loan_id),
    INDEX idx_user_id (user_id),
    INDEX idx_shop_id (shop_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Create trigger to update loan balance when ledger entries are added
DELIMITER $$
CREATE TRIGGER after_loan_ledger_insert
AFTER INSERT ON user_loan_ledger
FOR EACH ROW
BEGIN
    IF NEW.transaction_type = 'debit' THEN
        -- Payment made, increase paid amount
        UPDATE user_loan 
        SET total_paid = total_paid + NEW.amount,
            status = CASE 
                WHEN (total_amount - (total_paid + NEW.amount)) <= 0 THEN 'paid'
                ELSE 'active'
            END
        WHERE id = NEW.loan_id;
    END IF;
END$$
DELIMITER ;

-- Function to generate loan number
DELIMITER $$
CREATE FUNCTION generate_loan_number(shop_prefix VARCHAR(10)) 
RETURNS VARCHAR(50) DETERMINISTIC
BEGIN
    DECLARE next_num INT;
    DECLARE loan_number VARCHAR(50);
    
    -- Get next sequence number for today
    SELECT COALESCE(MAX(SUBSTRING(loan_number, -4)), 0) + 1 INTO next_num
    FROM user_loan 
    WHERE loan_number LIKE CONCAT(shop_prefix, '-', DATE_FORMAT(NOW(), '%Y%m%d'), '-%');
    
    -- Generate loan number: SHOP-YYYYMMDD-0001
    SET loan_number = CONCAT(
        shop_prefix, '-', 
        DATE_FORMAT(NOW(), '%Y%m%d'), '-',
        LPAD(next_num, 4, '0')
    );
    
    RETURN loan_number;
END$$
DELIMITER ;

-- Table structure for table `user_salary`
CREATE TABLE user_salary (
    id BINARY(16) PRIMARY KEY ,
    shop_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    bonus DECIMAL(10,2) DEFAULT 0,
    fine DECIMAL(10,2) DEFAULT 0,
    net_amount DECIMAL(12,2) AS (amount + bonus - fine) STORED,
    month VARCHAR(7) NOT NULL,
    paid_on DATE,
    status ENUM('paid','pending') DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_user_id (`user_id`),
    INDEX idx_status (`status`),
    INDEX idx_month (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `suppliers`
CREATE TABLE suppliers (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    tax_number VARCHAR(100),
    payment_terms VARCHAR(100),
    type ENUM('product','raw_material','both') DEFAULT 'both',
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_status (`status`),
    INDEX idx_type (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `supplier_transactions`
CREATE TABLE supplier_transactions (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    supplier_id BINARY(16) NOT NULL,
    type ENUM('credit','debit') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_supplier_id (`supplier_id`),
    INDEX idx_type (`type`),
    INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `supplier_balance`
CREATE TABLE supplier_balance (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    supplier_id BINARY(16) NOT NULL,
    total_debit DECIMAL(12,2) DEFAULT 0,
    total_credit DECIMAL(12,2) DEFAULT 0,
    balance DECIMAL(12,2) GENERATED ALWAYS AS (total_debit - total_credit) STORED,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_supplier_id (`supplier_id`),
    UNIQUE KEY unique_supplier_balance (shop_id, supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `products`
CREATE TABLE products (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(255),
    category VARCHAR(255),
    size VARCHAR(100),
    sku VARCHAR(100),
    barcode VARCHAR(100),
    active VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_category (`category`),
    INDEX idx_sku (`sku`),
    INDEX idx_barcode (`barcode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `raw_materials`
CREATE TABLE raw_materials (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    barcode VARCHAR(100),
    category VARCHAR(100),
    description TEXT,
    unit_of_measure VARCHAR(50) DEFAULT 'pcs',
    current_stock DECIMAL(10,3) DEFAULT 0,
    min_stock_level DECIMAL(10,3) DEFAULT 0,
    max_stock_level DECIMAL(10,3) DEFAULT 0,
    cost_price DECIMAL(10,2) DEFAULT 0,
    supplier_id BINARY(16),
    batch_tracking BOOLEAN DEFAULT FALSE,
    expiry_tracking BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by BINARY(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_category (`category`),
    INDEX idx_supplier_id (`supplier_id`),
    INDEX idx_is_active (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `raw_material_stock_movements`
CREATE TABLE raw_material_stock_movements (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    raw_material_id BINARY(16) NOT NULL,
    batch_number VARCHAR(100),
    movement_type ENUM('in', 'out', 'adjustment') NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_cost DECIMAL(10,2) DEFAULT 0,
    total_cost DECIMAL(10,2) DEFAULT 0,
    reference_type ENUM('purchase', 'production', 'waste', 'adjustment', 'transfer') NOT NULL,
    reference_id BINARY(16),
    notes TEXT,
    movement_date DATE NOT NULL,
    expiry_date DATE,
    created_by BINARY(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_raw_material_id (`raw_material_id`),
    INDEX idx_movement_date (`movement_date`),
    INDEX idx_batch_number (`batch_number`),
    INDEX idx_reference_type (`reference_type`),
    INDEX idx_shop_id (`shop_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `ingredients`
CREATE TABLE ingredients (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    main_product_id BINARY(16) NOT NULL,
    raw_material_id BINARY(16) NOT NULL,
    quantity_required DECIMAL(10,3) NOT NULL,
    unit VARCHAR(50) DEFAULT 'pcs',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (main_product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (raw_material_id) REFERENCES raw_materials(id) ON DELETE CASCADE,
    UNIQUE KEY unique_product_raw_material (main_product_id, raw_material_id),
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_main_product_id (`main_product_id`),
    INDEX idx_raw_material_id (`raw_material_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `stock_in`
CREATE TABLE stock_in (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    product_id BINARY(16) NOT NULL,
    batch_number VARCHAR(100),
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    expiry_date DATE,
    supplier_id BINARY(16),
    received_by BINARY(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_product_id (`product_id`),
    INDEX idx_supplier_id (`supplier_id`),
    INDEX idx_received_by (`received_by`),
    INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `bills`
CREATE TABLE bills (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    bill_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id BINARY(16) DEFAULT NULL,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    subtotal DECIMAL(10,2) NOT NULL,
    discount DECIMAL(10,2) DEFAULT 0,
    tax DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    paid_amount DECIMAL(10,2) NOT NULL,
    due_amount DECIMAL(10,2) DEFAULT 0,
    payment_method VARCHAR(50),
    notes TEXT,
    created_by BINARY(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_customer_phone (`customer_phone`),
    INDEX idx_created_at (`created_at`),
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_customer_id (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `bill_items`
CREATE TABLE bill_items (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    product_id BINARY(16) NOT NULL,
    batch_number VARCHAR(100),
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    bill_id BINARY(16),
    sold_by BINARY(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (sold_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    INDEX idx_bill_id (`bill_id`),
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_product_id (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `inventory`
CREATE TABLE inventory (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    product_id BINARY(16) NOT NULL,
    current_quantity DECIMAL(10,3) DEFAULT 0,
    avg_cost DECIMAL(12,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_product_id (`product_id`),
    UNIQUE KEY unique_product_inventory (shop_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `user_cash_submission`
CREATE TABLE user_cash_submission (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    submission_date DATE NOT NULL,
    total_collected DECIMAL(12,2) NOT NULL,
    submitted_amount DECIMAL(12,2) NOT NULL,
    difference DECIMAL(12,2) AS (total_collected - submitted_amount) STORED,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_user_id (`user_id`),
    INDEX idx_submission_date (`submission_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Add new columns to stock_in table
ALTER TABLE stock_in 
ADD COLUMN buying_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER unit_price,
ADD COLUMN selling_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER buying_price,
ADD COLUMN total_buying_value DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER selling_price,
ADD COLUMN transaction_type ENUM('credit', 'cash', 'partial') DEFAULT 'credit' AFTER supplier_id,
ADD COLUMN payment_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER transaction_type,
ADD COLUMN notes TEXT AFTER payment_amount;

-- Update existing records (copy unit_price to buying_price for existing data)
UPDATE stock_in SET 
    buying_price = unit_price,
    selling_price = ROUND(unit_price * 1.3, 2),
    total_buying_value = ROUND(quantity * unit_price, 2)
WHERE buying_price = 0;

-- Add reference fields to supplier_transactions
ALTER TABLE supplier_transactions 
ADD COLUMN reference_type ENUM('stock_in', 'payment', 'adjustment', 'other') DEFAULT 'stock_in' AFTER description,
ADD COLUMN reference_id BINARY(16) AFTER reference_type,
ADD COLUMN created_by BINARY(16) AFTER reference_id,
ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
ADD INDEX idx_reference_type (`reference_type`),
ADD INDEX idx_reference_id (`reference_id`);

-- Add total_debit and total_credit for easier balance calculation
ALTER TABLE supplier_balance
ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER balance;

-- Add selling_price to inventory table
ALTER TABLE inventory 
ADD COLUMN selling_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER avg_cost,
ADD COLUMN last_buying_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER selling_price;

ALTER TABLE products 
ADD COLUMN status ENUM('active', 'inactive') DEFAULT 'active';

ALTER TABLE `suppliers` 
ADD `account_number` VARCHAR(50) NULL , 
ADD `bank_name` VARCHAR(50) NULL,
ADD `notes` VARCHAR(100) NULL ,
ADD `city` VARCHAR(50) NULL ,
ADD `country` VARCHAR(50) NULL;

-- Table structure for table `expenses`
CREATE TABLE expenses (
    id BINARY(16) PRIMARY KEY,
    shop_id BINARY(16) NOT NULL,
    category VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    expense_date DATE NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'cash',
    receipt_number VARCHAR(100),
    created_by BINARY(16) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_shop_id (shop_id),
    INDEX idx_created_by (created_by),
    INDEX idx_category (category),
    INDEX idx_expense_date (expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- Add supplier_id to stock movements
ALTER TABLE raw_material_stock_movements 
ADD COLUMN supplier_id BINARY(16) AFTER reference_id,
ADD CONSTRAINT fk_supplier 
FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE user_salary 
ADD updated_at TIMESTAMP NULL AFTER created_at;


-- If inventory table is missing min_stock_level
ALTER TABLE inventory ADD COLUMN min_stock_level DECIMAL(10,3) DEFAULT 10;

-- Add default values to avoid NULL issues
UPDATE inventory SET 
    current_quantity = COALESCE(current_quantity, 0),
    avg_cost = COALESCE(avg_cost, 0),
    selling_price = COALESCE(selling_price, 0),
    last_buying_price = COALESCE(last_buying_price, 0),
    min_stock_level = 10
WHERE current_quantity IS NULL;

-- Reset modes
SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;

COMMIT;



-- Insert main permission modules and permissions
INSERT INTO `permissions` (`id`, `name`, `slug`, `description`, `module`, `status`, `created_at`, `updated_at`) VALUES

-- ==================== DASHBOARD MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Dashboard', 'dashboard.view', 'Access main dashboard', 'dashboard', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Analytics', 'dashboard.analytics', 'View detailed analytics and charts', 'dashboard', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Export Reports', 'dashboard.export', 'Export dashboard reports', 'dashboard', 'active', NOW(), NOW()),

-- ==================== SHOP MANAGEMENT MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Shops', 'shops.view', 'View shop list and details', 'shops', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Shop', 'shops.create', 'Create new shops/companies', 'shops', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Shop', 'shops.edit', 'Edit shop information', 'shops', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Shop', 'shops.delete', 'Delete shops', 'shops', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Shop Settings', 'shops.settings', 'Configure shop settings', 'shops', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Suspend Shop', 'shops.suspend', 'Suspend/activate shops', 'shops', 'active', NOW(), NOW()),

-- ==================== USER MANAGEMENT MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Users', 'users.view', 'View user list', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create User', 'users.create', 'Create new users', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit User', 'users.edit', 'Edit user information', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete User', 'users.delete', 'Delete users', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage User Roles', 'users.roles', 'Assign roles to users', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View User Salary', 'users.salary.view', 'View user salary details', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage User Salary', 'users.salary.manage', 'Manage user salaries', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View User Loans', 'users.loans.view', 'View user loans', 'users', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage User Loans', 'users.loans.manage', 'Manage user loans', 'users', 'active', NOW(), NOW()),

-- ==================== ROLE & PERMISSION MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Roles', 'roles.view', 'View role list', 'roles', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Role', 'roles.create', 'Create new roles', 'roles', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Role', 'roles.edit', 'Edit role information', 'roles', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Role', 'roles.delete', 'Delete roles', 'roles', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Permissions', 'permissions.manage', 'Assign permissions to roles', 'roles', 'active', NOW(), NOW()),

-- ==================== CUSTOMER MANAGEMENT MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Customers', 'customers.view', 'View customer list', 'customers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Customer', 'customers.create', 'Add new customers', 'customers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Customer', 'customers.edit', 'Edit customer details', 'customers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Customer', 'customers.delete', 'Delete customers', 'customers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Customer Ledger', 'customers.ledger', 'View customer transaction history', 'customers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Customer Credit', 'customers.credit', 'Manage customer credit limits', 'customers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Export Customers', 'customers.export', 'Export customer data', 'customers', 'active', NOW(), NOW()),

-- ==================== SUPPLIER MANAGEMENT MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Suppliers', 'suppliers.view', 'View supplier list', 'suppliers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Supplier', 'suppliers.create', 'Add new suppliers', 'suppliers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Supplier', 'suppliers.edit', 'Edit supplier details', 'suppliers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Supplier', 'suppliers.delete', 'Delete suppliers', 'suppliers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Supplier Balance', 'suppliers.balance', 'View supplier balances', 'suppliers', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Supplier Payments', 'suppliers.payments', 'Process supplier payments', 'suppliers', 'active', NOW(), NOW()),

-- ==================== PRODUCT MANAGEMENT MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Products', 'products.view', 'View product list', 'products', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Product', 'products.create', 'Add new products', 'products', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Product', 'products.edit', 'Edit product details', 'products', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Product', 'products.delete', 'Delete products', 'products', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Categories', 'products.categories', 'Manage product categories', 'products', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Import Products', 'products.import', 'Import products from file', 'products', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Export Products', 'products.export', 'Export product data', 'products', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Barcodes', 'products.barcodes', 'Generate and manage barcodes', 'products', 'active', NOW(), NOW()),

-- ==================== RAW MATERIALS MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Raw Materials', 'raw_materials.view', 'View raw materials list', 'raw_materials', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Raw Material', 'raw_materials.create', 'Add raw materials', 'raw_materials', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Raw Material', 'raw_materials.edit', 'Edit raw materials', 'raw_materials', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Raw Material', 'raw_materials.delete', 'Delete raw materials', 'raw_materials', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Stock Movements', 'raw_materials.stock', 'Record stock movements', 'raw_materials', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Stock History', 'raw_materials.history', 'View stock movement history', 'raw_materials', 'active', NOW(), NOW()),

-- ==================== INGREDIENTS/RECIPES MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Ingredients', 'ingredients.view', 'View ingredient recipes', 'ingredients', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Recipe', 'ingredients.create', 'Create product recipes', 'ingredients', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Recipe', 'ingredients.edit', 'Edit recipes', 'ingredients', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Recipe', 'ingredients.delete', 'Delete recipes', 'ingredients', 'active', NOW(), NOW()),

-- ==================== INVENTORY MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Inventory', 'inventory.view', 'View inventory levels', 'inventory', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Adjust Inventory', 'inventory.adjust', 'Make inventory adjustments', 'inventory', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Stock Alerts', 'inventory.alerts', 'View low stock alerts', 'inventory', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Stock In', 'inventory.stock_in', 'Record stock purchases', 'inventory', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Transfer Stock', 'inventory.transfer', 'Transfer between locations', 'inventory', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Stock Value', 'inventory.value', 'View inventory valuation', 'inventory', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Batches', 'inventory.batches', 'Manage batch numbers', 'inventory', 'active', NOW(), NOW()),

-- ==================== SALES/BILLING MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'Create Bill', 'bills.create', 'Create new bills', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Bills', 'bills.view', 'View bill list', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Bill', 'bills.edit', 'Edit existing bills', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Bill', 'bills.delete', 'Delete bills', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Void Bill', 'bills.void', 'Void transactions', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Process Returns', 'bills.returns', 'Process product returns', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Sales Reports', 'bills.reports', 'View sales reports', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Apply Discounts', 'bills.discounts', 'Apply discounts to bills', 'billing', 'active', NOW(), NOW()),

-- ==================== EXPENSES MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Expenses', 'expenses.view', 'View expense list', 'expenses', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Expense', 'expenses.create', 'Add new expenses', 'expenses', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Edit Expense', 'expenses.edit', 'Edit expenses', 'expenses', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Expense', 'expenses.delete', 'Delete expenses', 'expenses', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Categories', 'expenses.categories', 'Manage expense categories', 'expenses', 'active', NOW(), NOW()),

-- ==================== CASH MANAGEMENT MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Cash Submissions', 'cash.view', 'View cash submissions', 'cash', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Submit Cash', 'cash.submit', 'Submit daily cash', 'cash', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Verify Cash', 'cash.verify', 'Verify cash submissions', 'cash', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Cash Reports', 'cash.reports', 'View cash reports', 'cash', 'active', NOW(), NOW()),

-- ==================== REPORTS & ANALYTICS MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Sales Reports', 'reports.sales', 'Access sales reports', 'reports', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Purchase Reports', 'reports.purchases', 'Access purchase reports', 'reports', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Profit Reports', 'reports.profit', 'View profit/loss reports', 'reports', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Inventory Reports', 'reports.inventory', 'Inventory reports', 'reports', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Customer Reports', 'reports.customers', 'Customer reports', 'reports', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Tax Reports', 'reports.tax', 'Tax reports', 'reports', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Generate Custom Reports', 'reports.custom', 'Create custom reports', 'reports', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Export Reports', 'reports.export', 'Export reports to PDF/Excel', 'reports', 'active', NOW(), NOW()),

-- ==================== SUBSCRIPTION & BILLING MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Subscriptions', 'subscriptions.view', 'View shop subscriptions', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Subscriptions', 'subscriptions.manage', 'Manage subscriptions', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Plans', 'plans.view', 'View pricing plans', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Plans', 'plans.manage', 'Create/edit pricing plans', 'billing', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View Invoices', 'invoices.view', 'View billing invoices', 'billing', 'active', NOW(), NOW()),

-- ==================== BACKUP & SYSTEM MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Backups', 'backups.view', 'View backup list', 'system', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Create Backup', 'backups.create', 'Create system backups', 'system', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Restore Backup', 'backups.restore', 'Restore from backups', 'system', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Delete Backup', 'backups.delete', 'Delete backups', 'system', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'View System Logs', 'system.logs', 'View system activity logs', 'system', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Settings', 'system.settings', 'Configure system settings', 'system', 'active', NOW(), NOW()),

-- ==================== FEEDBACK & SUPPORT MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Feedback', 'feedback.view', 'View customer feedback', 'support', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Respond to Feedback', 'feedback.respond', 'Reply to feedback', 'support', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Manage Tickets', 'support.tickets', 'Manage support tickets', 'support', 'active', NOW(), NOW()),

-- ==================== ADMIN ACTIONS MODULE ====================
((SELECT UUID_TO_BIN(UUID())), 'View Admin Actions', 'admin_actions.view', 'View admin action logs', 'admin', 'active', NOW(), NOW()),
((SELECT UUID_TO_BIN(UUID())), 'Perform Admin Actions', 'admin_actions.perform', 'Execute admin actions', 'admin', 'active', NOW(), NOW());
















-- Insert main roles for SaaS system
INSERT INTO `roles` (`id`, `role_name`, `description`, `status`, `created_at`, `updated_at`) VALUES

-- Super Admin (System-wide access)
((SELECT UUID_TO_BIN(UUID())), 'Super Admin', 
 'Full system access across all shops. Can manage everything including other shops, users, and system settings. Has complete control over all modules and features.',
 'active', NOW(), NOW()),

-- Admin (System Administrator)
((SELECT UUID_TO_BIN(UUID())), 'Admin', 
 'System administrator with full access to all features but limited system-level configurations. Can manage users, shops, and all modules.',
 'active', NOW(), NOW()),

-- Shop Owner (Business Owner)
((SELECT UUID_TO_BIN(UUID())), 'Shop Owner', 
 'Owns the business. Full access to their shop including financials, settings, employees, and all modules. Can view all reports and manage subscriptions.',
 'active', NOW(), NOW()),

-- Shop Manager
((SELECT UUID_TO_BIN(UUID())), 'Shop Manager', 
 'Manages daily operations. Can handle users, inventory, suppliers, customers, and view most reports. Cannot access financial settings or delete critical data.',
 'active', NOW(), NOW()),

-- Accountant
((SELECT UUID_TO_BIN(UUID())), 'Accountant', 
 'Manages financial aspects including expenses, salaries, loans, taxes, and financial reports. Can view but not edit product/inventory details.',
 'active', NOW(), NOW()),

-- Cashier
((SELECT UUID_TO_BIN(UUID())), 'Cashier', 
 'Handles daily sales, creates bills, processes payments, and submits cash. Can view products and customers but cannot edit prices or delete records.',
 'active', NOW(), NOW()),

-- Inventory Manager
((SELECT UUID_TO_BIN(UUID())), 'Inventory Manager', 
 'Manages products, raw materials, stock levels, and inventory movements. Can create purchase orders and manage stock but cannot access financial data.',
 'active', NOW(), NOW()),

-- Sales Representative
((SELECT UUID_TO_BIN(UUID())), 'Sales Representative', 
 'Handles customer interactions, creates sales, manages customer relationships. Can create discounts within limits and view customer history.',
 'active', NOW(), NOW()),

-- Procurement Officer
((SELECT UUID_TO_BIN(UUID())), 'Procurement Officer', 
 'Manages supplier relationships, creates purchase orders, handles stock receiving. Can view inventory levels and create supplier transactions.',
 'active', NOW(), NOW()),

-- HR Manager
((SELECT UUID_TO_BIN(UUID())), 'HR Manager', 
 'Manages employee records, salaries, loans, and attendance. Can view but not edit financial reports.',
 'active', NOW(), NOW()),

-- Warehouse Staff
((SELECT UUID_TO_BIN(UUID())), 'Warehouse Staff', 
 'Manages physical inventory, stock movements, and order picking. Can update stock quantities but cannot edit product details or prices.',
 'active', NOW(), NOW()),

-- Viewer (Read-only access)
((SELECT UUID_TO_BIN(UUID())), 'Viewer', 
 'Can view reports, products, customers, and inventory but cannot make any changes or modifications. Ideal for auditors and guests.',
 'active', NOW(), NOW()),

-- Support Staff
((SELECT UUID_TO_BIN(UUID())), 'Support Staff', 
 'Handles customer feedback, support tickets, and basic assistance. Can view customer information and respond to queries.',
 'active', NOW(), NOW()),

-- Temporary Staff
((SELECT UUID_TO_BIN(UUID())), 'Temporary Staff', 
 'Limited access for seasonal or temporary employees. Can only create bills and view basic product information.',
 'active', NOW(), NOW()),

-- Developer
((SELECT UUID_TO_BIN(UUID())), 'Developer', 
 'API access and system integration permissions. Can view system logs and technical settings but cannot modify financial data.',
 'active', NOW(), NOW()),

-- Auditor
((SELECT UUID_TO_BIN(UUID())), 'Auditor', 
 'Can view all data for audit purposes but cannot modify anything. Has read-only access to all modules including financials.',
 'active', NOW(), NOW()),

-- Marketing Manager
((SELECT UUID_TO_BIN(UUID())), 'Marketing Manager', 
 'Manages promotions, customer communications, and marketing campaigns. Can view customer data and sales reports.',
 'active', NOW(), NOW()),

-- Production Manager (for manufacturing/restaurant)
((SELECT UUID_TO_BIN(UUID())), 'Production Manager', 
 'Manages recipes, ingredients, and production planning. Can view raw materials and create production orders.',
 'active', NOW(), NOW()),

-- Delivery Boy
((SELECT UUID_TO_BIN(UUID())), 'Delivery Boy', 
 'Handles order delivery. Can view assigned orders, update delivery status, and collect payments.',
 'active', NOW(), NOW()),

-- Franchise Owner
((SELECT UUID_TO_BIN(UUID())), 'Franchise Owner', 
 'Owns a franchise location. Has access similar to Shop Owner but limited to their specific franchise.',
 'active', NOW(), NOW()),

-- Regional Manager
((SELECT UUID_TO_BIN(UUID())), 'Regional Manager', 
 'Manages multiple shops in a region. Can view reports across shops but cannot modify individual shop settings.',
 'active', NOW(), NOW()),

-- Quality Control
((SELECT UUID_TO_BIN(UUID())), 'Quality Control', 
 'Inspects products and raw materials. Can record quality checks and flag issues but cannot modify inventory.',
 'active', NOW(), NOW()),

-- Customer Service Representative
((SELECT UUID_TO_BIN(UUID())), 'Customer Service', 
 'Handles customer inquiries and complaints. Can view customer history and process returns/exchanges.',
 'active', NOW(), NOW()),

-- Data Entry Operator
((SELECT UUID_TO_BIN(UUID())), 'Data Entry Operator', 
 'Enters product data, customer information, and supplier details. Can create but not delete records.',
 'active', NOW(), NOW()),

-- Store Keeper
((SELECT UUID_TO_BIN(UUID())), 'Store Keeper', 
 'Manages store room and issues materials. Can record stock issues and receive materials.',
 'active', NOW(), NOW());






















 -- Insert sample pricing plans
INSERT INTO `pricing_plans` (`id`, `name`, `description`, `monthly_price`, `quarterly_price`, `yearly_price`, `features`, `status`, `created_at`) VALUES

-- ==================== FREE / TRIAL PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Free Trial', 'Try our system free for 14 days with basic features. No credit card required.', 
 0.00, 0.00, 0.00, 
 JSON_OBJECT(
    'max_products', 100,
    'max_users', 1,
    'max_customers', 50,
    'max_shops', 1,
    'max_invoices', 50,
    'storage_days', 30,
    'inventory_basic', true,
    'reports_basic', true,
    'support', 'email',
    'backup_days', 7,
    'features_list', JSON_ARRAY(
        'Up to 100 Products',
        '1 User Account',
        '50 Customers',
        'Basic Inventory',
        'Basic Reports',
        'Email Support',
        '7 Days Backup',
        'Single Store',
        'Manual Data Entry'
    ),
    'limitations', JSON_ARRAY(
        'No API Access',
        'No Advanced Reports',
        'No Multi-store',
        'No Custom Branding',
        'No Automated Backups'
    ),
    'trial_days', 14
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Forever Free', 'Basic plan for micro businesses just starting out.', 
 0.00, 0.00, 0.00,
 JSON_OBJECT(
    'max_products', 50,
    'max_users', 1,
    'max_customers', 25,
    'max_shops', 1,
    'max_invoices', 25,
    'storage_days', 15,
    'inventory_basic', true,
    'reports_basic', true,
    'support', 'community',
    'backup_days', 3,
    'features_list', JSON_ARRAY(
        'Up to 50 Products',
        '1 User',
        '25 Customers',
        'Basic Sales Tracking',
        'Community Support',
        '3 Days Backup'
    ),
    'limitations', JSON_ARRAY(
        'Limited Features',
        'No API',
        'No Advanced Features',
        'Watermarked Invoices'
    )
 ), 'active', NOW()),

-- ==================== STARTER PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Starter', 'Perfect for small businesses just getting started with basic POS needs.', 
 29.99, 79.99, 299.99,
 JSON_OBJECT(
    'max_products', 1000,
    'max_users', 2,
    'max_customers', 500,
    'max_shops', 1,
    'max_invoices', 500,
    'storage_days', 90,
    'inventory_basic', true,
    'inventory_advanced', false,
    'reports_basic', true,
    'reports_advanced', false,
    'support', 'email',
    'support_hours', '9-5',
    'backup_days', 30,
    'backup_automated', false,
    'api_access', false,
    'multi_store', false,
    'invoice_customization', 'basic',
    'features_list', JSON_ARRAY(
        '1,000 Products',
        '2 User Accounts',
        '500 Customers',
        'Basic Inventory Management',
        'Sales & Purchase Records',
        'Basic Reports',
        'Email Support (24h response)',
        'Manual Backup',
        '30 Days Data Retention',
        'Basic Invoice Templates',
        'Single Store Location',
        'Barcode Scanning',
        'Customer Management'
    ),
    'modules', JSON_ARRAY(
        'dashboard',
        'products',
        'customers',
        'inventory_basic',
        'billing',
        'reports_basic'
    ),
    'discounts', JSON_OBJECT(
        'quarterly_saving', '10%',
        'yearly_saving', '17%'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Starter Plus', 'Enhanced starter plan with more products and users.', 
 49.99, 134.99, 499.99,
 JSON_OBJECT(
    'max_products', 2500,
    'max_users', 3,
    'max_customers', 1000,
    'max_shops', 1,
    'max_invoices', 1000,
    'storage_days', 120,
    'inventory_basic', true,
    'inventory_advanced', true,
    'reports_basic', true,
    'reports_advanced', false,
    'support', 'priority_email',
    'support_hours', '24/7',
    'backup_days', 45,
    'backup_automated', true,
    'api_access', false,
    'multi_store', false,
    'invoice_customization', 'advanced',
    'features_list', JSON_ARRAY(
        '2,500 Products',
        '3 User Accounts',
        '1,000 Customers',
        'Advanced Inventory',
        'Basic Reports',
        'Priority Email Support',
        'Automated Daily Backups',
        '45 Days Data Retention',
        'Advanced Invoice Templates',
        'Supplier Management',
        'Purchase Orders',
        'Stock Alerts'
    )
 ), 'active', NOW()),

-- ==================== PROFESSIONAL PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Professional', 'Advanced features for growing businesses with multiple users.', 
 69.99, 189.99, 699.99,
 JSON_OBJECT(
    'max_products', 10000,
    'max_users', 10,
    'max_customers', 5000,
    'max_shops', 2,
    'max_invoices', 5000,
    'storage_days', 180,
    'inventory_basic', true,
    'inventory_advanced', true,
    'reports_basic', true,
    'reports_advanced', true,
    'support', 'priority',
    'support_hours', '24/7',
    'backup_days', 90,
    'backup_automated', true,
    'api_access', true,
    'api_calls', 10000,
    'multi_store', true,
    'multi_store_count', 2,
    'invoice_customization', 'advanced',
    'white_label', false,
    'features_list', JSON_ARRAY(
        '10,000 Products',
        '10 User Accounts',
        '5,000 Customers',
        'Advanced Inventory Management',
        'Multi-store Support (2 stores)',
        'Advanced Reports & Analytics',
        'Priority Support (4h response)',
        'Automated Daily Backups',
        '90 Days Data Retention',
        'API Access (10k calls/month)',
        'Customer Management',
        'Supplier Management',
        'Barcode Generation',
        'Batch Tracking',
        'Expiry Management',
        'Discount Rules',
        'Loyalty Program',
        'Email Invoices'
    ),
    'modules', JSON_ARRAY(
        'dashboard',
        'products',
        'customers',
        'suppliers',
        'inventory_advanced',
        'billing',
        'reports_advanced',
        'api',
        'multi_store'
    ),
    'discounts', JSON_OBJECT(
        'quarterly_saving', '10%',
        'yearly_saving', '17%'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Professional Plus', 'Enhanced professional features with more capacity.', 
 99.99, 269.99, 999.99,
 JSON_OBJECT(
    'max_products', 25000,
    'max_users', 15,
    'max_customers', 10000,
    'max_shops', 3,
    'max_invoices', 10000,
    'storage_days', 240,
    'inventory_basic', true,
    'inventory_advanced', true,
    'inventory_premium', true,
    'reports_basic', true,
    'reports_advanced', true,
    'support', 'priority',
    'support_hours', '24/7',
    'backup_days', 120,
    'backup_automated', true,
    'api_access', true,
    'api_calls', 25000,
    'multi_store', true,
    'multi_store_count', 3,
    'invoice_customization', 'premium',
    'white_label', false,
    'features_list', JSON_ARRAY(
        '25,000 Products',
        '15 User Accounts',
        '10,000 Customers',
        'Premium Inventory',
        '3 Store Locations',
        'Advanced Analytics',
        'Priority Support',
        '120 Days Backup',
        '25k API Calls',
        'Raw Materials',
        'Recipe Management',
        'Production Tracking',
        'Employee Management'
    )
 ), 'active', NOW()),

-- ==================== BUSINESS PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Business', 'Complete solution for established businesses with advanced needs.', 
 149.99, 399.99, 1499.99,
 JSON_OBJECT(
    'max_products', 50000,
    'max_users', 25,
    'max_customers', 25000,
    'max_shops', 5,
    'max_invoices', 25000,
    'storage_days', 365,
    'inventory_basic', true,
    'inventory_advanced', true,
    'inventory_premium', true,
    'reports_basic', true,
    'reports_advanced', true,
    'reports_premium', true,
    'support', 'dedicated',
    'support_hours', '24/7',
    'support_channel', 'phone+chat+email',
    'backup_days', 365,
    'backup_automated', true,
    'backup_frequency', 'daily',
    'api_access', true,
    'api_calls', 100000,
    'multi_store', true,
    'multi_store_count', 5,
    'invoice_customization', 'premium',
    'white_label', true,
    'custom_branding', true,
    'features_list', JSON_ARRAY(
        '50,000 Products',
        '25 User Accounts',
        '25,000 Customers',
        'Premium Inventory Management',
        'Multi-store Support (5 stores)',
        'Advanced Analytics & Forecasting',
        'Dedicated Account Manager',
        'Custom Branding & Themes',
        'Employee Management',
        'Payroll Integration',
        'Advanced Security Features',
        'Custom Reports',
        '24/7 Phone Support',
        'Daily Automated Backups',
        '365 Days Data Retention',
        '100k API Calls/month',
        'White Label Solution',
        'HR Management',
        'Loan Management',
        'Salary Management',
        'Cash Flow Forecasting'
    ),
    'modules', JSON_ARRAY(
        'dashboard',
        'products',
        'customers',
        'suppliers',
        'inventory_premium',
        'billing',
        'reports_premium',
        'api',
        'multi_store',
        'hr',
        'payroll',
        'loans',
        'expenses'
    ),
    'discounts', JSON_OBJECT(
        'quarterly_saving', '11%',
        'yearly_saving', '17%'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Business Plus', 'Enhanced business features for larger operations.', 
 199.99, 539.99, 1999.99,
 JSON_OBJECT(
    'max_products', 100000,
    'max_users', 40,
    'max_customers', 50000,
    'max_shops', 8,
    'max_invoices', 50000,
    'storage_days', 545,
    'inventory_premium', true,
    'reports_premium', true,
    'support', 'dedicated',
    'backup_days', 545,
    'api_calls', 250000,
    'multi_store_count', 8,
    'features_list', JSON_ARRAY(
        '100,000 Products',
        '40 Users',
        '50,000 Customers',
        '8 Store Locations',
        'Advanced HR Suite',
        'Multi-currency',
        'Advanced Security',
        '545 Days Backup'
    )
 ), 'active', NOW()),

-- ==================== ENTERPRISE PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Enterprise', 'Maximum features for large enterprises with custom requirements.', 
 299.99, 799.99, 2999.99,
 JSON_OBJECT(
    'max_products', 'unlimited',
    'max_users', 'unlimited',
    'max_customers', 'unlimited',
    'max_shops', 'unlimited',
    'max_invoices', 'unlimited',
    'storage_days', 730,
    'inventory_enterprise', true,
    'reports_enterprise', true,
    'support', 'enterprise',
    'support_hours', '24/7',
    'support_channel', 'dedicated+phone+chat+email',
    'backup_days', 730,
    'backup_automated', true,
    'backup_frequency', 'hourly',
    'backup_type', 'incremental+full',
    'api_access', true,
    'api_calls', 'unlimited',
    'multi_store', true,
    'multi_store_count', 'unlimited',
    'invoice_customization', 'full',
    'white_label', true,
    'custom_branding', true,
    'custom_domain', true,
    'ssl_certificate', true,
    'sla', '99.95',
    'features_list', JSON_ARRAY(
        'Unlimited Products',
        'Unlimited Users',
        'Unlimited Customers',
        'Unlimited Stores',
        'Enterprise Inventory Management',
        'AI-Powered Analytics',
        'Custom Development Options',
        'White Label Solution',
        'Advanced CRM',
        'HR & Payroll Suite',
        'Multi-currency Support',
        'Multiple Languages',
        'SLA Agreement (99.95%)',
        'On-premise Option Available',
        'Real-time Sync',
        'Custom Integrations',
        'Training & Onboarding',
        'Dedicated Server Option',
        'Hourly Backups',
        '2 Years Data Retention',
        'Custom Reports',
        'Advanced Security Audit',
        'Compliance Reports',
        'API Unlimited Access',
        'Custom Domain',
        'SSL Certificate Included'
    ),
    'modules', JSON_ARRAY(
        'all_modules',
        'custom_development',
        'dedicated_server',
        'compliance',
        'advanced_security'
    ),
    'discounts', JSON_OBJECT(
        'quarterly_saving', '11%',
        'yearly_saving', '17%',
        'custom_terms', 'available'
    ),
    'custom_options', JSON_OBJECT(
        'on_premise', true,
        'dedicated_server', true,
        'custom_development', true,
        'training_days', 5
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Enterprise Plus', 'Ultimate enterprise solution with maximum features.', 
 499.99, 1349.99, 4999.99,
 JSON_OBJECT(
    'max_products', 'unlimited',
    'max_users', 'unlimited',
    'max_customers', 'unlimited',
    'max_shops', 'unlimited',
    'storage_days', 1095,
    'support', 'dedicated+on_site',
    'backup_days', 1095,
    'sla', '99.99',
    'features_list', JSON_ARRAY(
        'Everything in Enterprise',
        'On-site Support',
        '3 Years Data Retention',
        '99.99% SLA',
        'Disaster Recovery',
        'Load Balancing',
        'Geo-redundancy',
        'Priority Development'
    )
 ), 'active', NOW()),

-- ==================== SPECIALIZED PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Retail Pro', 'Specialized for retail stores with advanced inventory needs.', 
 89.99, 239.99, 899.99,
 JSON_OBJECT(
    'max_products', 20000,
    'max_users', 15,
    'max_customers', 10000,
    'max_shops', 3,
    'inventory_retail', true,
    'reports_retail', true,
    'support', 'priority',
    'backup_days', 180,
    'multi_store', true,
    'multi_store_count', 3,
    'pos_offline', true,
    'features_list', JSON_ARRAY(
        '20,000 Products',
        '15 Users',
        '10,000 Customers',
        'Retail-specific Features',
        'Offline POS Mode',
        'Loyalty Program',
        'Gift Card Management',
        'Discount Rules Engine',
        'Purchase Orders',
        'Transfer Management',
        'Barcode Generation',
        'Print Labels',
        '3 Store Locations',
        '180 Days Backup',
        'Inventory Alerts',
        'Sales Analytics',
        'Customer History',
        'Returns Management'
    ),
    'retail_specific', JSON_OBJECT(
        'loyalty_program', true,
        'gift_cards', true,
        'offline_mode', true,
        'barcode_scanner', true,
        'receipt_printer', true,
        'cash_drawer', true,
        'customer_display', true
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Restaurant POS', 'Complete restaurant management system with kitchen display.', 
 79.99, 209.99, 799.99,
 JSON_OBJECT(
    'max_products', 5000,
    'max_users', 12,
    'max_customers', 5000,
    'max_shops', 2,
    'inventory_restaurant', true,
    'reports_restaurant', true,
    'support', 'priority',
    'backup_days', 180,
    'table_management', true,
    'kitchen_display', true,
    'recipe_management', true,
    'menu_engineering', true,
    'online_ordering', true,
    'delivery_integration', true,
    'features_list', JSON_ARRAY(
        '5,000 Menu Items',
        '12 User Accounts',
        '5,000 Customers',
        'Table Management',
        'Kitchen Display System',
        'Recipe Costing',
        'Menu Engineering',
        'Split Bills',
        'Online Ordering',
        'Delivery Integration',
        'Takeaway Management',
        'Reservation System',
        'Waitlist Management',
        'Inventory Tracking',
        'Waste Tracking',
        'Staff Management',
        'Shift Management',
        'Tips Management',
        'Multiple Payment Methods',
        'QR Code Ordering'
    ),
    'restaurant_specific', JSON_OBJECT(
        'table_management', true,
        'kitchen_display', true,
        'recipe_management', true,
        'online_ordering', true,
        'delivery_integration', true,
        'reservations', true,
        'waitlist', true,
        'tips_management', true
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Restaurant Plus', 'Advanced restaurant management with multiple outlets.', 
 129.99, 349.99, 1299.99,
 JSON_OBJECT(
    'max_products', 10000,
    'max_users', 20,
    'max_customers', 10000,
    'max_shops', 4,
    'features_list', JSON_ARRAY(
        '10,000 Menu Items',
        '20 Users',
        'Multiple Outlets',
        'Central Kitchen',
        'Inventory Forecasting',
        'Supplier Portal',
        'Advanced Analytics'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Wholesale Pro', 'Built for distributors and wholesale businesses.', 
 129.99, 349.99, 1299.99,
 JSON_OBJECT(
    'max_products', 50000,
    'max_users', 20,
    'max_customers', 20000,
    'max_shops', 4,
    'max_warehouses', 4,
    'inventory_wholesale', true,
    'reports_wholesale', true,
    'support', 'dedicated',
    'backup_days', 365,
    'multi_store', true,
    'multi_store_count', 4,
    'bulk_pricing', true,
    'tiered_discounts', true,
    'b2b_portal', true,
    'features_list', JSON_ARRAY(
        '50,000 Products',
        '20 User Accounts',
        '20,000 Customers',
        'Bulk Pricing Rules',
        'Tiered Discounts',
        'Minimum Order Quantity',
        'Multi-warehouse Support',
        'Fleet Management',
        'Delivery Scheduling',
        'Advanced Supplier Portal',
        'B2B Customer Portal',
        'Volume Discounts',
        'Contract Pricing',
        'Credit Limit Management',
        'Invoice Financing',
        '4 Warehouse Locations',
        '365 Days Backup',
        'Purchase Order Management',
        'Backorder Management'
    ),
    'wholesale_specific', JSON_OBJECT(
        'bulk_pricing', true,
        'tiered_discounts', true,
        'minimum_order', true,
        'b2b_portal', true,
        'credit_limits', true,
        'delivery_scheduling', true,
        'fleet_management', true,
        'warehouse_management', true
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'E-commerce Bundle', 'Integrated POS and online store solution.', 
 149.99, 399.99, 1499.99,
 JSON_OBJECT(
    'max_products', 25000,
    'max_users', 15,
    'max_customers', 15000,
    'ecommerce_integration', true,
    'website_builder', true,
    'inventory_sync', true,
    'features_list', JSON_ARRAY(
        'POS + Online Store',
        'Inventory Sync',
        'Website Builder',
        'Payment Gateway',
        'Shipping Integration',
        'SEO Tools',
        'Analytics Dashboard'
    )
 ), 'active', NOW()),

-- ==================== ADD-ON PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Multi-store Add-on', 'Add additional store locations to your existing plan.', 
 29.99, 79.99, 299.99,
 JSON_OBJECT(
    'type', 'addon',
    'base_plan', 'any',
    'max_additional_stores', 5,
    'per_store_price', 29.99,
    'features_list', JSON_ARRAY(
        'Additional Store Location',
        'Centralized Management',
        'Inventory Transfer',
        'Store-specific Reports',
        'Separate User Roles per Store'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'API Access Add-on', 'Enable API access for integrations.', 
 19.99, 49.99, 199.99,
 JSON_OBJECT(
    'type', 'addon',
    'base_plan', 'starter_plus_professional',
    'api_calls', 5000,
    'rate_limit', 60,
    'features_list', JSON_ARRAY(
        'RESTful API Access',
        '5,000 API Calls/month',
        'Documentation Access',
        'Webhook Support',
        'API Key Management'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Advanced Analytics Add-on', 'Get deeper insights with advanced analytics.', 
 24.99, 64.99, 249.99,
 JSON_OBJECT(
    'type', 'addon',
    'features_list', JSON_ARRAY(
        'Predictive Analytics',
        'Sales Forecasting',
        'Customer Segmentation',
        'Inventory Optimization',
        'Custom Dashboards'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'HR & Payroll Add-on', 'Complete employee management suite.', 
 39.99, 99.99, 399.99,
 JSON_OBJECT(
    'type', 'addon',
    'features_list', JSON_ARRAY(
        'Employee Database',
        'Attendance Tracking',
        'Leave Management',
        'Payroll Processing',
        'Salary Slips',
        'Loan Management',
        'Performance Reviews'
    )
 ), 'active', NOW()),

-- ==================== DEMO/LEGACY PLANS ====================
((SELECT UUID_TO_BIN(UUID())), 'Demo Plan', 'Free trial plan for testing the system with full features temporarily.', 
 0.00, 0.00, 0.00,
 JSON_OBJECT(
    'max_products', 500,
    'max_users', 3,
    'max_customers', 200,
    'max_shops', 1,
    'inventory_basic', true,
    'reports_basic', true,
    'support', 'community',
    'backup_days', 7,
    'trial_days', 30,
    'features_list', JSON_ARRAY(
        'Full Features for 30 Days',
        '500 Products',
        '3 Users',
        '200 Customers',
        'All Basic Features',
        'Community Support',
        '7 Days Backup'
    ),
    'limitations', JSON_ARRAY(
        '30 Days Only',
        'No Commercial Use',
        'Demo Data Included'
    )
 ), 'active', NOW()),

((SELECT UUID_TO_BIN(UUID())), 'Legacy Basic', 'Older plan (no longer available for new customers, only for existing users).', 
 19.99, 49.99, 179.99,
 JSON_OBJECT(
    'max_products', 500,
    'max_users', 1,
    'max_customers', 200,
    'max_shops', 1,
    'inventory_basic', true,
    'reports_basic', true,
    'support', 'email',
    'backup_days', 15,
    'features_list', JSON_ARRAY(
        '500 Products',
        '1 User',
        '200 Customers',
        'Basic Features',
        'Email Support',
        'Manual Backup',
        '15 Days Retention'
    ),
    'grandfathered', true,
    'new_signups', false
 ), 'inactive', NOW() - INTERVAL 30 DAY),

((SELECT UUID_TO_BIN(UUID())), 'Legacy Professional', 'Legacy professional plan for grandfathered users.', 
 49.99, 134.99, 499.99,
 JSON_OBJECT(
    'max_products', 5000,
    'max_users', 5,
    'max_customers', 2000,
    'grandfathered', true,
    'new_signups', false
 ), 'inactive', NOW() - INTERVAL 60 DAY);