// ==========================================
// DashDrop - SQLite Database Configuration
// Using Node.js native SQLite driver (node:sqlite)
// ==========================================

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(__dirname, 'dashdrop.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode for better concurrency
db.exec('PRAGMA foreign_keys = ON;');

// Helper: Hash password with SHA-256 + salt
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return checkHash === hash;
}

// Initialize Tables
function initDatabase() {
    // 1. Users Table (Authentication & RBAC)
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            college TEXT DEFAULT 'Engineering Campus',
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'student', -- 'student' or 'admin'
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 2. Items Table (Buy & Sell) with owner_id and optional image/file URL
    db.exec(`
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            price REAL NOT NULL,
            condition TEXT NOT NULL,
            description TEXT,
            contact TEXT NOT NULL,
            icon TEXT DEFAULT '📦',
            file_url TEXT,
            status TEXT DEFAULT 'available', -- 'available', 'sold'
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 3. Rentals Table with renter_id
    db.exec(`
        CREATE TABLE IF NOT EXISTS rentals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            renter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            item_name TEXT NOT NULL,
            category TEXT NOT NULL,
            daily_price REAL NOT NULL,
            days INTEGER NOT NULL,
            total_price REAL NOT NULL,
            student_name TEXT DEFAULT 'Student',
            status TEXT DEFAULT 'active',
            rented_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 4. Purchases / Bought Products Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
            item_name TEXT NOT NULL,
            category TEXT NOT NULL,
            price REAL NOT NULL,
            seller_name TEXT,
            seller_contact TEXT,
            icon TEXT DEFAULT '📦',
            purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 5. Wishlist / Saved Items Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS wishlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, item_id)
        );
    `);

    // 6. Activity Logs (Audit Trail for Admins)
    db.exec(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Migration helper: If items table previously lacked owner_id or file_url, alter table safely
    try {
        db.exec(`ALTER TABLE items ADD COLUMN owner_id INTEGER;`);
    } catch (_) { /* Column already exists */ }
    try {
        db.exec(`ALTER TABLE items ADD COLUMN file_url TEXT;`);
    } catch (_) { /* Column already exists */ }
    try {
        db.exec(`ALTER TABLE rentals ADD COLUMN renter_id INTEGER;`);
    } catch (_) { /* Column already exists */ }

    // Seed Default Users (Admin & Student)
    const userCountStmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const userCount = userCountStmt.get().count;

    if (userCount === 0) {
        const insertUser = db.prepare(`
            INSERT INTO users (name, email, phone, college, salt, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        // Seed 1: Admin
        const adminCreds = hashPassword('Admin@123');
        insertUser.run(
            'Campus Administrator',
            'admin@campus.edu',
            '+91 99999 11111',
            'Main University Campus',
            adminCreds.salt,
            adminCreds.hash,
            'admin'
        );

        // Seed 2: Regular Student
        const studentCreds = hashPassword('Student@123');
        insertUser.run(
            'Surya (Student)',
            'surya@college.edu',
            '+91 98765 43210',
            'Engineering Campus',
            studentCreds.salt,
            studentCreds.hash,
            'student'
        );

        console.log('✅ Default users seeded (Admin: admin@campus.edu / Admin@123, Student: surya@college.edu / Student@123)');
    }

    // Seed Default Items if table is empty
    const itemsCountStmt = db.prepare('SELECT COUNT(*) as count FROM items');
    const itemsCount = itemsCountStmt.get().count;

    if (itemsCount === 0) {
        const seedStmt = db.prepare(`
            INSERT INTO items (owner_id, name, category, price, condition, description, contact, icon)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const defaultItems = [
            {
                name: "Dell Inspiron Laptop",
                category: "electronics",
                price: 38000,
                condition: "good",
                description: "Core i5, 8GB RAM, 512GB SSD. Perfect condition for coding, CAD, and lab assignments.",
                contact: "Hostel Block B, Room 204",
                icon: "💻"
            },
            {
                name: "First-Year Engineering Books Set",
                category: "books",
                price: 650,
                condition: "good",
                description: "Includes Engineering Physics, Calculus, and Basic Electrical Engg books with notes.",
                contact: "Hostel Block A, Room 112",
                icon: "📚"
            },
            {
                name: "Boat Rockerz Wireless Headphones",
                category: "electronics",
                price: 1100,
                condition: "like-new",
                description: "Bass-boosted over-ear headphones with 15h battery life and clear microphone.",
                contact: "Campus Library area",
                icon: "🎧"
            },
            {
                name: "Ergonomic Study Desk Chair",
                category: "furniture",
                price: 900,
                condition: "good",
                description: "Adjustable height with rolling wheels, comfortable back support for long study nights.",
                contact: "Hostel Block C, Room 305",
                icon: "🪑"
            },
            {
                name: "College Sports Jacket",
                category: "clothes",
                price: 450,
                condition: "good",
                description: "Warm fleece winter hoodie jacket (Size L). Barely worn for one winter semester.",
                contact: "WhatsApp: +91 98765 00000",
                icon: "👕"
            },
            {
                name: "Scientific Drafter & Sheet Container",
                category: "others",
                price: 350,
                condition: "good",
                description: "Mini drafter for Engineering Graphics drawing labs with waterproof sheet holder tube.",
                contact: "Mechanical Dept Lobby",
                icon: "📐"
            }
        ];

        for (const item of defaultItems) {
            seedStmt.run(2, item.name, item.category, item.price, item.condition, item.description, item.contact, item.icon);
        }
    }

    console.log('✅ SQLite Database initialized at:', dbPath);
}

module.exports = {
    db,
    initDatabase,
    hashPassword,
    verifyPassword
};
