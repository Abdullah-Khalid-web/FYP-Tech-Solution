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
CREATE TABLE customers (
    id BINARY(16) PRIMARY KEY ,
    shop_id BINARY(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) DEFAULT NULL,
    email VARCHAR(255) DEFAULT NULL,
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    UNIQUE KEY unique_phone_per_shop (shop_id, phone),
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_phone (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Table structure for table `user_loan`
CREATE TABLE user_loan (
    id BINARY(16) PRIMARY KEY ,
    shop_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    transaction_type ENUM('loan_given','loan_repayment') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    balance DECIMAL(12,2) DEFAULT 0,
    description TEXT,
    recorded_by BINARY(16) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_shop_id (`shop_id`),
    INDEX idx_user_id (`user_id`),
    INDEX idx_recorded_by (`recorded_by`),
    INDEX idx_transaction_type (`transaction_type`),
    INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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

-- Reset modes
SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;

COMMIT;