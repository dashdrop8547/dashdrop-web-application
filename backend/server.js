// ==========================================
// DashDrop - Express Backend Server
// Campus Marketplace API with Role-Based Access Control (RBAC)
// (Node.js & SQLite)
// ==========================================

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, initDatabase, hashPassword, verifyPassword } = require('./database.js');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Database & Tables
initDatabase();

// Middleware
app.use(cors());
app.use(express.json());

// Serve Frontend Static Files (HTML, CSS, JS) directly from Express
app.use(express.static(path.join(__dirname, '../frontend')));

// In-memory active session token store: token -> user object
const activeTokens = new Map();

// Helper: Generate Secure Session Token
function generateToken(user) {
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        college: user.college,
        createdAt: Date.now()
    });
    return token;
}

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || !activeTokens.has(token)) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required. Please login first.'
        });
    }

    req.user = activeTokens.get(token);
    next();
}

// Optional Authentication Middleware (extracts user if token present)
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && activeTokens.has(token)) {
        req.user = activeTokens.get(token);
    }
    next();
}

// Role-Based Authorization Middleware
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Unauthorized.' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}`
            });
        }
        next();
    };
}

// Audit Log Helper
function logActivity(userId, action, details) {
    try {
        const stmt = db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)');
        stmt.run(userId || null, action, details || '');
    } catch (e) {
        console.error('Failed to write activity log:', e);
    }
}

// Helper: Category to Emoji
const categoryIcons = {
    electronics: '💻',
    books: '📚',
    furniture: '🪑',
    clothes: '👕',
    academic: '🔢',
    mobility: '🚲',
    music: '🎸',
    others: '📦'
};

// ==========================================
// AUTHENTICATION & RBAC ROUTES
// ==========================================

// 1. Register User (Default role: 'student')
app.post('/api/auth/register', (req, res) => {
    try {
        const { name, email, password, phone, college } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Name, email, and password are required.'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user exists
        const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedEmail);
        if (existing) {
            return res.status(409).json({
                success: false,
                error: 'An account with this email already exists.'
            });
        }

        const { salt, hash } = hashPassword(password);
        const stmt = db.prepare(`
            INSERT INTO users (name, email, phone, college, salt, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?, 'student')
        `);

        stmt.run(
            name.trim(),
            normalizedEmail,
            phone ? phone.trim() : null,
            college ? college.trim() : 'Engineering Campus',
            salt,
            hash
        );

        const newUser = db.prepare('SELECT id, name, email, phone, college, role FROM users WHERE email = ?').get(normalizedEmail);
        const token = generateToken(newUser);

        logActivity(newUser.id, 'USER_REGISTERED', `Student registered: ${newUser.email}`);

        res.status(201).json({
            success: true,
            message: 'Registration successful! Welcome to DashDrop.',
            token,
            user: newUser
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, error: 'Registration failed due to a server error.' });
    }
});

// 2. Login User
app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Please provide both email and password.'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail);

        if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password.'
            });
        }

        const safeUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            college: user.college,
            role: user.role
        };

        const token = generateToken(safeUser);
        logActivity(user.id, 'USER_LOGIN', `User logged in with role: ${user.role}`);

        res.json({
            success: true,
            message: `Welcome back, ${user.name}!`,
            token,
            user: safeUser
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, error: 'Login failed due to a server error.' });
    }
});

// 3. Current User Profile (/api/auth/me)
app.get('/api/auth/me', authenticateToken, (req, res) => {
    try {
        const user = db.prepare('SELECT id, name, email, phone, college, role, created_at FROM users WHERE id = ?').get(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User record not found.' });
        }
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch current user profile.' });
    }
});

// 4. Logout User
app.post('/api/auth/logout', authenticateToken, (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.slice(7);
    if (token) activeTokens.delete(token);
    res.json({ success: true, message: 'Successfully logged out.' });
});

// ==========================================
// MARKETPLACE ITEMS ROUTES
// ==========================================

// 5. GET all marketplace items (public, supports pagination, category filter & search)
app.get('/api/items', (req, res) => {
    try {
        const { category, search } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 6));
        const offset = (page - 1) * limit;

        let whereClause = "WHERE items.status = 'available'";
        const params = [];

        if (category && category.toLowerCase() !== 'all') {
            whereClause += ' AND LOWER(items.category) = LOWER(?)';
            params.push(category);
        }

        if (search && search.trim() !== '') {
            whereClause += ' AND (LOWER(items.name) LIKE ? OR LOWER(items.description) LIKE ? OR LOWER(items.category) LIKE ?)';
            const term = `%${search.trim().toLowerCase()}%`;
            params.push(term, term, term);
        }

        // Count total items matching filter
        const countQuery = `SELECT COUNT(*) as total FROM items ${whereClause}`;
        const totalCount = db.prepare(countQuery).get(...params).total;
        const totalPages = Math.ceil(totalCount / limit) || 1;

        // Fetch paginated page of items
        const dataQuery = `
            SELECT items.*, users.name as owner_name 
            FROM items 
            LEFT JOIN users ON items.owner_id = users.id 
            ${whereClause} 
            ORDER BY items.id DESC 
            LIMIT ? OFFSET ?
        `;
        const items = db.prepare(dataQuery).all(...params, limit, offset);

        res.json({
            success: true,
            pagination: {
                page,
                limit,
                totalItems: totalCount,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            count: items.length,
            data: items
        });
    } catch (err) {
        console.error('Error fetching items:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve marketplace items.' });
    }
});

// 6. GET single item by ID
app.get('/api/items/:id', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT items.*, users.name as owner_name, users.email as owner_email
            FROM items 
            LEFT JOIN users ON items.owner_id = users.id 
            WHERE items.id = ?
        `);
        const item = stmt.get(req.params.id);

        if (!item) {
            return res.status(404).json({ success: false, error: 'Item not found.' });
        }

        res.json({ success: true, data: item });
    } catch (err) {
        console.error('Error fetching item by id:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve item.' });
    }
});

// 7. POST create a new listing (Student or Admin)
app.post('/api/items', optionalAuth, (req, res) => {
    try {
        const { name, category, price, condition, description, contact } = req.body;

        if (!name || !category || price === undefined || price === null || !condition || !contact) {
            return res.status(400).json({
                success: false,
                error: 'Please provide all required fields: name, category, price, condition, and contact.'
            });
        }

        const numPrice = parseFloat(price);
        if (isNaN(numPrice) || numPrice < 0) {
            return res.status(400).json({
                success: false,
                error: 'Price must be a valid non-negative number.'
            });
        }

        const icon = categoryIcons[category.toLowerCase()] || '📦';
        const finalDesc = description && description.trim() !== ''
            ? description.trim()
            : `Student item listed in ${condition} condition.`;

        const ownerId = req.user ? req.user.id : null;

        const stmt = db.prepare(`
            INSERT INTO items (owner_id, name, category, price, condition, description, contact, icon)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(ownerId, name.trim(), category.toLowerCase().trim(), numPrice, condition, finalDesc, contact.trim(), icon);

        const lastItemStmt = db.prepare('SELECT * FROM items ORDER BY id DESC LIMIT 1');
        const createdItem = lastItemStmt.get();

        logActivity(ownerId, 'ITEM_CREATED', `Listed: ${name.trim()} (₹${numPrice})`);

        res.status(201).json({
            success: true,
            message: 'Item listed successfully on DashDrop marketplace.',
            data: createdItem
        });
    } catch (err) {
        console.error('Error listing item:', err);
        res.status(500).json({ success: false, error: 'Failed to create listing.' });
    }
});

// 8. DELETE an item
// RBAC Rule: Item owner OR Admin can delete!
app.delete('/api/items/:id', authenticateToken, (req, res) => {
    try {
        const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);

        if (!item) {
            return res.status(404).json({ success: false, error: 'Item not found.' });
        }

        // Check permission: Owner of the item or Admin role
        const isOwner = req.user && item.owner_id === req.user.id;
        const isAdmin = req.user && req.user.role === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden: You can only delete your own items, or you need admin privileges.'
            });
        }

        const stmt = db.prepare('DELETE FROM items WHERE id = ?');
        stmt.run(req.params.id);

        logActivity(req.user.id, 'ITEM_DELETED', `Item #${req.params.id} (${item.name}) deleted by ${req.user.role}`);

        res.json({
            success: true,
            message: `Item listing removed successfully by ${isAdmin ? 'Admin' : 'Owner'}.`
        });
    } catch (err) {
        console.error('Error deleting item:', err);
        res.status(500).json({ success: false, error: 'Failed to delete item.' });
    }
});

// ==========================================
// RENTALS ROUTES
// ==========================================

// 9. GET all rentals (Admin view or student's own)
app.get('/api/rentals', optionalAuth, (req, res) => {
    try {
        let stmt;
        if (req.user && req.user.role === 'admin') {
            stmt = db.prepare('SELECT * FROM rentals ORDER BY id DESC');
        } else if (req.user) {
            stmt = db.prepare('SELECT * FROM rentals WHERE renter_id = ? ORDER BY id DESC');
            const rentals = stmt.all(req.user.id);
            return res.json({ success: true, count: rentals.length, data: rentals });
        } else {
            stmt = db.prepare('SELECT * FROM rentals ORDER BY id DESC');
        }

        const rentals = stmt.all();
        res.json({ success: true, count: rentals.length, data: rentals });
    } catch (err) {
        console.error('Error fetching rentals:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve rentals.' });
    }
});

// 10. POST create a rental request
app.post('/api/rentals', optionalAuth, (req, res) => {
    try {
        const { item_name, category, daily_price, days, student_name } = req.body;

        if (!item_name || !daily_price || !days) {
            return res.status(400).json({
                success: false,
                error: 'Please provide item_name, daily_price, and number of days.'
            });
        }

        const numDays = parseInt(days, 10);
        const pricePerDay = parseFloat(daily_price);
        const totalPrice = numDays * pricePerDay;
        const renterId = req.user ? req.user.id : null;
        const renterName = req.user ? req.user.name : (student_name || 'Student');

        const stmt = db.prepare(`
            INSERT INTO rentals (renter_id, item_name, category, daily_price, days, total_price, student_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(renterId, item_name, category || 'general', pricePerDay, numDays, totalPrice, renterName);

        logActivity(renterId, 'RENTAL_CREATED', `Rented: ${item_name} for ${numDays} days (₹${totalPrice})`);

        res.status(201).json({
            success: true,
            message: `Rental confirmed for ${numDays} day(s). Total: ₹${totalPrice}`,
            rental: {
                item_name,
                days: numDays,
                total_price: totalPrice
            }
        });
    } catch (err) {
        console.error('Error placing rental:', err);
        res.status(500).json({ success: false, error: 'Failed to create rental request.' });
    }
});

// ==========================================
// USER PROFILE & STATS
// ==========================================

// 11. GET User Profile & Real-time Activity Stats
app.get('/api/profile', optionalAuth, (req, res) => {
    try {
        let profile;
        let listedCount = 0;
        let rentedCount = 0;
        let soldCount = 0;

        if (req.user) {
            profile = db.prepare('SELECT id, name, email, phone, college, role FROM users WHERE id = ?').get(req.user.id);
            listedCount = db.prepare('SELECT COUNT(*) as count FROM items WHERE owner_id = ?').get(req.user.id).count;
            rentedCount = db.prepare('SELECT COUNT(*) as count FROM rentals WHERE renter_id = ?').get(req.user.id).count;
            soldCount = db.prepare("SELECT COUNT(*) as count FROM items WHERE owner_id = ? AND status = 'sold'").get(req.user.id).count;
        } else {
            // Default profile for guest preview
            profile = db.prepare('SELECT id, name, email, phone, college, role FROM users WHERE id = 2').get() || {
                name: 'Surya',
                email: 'surya@college.edu',
                phone: '+91 98765 43210',
                college: 'Engineering Campus',
                role: 'student'
            };
            listedCount = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
            rentedCount = db.prepare('SELECT COUNT(*) as count FROM rentals').get().count;
            soldCount = db.prepare("SELECT COUNT(*) as count FROM items WHERE status = 'sold'").get().count;
        }

        res.json({
            success: true,
            profile,
            stats: {
                listed: listedCount,
                rented: rentedCount,
                sold: soldCount
            }
        });
    } catch (err) {
        console.error('Error fetching profile:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve profile data.' });
    }
});

// 12. PUT update User Profile
app.put('/api/profile', authenticateToken, (req, res) => {
    try {
        const { name, email, phone, college } = req.body;

        const stmt = db.prepare(`
            UPDATE users 
            SET name = COALESCE(?, name),
                email = COALESCE(?, email),
                phone = COALESCE(?, phone),
                college = COALESCE(?, college)
            WHERE id = ?
        `);

        stmt.run(name || null, email || null, phone || null, college || null, req.user.id);

        const updated = db.prepare('SELECT id, name, email, phone, college, role FROM users WHERE id = ?').get(req.user.id);

        // Update token cache
        activeTokens.set(req.headers['authorization'].slice(7), {
            ...req.user,
            name: updated.name,
            email: updated.email,
            college: updated.college
        });

        res.json({
            success: true,
            message: 'Profile updated successfully.',
            profile: updated
        });
    } catch (err) {
        console.error('Error updating profile:', err);
        res.status(500).json({ success: false, error: 'Failed to update profile.' });
    }
});

// ==========================================
// MY PRODUCTS: SELLING & BOUGHT
// ==========================================

// 13. POST Buy / Purchase an Item
app.post('/api/items/:id/buy', authenticateToken, (req, res) => {
    try {
        const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);

        if (!item) {
            return res.status(404).json({ success: false, error: 'Item not found.' });
        }

        if (item.status === 'sold') {
            return res.status(400).json({ success: false, error: 'This item has already been sold.' });
        }

        if (item.owner_id === req.user.id) {
            return res.status(400).json({ success: false, error: 'You cannot buy your own listed item.' });
        }

        // Get seller details
        const seller = item.owner_id ? db.prepare('SELECT name, email, phone FROM users WHERE id = ?').get(item.owner_id) : null;
        const sellerName = seller ? seller.name : 'Student Seller';

        // Mark item as sold
        db.prepare("UPDATE items SET status = 'sold' WHERE id = ?").run(item.id);

        // Record purchase
        const insertPurchase = db.prepare(`
            INSERT INTO purchases (buyer_id, item_id, item_name, category, price, seller_name, seller_contact, icon)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertPurchase.run(
            req.user.id,
            item.id,
            item.name,
            item.category,
            item.price,
            sellerName,
            item.contact,
            item.icon || '📦'
        );

        logActivity(req.user.id, 'ITEM_PURCHASED', `Bought "${item.name}" for ₹${item.price} from ${sellerName}`);

        res.status(201).json({
            success: true,
            message: `🎉 Congratulations! You have successfully purchased "${item.name}".`,
            purchase: {
                item_name: item.name,
                price: item.price,
                seller_name: sellerName,
                seller_contact: item.contact
            }
        });
    } catch (err) {
        console.error('Error buying item:', err);
        res.status(500).json({ success: false, error: 'Failed to process purchase.' });
    }
});

// 14. GET My Products to Sell (Current user's listings)
app.get('/api/my-products/selling', authenticateToken, (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT * FROM items 
            WHERE owner_id = ? 
            ORDER BY id DESC
        `);
        const items = stmt.all(req.user.id);

        res.json({
            success: true,
            count: items.length,
            data: items
        });
    } catch (err) {
        console.error('Error fetching my selling items:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve your listings.' });
    }
});

// 15. GET My Products Bought (Current user's purchases)
app.get('/api/my-products/bought', authenticateToken, (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT * FROM purchases 
            WHERE buyer_id = ? 
            ORDER BY id DESC
        `);
        const purchases = stmt.all(req.user.id);

        res.json({
            success: true,
            count: purchases.length,
            data: purchases
        });
    } catch (err) {
        console.error('Error fetching my purchases:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve your purchases.' });
    }
});

// ==========================================
// WISHLIST / SAVED ITEMS ROUTES
// ==========================================

// 16. POST Toggle item in user wishlist (add if not present, remove if already present)
app.post('/api/wishlist/:id', authenticateToken, (req, res) => {
    try {
        const itemId = parseInt(req.params.id, 10);
        const item = db.prepare('SELECT id, name FROM items WHERE id = ?').get(itemId);

        if (!item) {
            return res.status(404).json({ success: false, error: 'Item not found.' });
        }

        const existing = db.prepare('SELECT id FROM wishlist WHERE user_id = ? AND item_id = ?').get(req.user.id, itemId);

        if (existing) {
            // Remove from wishlist
            db.prepare('DELETE FROM wishlist WHERE id = ?').run(existing.id);
            return res.json({
                success: true,
                saved: false,
                message: `Removed "${item.name}" from your saved items.`
            });
        } else {
            // Add to wishlist
            db.prepare('INSERT INTO wishlist (user_id, item_id) VALUES (?, ?)').run(req.user.id, itemId);
            return res.json({
                success: true,
                saved: true,
                message: `❤️ Added "${item.name}" to your saved items!`
            });
        }
    } catch (err) {
        console.error('Wishlist toggle error:', err);
        res.status(500).json({ success: false, error: 'Failed to update wishlist.' });
    }
});

// 17. GET Current user's saved wishlist items
app.get('/api/wishlist', authenticateToken, (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT items.*, users.name as owner_name, wishlist.saved_at
            FROM wishlist
            JOIN items ON wishlist.item_id = items.id
            LEFT JOIN users ON items.owner_id = users.id
            WHERE wishlist.user_id = ?
            ORDER BY wishlist.id DESC
        `);
        const items = stmt.all(req.user.id);

        res.json({
            success: true,
            count: items.length,
            data: items
        });
    } catch (err) {
        console.error('Wishlist fetch error:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve wishlist items.' });
    }
});

// 18. GET List of item IDs currently in user's wishlist (for UI heart states)
app.get('/api/wishlist/ids', authenticateToken, (req, res) => {
    try {
        const rows = db.prepare('SELECT item_id FROM wishlist WHERE user_id = ?').all(req.user.id);
        const ids = rows.map(r => r.item_id);
        res.json({ success: true, ids });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to retrieve wishlist IDs.' });
    }
});

// ==========================================
// ADMIN EXCLUSIVE ROUTES (RBAC)
// ==========================================

// 13. GET Admin Overview & System Analytics
app.get('/api/admin/dashboard', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
        const totalRentals = db.prepare('SELECT COUNT(*) as count FROM rentals').get().count;
        const activeRentals = db.prepare("SELECT COUNT(*) as count FROM rentals WHERE status = 'active'").get().count;
        const usersList = db.prepare('SELECT id, name, email, phone, college, role, created_at FROM users ORDER BY id DESC').all();
        const recentLogs = db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 15').all();

        res.json({
            success: true,
            stats: {
                totalUsers,
                totalItems,
                totalRentals,
                activeRentals
            },
            users: usersList,
            logs: recentLogs
        });
    } catch (err) {
        console.error('Admin dashboard error:', err);
        res.status(500).json({ success: false, error: 'Failed to load admin dashboard.' });
    }
});

// 14. PUT Promote/Demote User Role (Admin only)
app.put('/api/admin/users/:id/role', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { role } = req.body;
        if (!['admin', 'student'].includes(role)) {
            return res.status(400).json({ success: false, error: "Role must be 'student' or 'admin'." });
        }

        const targetUser = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(req.params.id);
        if (!targetUser) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
        logActivity(req.user.id, 'ROLE_CHANGED', `Changed user #${req.params.id} (${targetUser.email}) role to ${role}`);

        res.json({
            success: true,
            message: `User role updated to ${role} successfully.`
        });
    } catch (err) {
        console.error('Update role error:', err);
        res.status(500).json({ success: false, error: 'Failed to update user role.' });
    }
});

// 15. Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        message: 'DashDrop Backend API with RBAC is running smoothly',
        database: 'SQLite (native node:sqlite)',
        timestamp: new Date().toISOString()
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 DashDrop RBAC Backend Server is Running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`📂 Frontend served at: http://localhost:${PORT}/index.html`);
    console.log(`🔐 Roles configured: 'student' (default), 'admin'`);
    console.log(`===============================================`);
});
