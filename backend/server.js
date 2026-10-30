// ==========================================
// DashDrop - Express Backend Server
// Campus Marketplace API with Role-Based Access Control (RBAC)
// (Node.js & SQLite)
// ==========================================

const express = require('express');
const cors = require('cors');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server: SocketIOServer } = require('socket.io');
const { db, initDatabase, hashPassword, verifyPassword } = require('./database.js');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});
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

// In-App Notification Helper (stores in SQLite + emits real-time via Socket.IO)
function createNotification(userId, type, title, message, link = '') {
    try {
        if (!userId) return null;
        const stmt = db.prepare(`
            INSERT INTO notifications (user_id, type, title, message, link, is_read)
            VALUES (?, ?, ?, ?, ?, 0)
        `);
        const result = stmt.run(userId, type, title, message, link);
        const notif = {
            id: result.lastInsertRowid,
            user_id: userId,
            type,
            title,
            message,
            link,
            is_read: 0,
            created_at: new Date().toISOString()
        };

        if (io) {
            io.to(`user_${userId}`).emit('new_notification', notif);
        }
        return notif;
    } catch (err) {
        console.error('Failed to create notification:', err);
        return null;
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
        const { category, search, hostel_block } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 6));
        const offset = (page - 1) * limit;

        let whereClause = "WHERE items.status = 'available' AND (users.is_blocked = 0 OR users.is_blocked IS NULL)";
        const params = [];

        if (category && category.toLowerCase() !== 'all') {
            whereClause += ' AND LOWER(items.category) = LOWER(?)';
            params.push(category);
        }

        if (hostel_block && hostel_block.toLowerCase() !== 'all' && hostel_block.trim() !== '') {
            whereClause += ' AND LOWER(items.hostel_block) = LOWER(?)';
            params.push(hostel_block.trim());
        }

        if (search && search.trim() !== '') {
            whereClause += ' AND (LOWER(items.name) LIKE ? OR LOWER(items.description) LIKE ? OR LOWER(items.category) LIKE ? OR LOWER(items.hostel_block) LIKE ?)';
            const term = `%${search.trim().toLowerCase()}%`;
            params.push(term, term, term, term);
        }

        // Count total items matching filter
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM items 
            LEFT JOIN users ON items.owner_id = users.id 
            ${whereClause}
        `;
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

// 5b. GET all distinct campus hostels/blocks with item counts
app.get('/api/items/blocks', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT cb.name, COUNT(i.id) as count 
            FROM campus_blocks cb
            LEFT JOIN items i ON LOWER(i.hostel_block) = LOWER(cb.name) AND i.status = 'available'
            GROUP BY cb.id, cb.name
            ORDER BY count DESC, cb.name ASC
        `).all();

        const totalAvailable = db.prepare("SELECT COUNT(*) as count FROM items WHERE status = 'available'").get().count;

        res.json({
            success: true,
            total: totalAvailable,
            blocks: [
                { name: 'All Blocks', count: totalAvailable },
                ...rows
            ]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to retrieve hostel blocks.' });
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
        const { name, category, price, condition, description, contact, hostel_block } = req.body;

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
        if (ownerId) {
            const userCheck = db.prepare('SELECT is_blocked FROM users WHERE id = ?').get(ownerId);
            if (userCheck && userCheck.is_blocked) {
                return res.status(403).json({
                    success: false,
                    error: 'Your seller account has been blocked by an administrator. You cannot post listings.'
                });
            }
        }
        const block = hostel_block && hostel_block.trim() !== '' ? hostel_block.trim() : 'Block A';

        const stmt = db.prepare(`
            INSERT INTO items (owner_id, name, category, price, condition, description, contact, icon, hostel_block)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(ownerId, name.trim(), category.toLowerCase().trim(), numPrice, condition, finalDesc, contact.trim(), icon, block);

        const lastItemStmt = db.prepare('SELECT * FROM items ORDER BY id DESC LIMIT 1');
        const createdItem = lastItemStmt.get();

        logActivity(ownerId, 'ITEM_CREATED', `Listed: ${name.trim()} (₹${numPrice}, Block: ${block})`);

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

// ==========================================
// RENTAL RETURN TRACKER & OVERDUE REMINDERS
// ==========================================

// Helper: Process and augment rental with live return & overdue tracking status
function enrichRentalTracking(rental) {
    const now = new Date();
    const rentedAt = new Date(rental.rented_at);
    // If due_date is missing, compute it from rented_at + days
    const dueDate = rental.due_date ? new Date(rental.due_date) : new Date(rentedAt.getTime() + rental.days * 86400000);

    let status = rental.status || 'active';
    let isOverdue = false;
    let daysOverdue = 0;
    let daysRemaining = 0;
    let lateFee = rental.late_fee || 0;

    if (status === 'returned') {
        isOverdue = false;
        daysRemaining = 0;
    } else {
        const diffMs = dueDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / 86400000);

        if (diffDays < 0) {
            isOverdue = true;
            status = 'overdue';
            daysOverdue = Math.abs(diffDays);
            daysRemaining = 0;
            // Standard campus late fee: ₹20 base or 50% of daily rate per overdue day
            const dailyLateRate = Math.max(20, (rental.daily_price || 0) * 0.5);
            lateFee = Math.round(daysOverdue * dailyLateRate);

            // Persist overdue status & late_fee into database if needed
            try {
                db.prepare('UPDATE rentals SET status = ?, late_fee = ? WHERE id = ?').run('overdue', lateFee, rental.id);
            } catch (_) {}
        } else {
            isOverdue = false;
            status = 'active';
            daysRemaining = diffDays;
            daysOverdue = 0;
        }
    }

    return {
        ...rental,
        status,
        due_date: dueDate.toISOString(),
        is_overdue: isOverdue,
        days_overdue: daysOverdue,
        days_remaining: daysRemaining,
        late_fee: lateFee,
        formatted_rented_at: rentedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        formatted_due_date: dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        formatted_returned_at: rental.returned_at ? new Date(rental.returned_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null
    };
}

// 9. GET rentals with dynamic return tracking & overdue calculation
app.get('/api/rentals', optionalAuth, (req, res) => {
    try {
        let rows;
        if (req.user && req.user.role === 'admin') {
            rows = db.prepare('SELECT * FROM rentals ORDER BY id DESC').all();
        } else if (req.user) {
            rows = db.prepare('SELECT * FROM rentals WHERE renter_id = ? ORDER BY id DESC').all(req.user.id);
        } else {
            rows = db.prepare('SELECT * FROM rentals ORDER BY id DESC').all();
        }

        const data = rows.map(enrichRentalTracking);
        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error('Error fetching rentals:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve rentals.' });
    }
});

// 9b. GET Rental Tracking Overview & Summary Stats
app.get('/api/rentals/overview', optionalAuth, (req, res) => {
    try {
        let rows;
        if (req.user && req.user.role !== 'admin') {
            rows = db.prepare('SELECT * FROM rentals WHERE renter_id = ?').all(req.user.id);
        } else {
            rows = db.prepare('SELECT * FROM rentals').all();
        }

        const tracked = rows.map(enrichRentalTracking);
        const activeRentals = tracked.filter(r => r.status === 'active').length;
        const overdueRentals = tracked.filter(r => r.status === 'overdue').length;
        const returnedRentals = tracked.filter(r => r.status === 'returned').length;
        const totalLateFees = tracked.reduce((sum, r) => sum + (r.late_fee || 0), 0);

        // Immediate urgent alerts: rentals that are overdue or due within 24 hours
        const urgentAlerts = tracked.filter(r => r.status === 'overdue' || (r.status === 'active' && r.days_remaining <= 1));

        res.json({
            success: true,
            stats: {
                totalRentals: tracked.length,
                activeRentals,
                overdueRentals,
                returnedRentals,
                totalLateFees
            },
            alerts: urgentAlerts
        });
    } catch (err) {
        console.error('Error in rental overview:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch rental tracker overview.' });
    }
});

// 10. POST create a rental request (with auto-calculated due_date)
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

        const now = new Date();
        const dueDate = new Date(now.getTime() + numDays * 86400000).toISOString();

        const stmt = db.prepare(`
            INSERT INTO rentals (renter_id, item_name, category, daily_price, days, total_price, student_name, status, due_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `);

        const result = stmt.run(renterId, item_name, category || 'general', pricePerDay, numDays, totalPrice, renterName, dueDate);

        logActivity(renterId, 'RENTAL_CREATED', `Rented: ${item_name} for ${numDays} days (₹${totalPrice}, Due: ${new Date(dueDate).toLocaleDateString()})`);

        res.status(201).json({
            success: true,
            message: `Rental confirmed for ${numDays} day(s). Due date: ${new Date(dueDate).toLocaleDateString()}. Total: ₹${totalPrice}`,
            rental: {
                id: result.lastInsertRowid,
                item_name,
                days: numDays,
                total_price: totalPrice,
                due_date: dueDate
            }
        });
    } catch (err) {
        console.error('Error placing rental:', err);
        res.status(500).json({ success: false, error: 'Failed to create rental request.' });
    }
});

// 10b. POST Return a rental item
app.post('/api/rentals/:id/return', authenticateToken, (req, res) => {
    try {
        const rentalId = parseInt(req.params.id, 10);
        const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(rentalId);

        if (!rental) {
            return res.status(404).json({ success: false, error: 'Rental record not found.' });
        }

        // Authorization: Only the renter or an admin can mark return
        if (req.user.role !== 'admin' && rental.renter_id && rental.renter_id !== req.user.id) {
            return res.status(403).json({ success: false, error: 'Unauthorized to return this rental.' });
        }

        if (rental.status === 'returned') {
            return res.status(400).json({ success: false, error: 'Item has already been returned.' });
        }

        const now = new Date();
        const dueDate = rental.due_date ? new Date(rental.due_date) : new Date(new Date(rental.rented_at).getTime() + rental.days * 86400000);
        let lateFee = 0;

        if (now > dueDate) {
            const daysOverdue = Math.ceil((now.getTime() - dueDate.getTime()) / 86400000);
            const dailyLateRate = Math.max(20, (rental.daily_price || 0) * 0.5);
            lateFee = Math.round(daysOverdue * dailyLateRate);
        }

        db.prepare(`
            UPDATE rentals 
            SET status = 'returned', returned_at = ?, late_fee = ?
            WHERE id = ?
        `).run(now.toISOString(), lateFee, rentalId);

        logActivity(req.user.id, 'RENTAL_RETURNED', `Returned: ${rental.item_name}. Late fee: ₹${lateFee}`);

        res.json({
            success: true,
            message: `Item "${rental.item_name}" successfully returned! ${lateFee > 0 ? `Late fee applied: ₹${lateFee}` : 'Returned on time without fees.'}`,
            lateFee,
            returnedAt: now.toISOString()
        });
    } catch (err) {
        console.error('Error returning rental:', err);
        res.status(500).json({ success: false, error: 'Failed to process rental return.' });
    }
});

// 10c. POST Extend a rental
app.post('/api/rentals/:id/extend', authenticateToken, (req, res) => {
    try {
        const rentalId = parseInt(req.params.id, 10);
        const extraDays = parseInt(req.body.extra_days, 10) || 1;

        if (extraDays < 1 || extraDays > 14) {
            return res.status(400).json({ success: false, error: 'Extension must be between 1 and 14 days.' });
        }

        const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(rentalId);
        if (!rental) return res.status(404).json({ success: false, error: 'Rental not found.' });

        if (req.user.role !== 'admin' && rental.renter_id && rental.renter_id !== req.user.id) {
            return res.status(403).json({ success: false, error: 'Unauthorized to extend this rental.' });
        }

        if (rental.status === 'returned') {
            return res.status(400).json({ success: false, error: 'Cannot extend an already returned item.' });
        }

        const currentDue = rental.due_date ? new Date(rental.due_date) : new Date(new Date(rental.rented_at).getTime() + rental.days * 86400000);
        // If already overdue, extend from today; otherwise extend from current due date
        const baseDate = currentDue < new Date() ? new Date() : currentDue;
        const newDueDate = new Date(baseDate.getTime() + extraDays * 86400000);
        const addedCost = extraDays * (rental.daily_price || 0);
        const newTotal = (rental.total_price || 0) + addedCost;
        const newTotalDays = (rental.days || 0) + extraDays;

        db.prepare(`
            UPDATE rentals 
            SET days = ?, total_price = ?, due_date = ?, status = 'active', late_fee = 0
            WHERE id = ?
        `).run(newTotalDays, newTotal, newDueDate.toISOString(), rentalId);

        logActivity(req.user.id, 'RENTAL_EXTENDED', `Extended ${rental.item_name} by ${extraDays} day(s). New due: ${newDueDate.toLocaleDateString()}. Added cost: ₹${addedCost}`);

        res.json({
            success: true,
            message: `Rental extended by ${extraDays} day(s)! New return due date: ${newDueDate.toLocaleDateString('en-IN')}`,
            newDueDate: newDueDate.toISOString(),
            newTotal,
            addedCost
        });
    } catch (err) {
        console.error('Error extending rental:', err);
        res.status(500).json({ success: false, error: 'Failed to extend rental.' });
    }
});

// 10d. POST Send Overdue Reminder (Admin or System Notification)
app.post('/api/rentals/:id/remind', authenticateToken, (req, res) => {
    try {
        const rentalId = parseInt(req.params.id, 10);
        const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(rentalId);
        if (!rental) return res.status(404).json({ success: false, error: 'Rental not found.' });

        const now = new Date().toISOString();
        db.prepare('UPDATE rentals SET reminded_at = ? WHERE id = ?').run(now, rentalId);

        logActivity(req.user.id, 'OVERDUE_REMINDER_SENT', `Sent return reminder to ${rental.student_name} for "${rental.item_name}"`);

        // Send In-App Notification to Renter
        if (rental.renter_id) {
            createNotification(
                rental.renter_id,
                'rental_reminder',
                '🔔 Campus Return Reminder',
                `Reminder from Campus Staff: Please return "${rental.item_name}" to the pickup desk or extend.`,
                'account.html#myRentalsTrackerSection'
            );
        }

        res.json({
            success: true,
            message: `Overdue reminder sent to ${rental.student_name} for "${rental.item_name}"!`,
            remindedAt: now
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to send reminder.' });
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

        // Notify Seller that item was sold
        if (item.owner_id) {
            createNotification(
                item.owner_id,
                'purchase',
                '🎉 Your Item Sold!',
                `"${item.name}" was purchased by ${req.user.name} for ₹${item.price}.`,
                'account.html#mySellingSection'
            );
        }

        // Notify Buyer of purchase confirmation
        createNotification(
            req.user.id,
            'purchase',
            '🛍️ Purchase Confirmed',
            `You bought "${item.name}" from ${sellerName}. Pickup point: ${item.contact}`,
            'account.html#myBoughtSection'
        );

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

// 17. GET List of item IDs currently in user's wishlist (for UI heart states)
// NOTE: Must be defined BEFORE /api/wishlist to avoid Express matching "ids" as a param
app.get('/api/wishlist/ids', authenticateToken, (req, res) => {
    try {
        const rows = db.prepare('SELECT item_id FROM wishlist WHERE user_id = ?').all(req.user.id);
        const ids = rows.map(r => r.item_id);
        res.json({ success: true, ids });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to retrieve wishlist IDs.' });
    }
});

// 18. GET Current user's saved wishlist items (full details)
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

// ==========================================
// ADMIN: CAMPUS BLOCK NAMES & SELLER MODERATION
// ==========================================

// GET /api/admin/blocks — List all campus blocks with item counts
app.get('/api/admin/blocks', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const blocks = db.prepare(`
            SELECT cb.id, cb.name, COUNT(i.id) as item_count
            FROM campus_blocks cb
            LEFT JOIN items i ON LOWER(i.hostel_block) = LOWER(cb.name) AND i.status = 'available'
            GROUP BY cb.id, cb.name
            ORDER BY cb.name ASC
        `).all();
        res.json({ success: true, blocks });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch campus blocks.' });
    }
});

// POST /api/admin/blocks — Add new campus block
app.post('/api/admin/blocks', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Block name cannot be empty.' });
        }
        const cleanName = name.trim();
        db.prepare('INSERT INTO campus_blocks (name) VALUES (?)').run(cleanName);
        logActivity(req.user.id, 'ADD_BLOCK', `Added new campus block: "${cleanName}"`);
        res.status(201).json({ success: true, message: `Block "${cleanName}" added successfully.`, name: cleanName });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, error: 'A block with this name already exists.' });
        }
        res.status(500).json({ success: false, error: 'Failed to add block.' });
    }
});

// PUT /api/admin/blocks/rename — Rename existing campus block and cascade update to items
app.put('/api/admin/blocks/rename', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { oldName, newName } = req.body;
        if (!oldName || !newName || !oldName.trim() || !newName.trim()) {
            return res.status(400).json({ success: false, error: 'Both current name and new name are required.' });
        }
        const cleanOld = oldName.trim();
        const cleanNew = newName.trim();

        // 1. Update in campus_blocks table (merge if newName already exists)
        const targetExisting = db.prepare('SELECT id FROM campus_blocks WHERE LOWER(name) = LOWER(?)').get(cleanNew);
        if (targetExisting) {
            db.prepare('DELETE FROM campus_blocks WHERE LOWER(name) = LOWER(?)').run(cleanOld);
        } else {
            db.prepare('UPDATE campus_blocks SET name = ? WHERE LOWER(name) = LOWER(?)').run(cleanNew, cleanOld);
        }

        // 2. Cascade rename to all existing marketplace items in this block
        const updateItems = db.prepare('UPDATE items SET hostel_block = ? WHERE LOWER(hostel_block) = LOWER(?)').run(cleanNew, cleanOld);

        logActivity(req.user.id, 'RENAME_BLOCK', `Renamed block "${cleanOld}" to "${cleanNew}" (${updateItems.changes} items updated)`);

        res.json({
            success: true,
            message: `Block successfully renamed to "${cleanNew}". Updated ${updateItems.changes} item listing(s).`,
            oldName: cleanOld,
            newName: cleanNew,
            itemsUpdated: updateItems.changes
        });
    } catch (err) {
        console.error('Rename block error:', err);
        res.status(500).json({ success: false, error: 'Failed to rename block.' });
    }
});

// GET /api/admin/sellers — List campus sellers with status and listings count
app.get('/api/admin/sellers', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const sellers = db.prepare(`
            SELECT u.id, u.name, u.email, u.phone, u.college, u.role, u.is_blocked, u.created_at,
                   COUNT(i.id) as listings_count
            FROM users u
            LEFT JOIN items i ON u.id = i.owner_id
            WHERE u.role != 'admin'
            GROUP BY u.id
            ORDER BY listings_count DESC, u.name ASC
        `).all();
        res.json({ success: true, sellers });
    } catch (err) {
        console.error('Fetch sellers error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch sellers.' });
    }
});

// PUT /api/admin/sellers/:id/block — Block or unblock a seller
app.put('/api/admin/sellers/:id/block', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const sellerId = parseInt(req.params.id, 10);
        const { is_blocked } = req.body;
        const blockVal = is_blocked ? 1 : 0;

        const targetUser = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(sellerId);
        if (!targetUser) {
            return res.status(404).json({ success: false, error: 'Seller not found.' });
        }
        if (targetUser.role === 'admin') {
            return res.status(403).json({ success: false, error: 'Cannot block an administrator account.' });
        }

        db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(blockVal, sellerId);
        logActivity(req.user.id, blockVal ? 'BLOCK_SELLER' : 'UNBLOCK_SELLER', `${blockVal ? 'Blocked' : 'Unblocked'} seller ${targetUser.name} (${targetUser.email})`);

        res.json({
            success: true,
            is_blocked: blockVal,
            message: blockVal ? `Seller "${targetUser.name}" has been blocked.` : `Seller "${targetUser.name}" has been unblocked.`
        });
    } catch (err) {
        console.error('Block seller error:', err);
        res.status(500).json({ success: false, error: 'Failed to update seller status.' });
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

// ==========================================
// NOTIFICATIONS REST ENDPOINTS
// ==========================================

// GET /api/notifications — Retrieve user's notifications and unread count
app.get('/api/notifications', authenticateToken, (req, res) => {
    try {
        const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));
        const rows = db.prepare(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'
        ).all(req.user.id, limit);

        const unreadCount = db.prepare(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
        ).get(req.user.id).count;

        res.json({
            success: true,
            unreadCount,
            notifications: rows
        });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve notifications.' });
    }
});

// PUT /api/notifications/:id/read — Mark single notification as read
app.put('/api/notifications/:id/read', authenticateToken, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, req.user.id);
        const unreadCount = db.prepare(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
        ).get(req.user.id).count;

        res.json({ success: true, unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update notification.' });
    }
});

// PUT /api/notifications/read-all — Mark all user notifications as read
app.put('/api/notifications/read-all', authenticateToken, (req, res) => {
    try {
        db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
        res.json({ success: true, unreadCount: 0 });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to mark notifications as read.' });
    }
});

// ==========================================
// CHAT REST ENDPOINTS — Real-Time Buyer-Seller Chat
// ==========================================

// GET /api/chat/conversations
// Returns all active conversations where current user is buyer or seller
app.get('/api/chat/conversations', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const rows = db.prepare(`
            SELECT cm.*, i.name as item_name, i.price as item_price, i.icon as item_icon, i.owner_id as seller_id,
                   seller.name as seller_name, buyer.name as buyer_name
            FROM chat_messages cm
            JOIN items i ON cm.item_id = i.id
            LEFT JOIN users seller ON i.owner_id = seller.id
            LEFT JOIN users buyer ON cm.buyer_id = buyer.id
            WHERE cm.buyer_id = ? OR i.owner_id = ?
            ORDER BY cm.id DESC
        `).all(userId, userId);

        const convMap = new Map();
        for (const row of rows) {
            if (!convMap.has(row.room)) {
                const isBuyer = row.buyer_id === userId;
                convMap.set(row.room, {
                    room: row.room,
                    itemId: row.item_id,
                    itemName: row.item_name,
                    itemPrice: row.item_price,
                    itemIcon: row.item_icon,
                    buyerId: row.buyer_id,
                    buyerName: row.buyer_name || 'Student',
                    sellerId: row.seller_id,
                    sellerName: row.seller_name || 'Seller',
                    isBuyer: isBuyer,
                    otherPartyName: isBuyer ? (row.seller_name || 'Seller') : (row.buyer_name || 'Buyer'),
                    otherPartyRole: isBuyer ? 'Seller' : 'Buyer',
                    lastMessage: row.message,
                    lastSenderName: row.sender_name,
                    lastSentAt: row.sent_at
                });
            }
        }

        res.json({ success: true, conversations: Array.from(convMap.values()) });
    } catch (err) {
        console.error('Conversations error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch conversations.' });
    }
});

// GET /api/chat/:itemId/buyers
// Seller viewing their own item can see all buyers who initiated a conversation
app.get('/api/chat/:itemId/buyers', authenticateToken, (req, res) => {
    try {
        const itemId = parseInt(req.params.itemId, 10);
        const item = db.prepare('SELECT owner_id FROM items WHERE id = ?').get(itemId);
        if (!item) return res.status(404).json({ success: false, error: 'Item not found.' });
        if (req.user.id !== item.owner_id) {
            return res.status(403).json({ success: false, error: 'Only item owner can view buyer list.' });
        }

        const buyers = db.prepare(`
            SELECT DISTINCT cm.buyer_id, u.name as buyer_name, MAX(cm.sent_at) as last_activity
            FROM chat_messages cm
            JOIN users u ON cm.buyer_id = u.id
            WHERE cm.item_id = ?
            GROUP BY cm.buyer_id
            ORDER BY last_activity DESC
        `).all(itemId);

        res.json({ success: true, buyers });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch buyers.' });
    }
});

// GET /api/chat/:itemId/history?buyerId=<id>
// Returns last 50 messages for a chat room. Both buyer and item-owner can access.
app.get('/api/chat/:itemId/history', authenticateToken, (req, res) => {
    try {
        const itemId = parseInt(req.params.itemId, 10);
        const buyerId = parseInt(req.query.buyerId, 10);
        if (!itemId || !buyerId) return res.status(400).json({ success: false, error: 'itemId and buyerId are required.' });

        // Security: only the buyer or the item owner may read this room
        const item = db.prepare('SELECT owner_id FROM items WHERE id = ?').get(itemId);
        if (!item) return res.status(404).json({ success: false, error: 'Item not found.' });

        if (req.user.id !== buyerId && req.user.id !== item.owner_id) {
            return res.status(403).json({ success: false, error: 'You are not part of this conversation.' });
        }

        const room = `item_${itemId}_buyer_${buyerId}`;
        const messages = db.prepare(
            'SELECT * FROM chat_messages WHERE room = ? ORDER BY id ASC LIMIT 50'
        ).all(room);

        res.json({ success: true, room, messages });
    } catch (err) {
        console.error('Chat history error:', err);
        res.status(500).json({ success: false, error: 'Failed to load messages.' });
    }
});

// ==========================================
// SOCKET.IO — Real-Time Chat
// ==========================================

// Middleware: authenticate socket connection via token query param
io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token || !activeTokens.has(token)) {
        return next(new Error('Authentication required. Please log in.'));
    }
    socket.user = activeTokens.get(token);   // attach user to socket
    next();
});

io.on('connection', (socket) => {
    console.log(`💬 Chat connected: ${socket.user.name} (id=${socket.user.id})`);

    // Join user-specific notification room
    socket.join(`user_${socket.user.id}`);

    // JOIN ROOM — client sends { itemId, buyerId }
    socket.on('join_room', ({ itemId, buyerId }) => {
        itemId  = parseInt(itemId,  10);
        buyerId = parseInt(buyerId, 10);
        if (!itemId || !buyerId) return;

        // Only buyer or seller may join
        const item = db.prepare('SELECT owner_id FROM items WHERE id = ?').get(itemId);
        if (!item) return socket.emit('chat_error', 'Item not found.');
        if (socket.user.id !== buyerId && socket.user.id !== item.owner_id) {
            return socket.emit('chat_error', 'You are not part of this conversation.');
        }

        const room = `item_${itemId}_buyer_${buyerId}`;
        socket.join(room);
        socket.currentRoom = room;
        console.log(`  → ${socket.user.name} joined room [${room}]`);
        socket.emit('room_joined', { room });
    });

    // SEND MESSAGE — client sends { message }
    socket.on('send_message', ({ message }) => {
        const room = socket.currentRoom;
        if (!room || !message || !message.trim()) return;

        const match = room.match(/^item_(\d+)_buyer_(\d+)$/);
        const itemId = match ? parseInt(match[1], 10) : null;
        const buyerId = match ? parseInt(match[2], 10) : null;

        const text = message.trim().slice(0, 500); // cap at 500 chars
        const row = db.prepare(
            'INSERT INTO chat_messages (room, item_id, buyer_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(room, itemId, buyerId, socket.user.id, socket.user.name, text);

        const payload = {
            id:          row.lastInsertRowid,
            room,
            sender_id:   socket.user.id,
            sender_name: socket.user.name,
            message:     text,
            sent_at:     new Date().toISOString()
        };

        // Broadcast to everyone in the room (including sender)
        io.to(room).emit('new_message', payload);

        // Notify chat recipient
        try {
            if (itemId && buyerId) {
                const item = db.prepare('SELECT owner_id, title FROM items WHERE id = ?').get(itemId);
                if (item) {
                    const recipientId = socket.user.id === buyerId ? item.owner_id : buyerId;
                    if (recipientId && recipientId !== socket.user.id) {
                        createNotification(
                            recipientId,
                            'chat',
                            `💬 Message from ${socket.user.name}`,
                            text.length > 50 ? text.slice(0, 47) + '...' : text,
                            'account.html#myChatsSection'
                        );
                    }
                }
            }
        } catch (notifErr) {
            console.error('Failed to create chat notification:', notifErr);
        }
    });

    // TYPING INDICATOR — client sends {} when user is typing
    socket.on('typing', () => {
        const room = socket.currentRoom;
        if (room) {
            socket.to(room).emit('user_typing', { name: socket.user.name });
        }
    });

    socket.on('disconnect', () => {
        console.log(`💬 Chat disconnected: ${socket.user.name}`);
    });
});

// ==========================================
// AI CAMPUS ASSISTANT (DashBot) ENGINE
// ==========================================

function generateBuiltinAIResponse(query, userName) {
    const q = query.toLowerCase().trim();

    // 1. GREETINGS & INTRO
    if (/^(hi|hello|hey|yo|hola|greetings|good\s*(morning|afternoon|evening)|who are you|what can you do)/i.test(q)) {
        return {
            reply: `Hey **${userName}**! 👋 I'm **DashBot**, your campus AI assistant for DashDrop. Here's how I can help you today:\n\n` +
                   `• 🔍 **Search Items:** Ask *"Find books in Block A"* or *"Show electronics under ₹1500"*\n` +
                   `• 💰 **Price Advice:** Ask *"How much should I sell a cycle for?"* or *"Price for engineering books"*\n` +
                   `• 📝 **Draft Listings:** Ask *"Write description to sell my study lamp"*\n` +
                   `• ⏰ **Rental Rules:** Ask *"How do rentals work?"* or *"How to extend an overdue item"*\n` +
                   `• 📍 **Campus Safety:** Ask *"Where is the safest place to hand off items?"*\n\n` +
                   `What would you like to explore?`
        };
    }

    // 2. PRICING ADVICE & VALUATION
    if (/\b(how much|price|charge|sell for|worth|cost|pricing|rate)\b/i.test(q) && !/\b(under|less than|below)\b/i.test(q)) {
        let advice = '';
        if (/\b(cycle|bicycle|bike)\b/i.test(q)) {
            advice = `🚲 **Campus Pricing for Cycles:**\n\n` +
                     `• **Single-Speed Standard Cycle:** ₹1,200 – ₹1,800 (quick seller on campus)\n` +
                     `• **Geared / Mountain Bike (Hero/Btwin):** ₹2,200 – ₹3,500\n\n` +
                     `💡 *Tip: Mention recent tire or brake checks and whether a lock/key is included to sell faster in hostel blocks!*`;
        } else if (/\b(calculator|calc|casio)\b/i.test(q)) {
            advice = `🔢 **Scientific Calculator Pricing:**\n\n` +
                     `• **Casio fx-991EX ClassWiz / fx-991CW:** ₹600 – ₹750 (MRP ~₹1,200)\n` +
                     `• **Casio fx-82MS / basic scientific:** ₹300 – ₹450\n\n` +
                     `💡 *Tip: Confirm battery health and clear user memory before handing it over to the buyer.*`;
        } else if (/\b(book|textbook|notes|gate|engineering math)\b/i.test(q)) {
            advice = `📚 **Textbook & Academic Notes Pricing:**\n\n` +
                     `• **Standard Semester Textbooks:** 40% – 50% of original MRP (usually ₹150 – ₹350)\n` +
                     `• **GATE / Competitive Exam Guides (Made Easy / Ace):** ₹250 – ₹500\n` +
                     `• **Handwritten Lecture Notes:** ₹100 – ₹200 (or offer as free bonus with books)\n\n` +
                     `💡 *Tip: Mention the exact semester/branch (e.g. CSE Sem 3) in your listing title!*`;
        } else if (/\b(lamp|study lamp|light)\b/i.test(q)) {
            advice = `💡 **Study Lamp Pricing:**\n\n` +
                     `• **Rechargeable LED Desk Lamp:** ₹200 – ₹350\n` +
                     `• **Basic Plug-in Study Lamp:** ₹150 – ₹250\n\n` +
                     `💡 *Tip: Mention battery backup hours during campus power outages.*`;
        } else if (/\b(mattress|gadda|bed)\b/i.test(q)) {
            advice = `🪑 **Hostel Bedding & Mattress:**\n\n` +
                     `• **Single Hostel Mattress (Good Foam):** ₹600 – ₹1,200\n` +
                     `• **Foldable Cotton Mattress:** ₹400 – ₹700\n\n` +
                     `💡 *Tip: Clean and wrap in a cover for easy hostel transport.*`;
        } else if (/\b(guitar|instrument|music)\b/i.test(q)) {
            advice = `🎸 **Acoustic Guitar Pricing:**\n\n` +
                     `• **Beginner Acoustic (Juarez/Intern):** ₹1,400 – ₹2,200\n` +
                     `• **Brand Model (Yamaha F310/Fender):** ₹3,500 – ₹5,500\n\n` +
                     `💡 *Tip: Mention if gig bag, pick, and extra strings are included.*`;
        } else if (/\b(drafter|mini drafter|drawing board)\b/i.test(q)) {
            advice = `📐 **Engineering Drafter & Kit:**\n\n` +
                     `• **Mini Drafter + Sheet Container:** ₹250 – ₹400 (MRP ~₹700)\n` +
                     `• **Full Engineering Drawing Set:** ₹400 – ₹600\n\n` +
                     `💡 *Tip: Highly in-demand with 1st year engineering juniors each semester!*`;
        } else {
            advice = `💰 **DashDrop Student Pricing Rule of Thumb:**\n\n` +
                     `• **Like New (Used < 1 sem):** 60% – 70% of current retail price\n` +
                     `• **Good Condition (Functional):** 40% – 55% of retail price\n` +
                     `• **Fair / Well-Used:** 25% – 35% of retail price\n\n` +
                     `Want specific guidance? Tell me the exact item (e.g. *"Price for Dell laptop"* or *"Price for boat headphones"*).`;
        }

        return { reply: advice };
    }

    // 3. LISTING DESCRIPTION GENERATOR
    if (/\b(write|draft|generate|create|help me sell)\b/i.test(q) && /\b(description|listing|post|ad)\b/i.test(q)) {
        const cleanItem = q.replace(/.*(for|about|selling)\s+/i, '')
                           .replace(/(description|listing|post|write|draft|generate|help me sell)/gi, '')
                           .trim() || 'Pre-loved Campus Item';
        const capitalizedItem = cleanItem.charAt(0).toUpperCase() + cleanItem.slice(1);

        return {
            reply: `📝 **Generated Listing Template for "${capitalizedItem}":**\n\n` +
                   `**Title:** ${capitalizedItem} - Gently Used & In Great Working Condition\n\n` +
                   `**Description:**\n` +
                   `> *"Selling my ${cleanItem} as I am wrapping up this semester. Kept very cleanly in the hostel and 100% functional with zero defects. Perfect for students looking for a reliable deal without paying full store prices."*\n\n` +
                   `**Key Details to Include:**\n` +
                   `• **Condition:** Like New / Good\n` +
                   `• **Included:** Main unit + all accessories/cables\n` +
                   `• **Pickup:** Available for quick handoff at Hostel Block lobby or Central Library\n` +
                   `• **Payment:** UPI (GPay/PhonePe) or Cash on pickup\n\n` +
                   `🚀 *You can copy this directly and paste it into the [Sell Item Page](sell.html)!*`
        };
    }

    // 4. RENTAL & OVERDUE POLICIES
    if (/\b(rental|rent|overdue|extend|return|deposit|late fee|borrow)\b/i.test(q)) {
        return {
            reply: `⏰ **How Campus Rentals Work on DashDrop:**\n\n` +
                   `1. **Browse & Rent:** Head to the [Rent Page](rent.html) to choose items available for short-term student borrowing (e.g. guitars, study lamps, laptops).\n` +
                   `2. **Track in Real-Time:** Go to **Account Details > Active Rentals** to monitor days remaining.\n` +
                   `3. **Need More Time?** Click **"Extend Rental (+3 Days)"** before the due date.\n` +
                   `4. **Return Item:** When returning, click **"Return Item"** to mark the item returned.\n` +
                   `5. **Overdue Reminders:** Our system and campus admins will send you in-app notifications if an item is past its due date to keep the peer network fair for everyone!`
        };
    }

    // 5. SAFETY & HANDOFF RECOMMENDATIONS
    if (/\b(safe|safety|scam|meet|handoff|location|where to meet|spot)\b/i.test(q)) {
        return {
            reply: `🛡️ **Safe Campus Handoff Guidelines:**\n\n` +
                   `• **Central Library Entrance:** Best well-lit public spot with campus security.\n` +
                   `• **Student Union / Cafeteria:** Convenient during daytime and lunch hours.\n` +
                   `• **Hostel Block Ground Lobby:** Ideal for intra-hostel exchanges.\n` +
                   `• **Inspection First:** Always inspect electronics, test power/chargers, and check textbooks before sending UPI payments.\n` +
                   `• **Use DashDrop Chat:** Keep conversation inside our built-in real-time chat so you have a verifiable record.`
        };
    }

    // 6. DATABASE ITEM SEARCH
    let searchSql = "SELECT id, name, category, price, icon, hostel_block, condition, description, contact FROM items WHERE status = 'available'";
    const params = [];
    let isSearch = false;

    // Detect budget
    const priceMatch = q.match(/(?:under|below|less than|<|budget of)\s*(?:rs\.?|inr|₹)?\s*(\d+)/i);
    if (priceMatch) {
        searchSql += ' AND price <= ?';
        params.push(parseInt(priceMatch[1], 10));
        isSearch = true;
    }

    // Detect hostel block
    const blockMatch = q.match(/\b(block\s*[a-e]|academic|library|pg)\b/i);
    if (blockMatch) {
        searchSql += ' AND LOWER(hostel_block) LIKE ?';
        params.push(`%${blockMatch[1].toLowerCase().replace(/\s+/, ' ')}%`);
        isSearch = true;
    }

    // Extract item keywords
    const searchKeywords = ['laptop', 'book', 'books', 'headphone', 'headphones', 'chair', 'jacket', 'drafter', 'air pods', 'airpods', 'guitar', 'lamp', 'cycle', 'drawing', 'electronics', 'furniture', 'clothes', 'academic'];
    for (const kw of searchKeywords) {
        if (q.includes(kw)) {
            searchSql += ' AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)';
            params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
            isSearch = true;
            break;
        }
    }

    if (isSearch || /\b(find|search|show|buy|need|looking for|get|where can i find)\b/i.test(q)) {
        searchSql += ' ORDER BY id DESC LIMIT 5';
        const matchedItems = db.prepare(searchSql).all(...params);

        if (matchedItems && matchedItems.length > 0) {
            let responseText = `🔍 **I found ${matchedItems.length} matching item${matchedItems.length > 1 ? 's' : ''} on campus:**\n\n`;
            for (const item of matchedItems) {
                responseText += `• **${item.name}** — ₹${item.price.toLocaleString()} (${item.hostel_block || 'Campus'})\n` +
                                `  *Condition: ${item.condition}* | Contact: ${item.contact}\n`;
            }
            responseText += `\n💬 *You can view full details or chat with sellers on the [Items Page](items.html).*`;

            return {
                reply: responseText,
                items: matchedItems
            };
        } else {
            return {
                reply: `🔍 I searched active listings for "${query}", but couldn't find an exact match available right now.\n\n` +
                       `💡 **Tips:**\n` +
                       `• Check out all campus listings on the [Items Page](items.html)\n` +
                       `• Try adjusting your price filter or hostel block\n` +
                       `• Or post a "Looking to Buy" query to your hostel group!`
            };
        }
    }

    // 7. DEFAULT FRIENDLY FALLBACK
    return {
        reply: `I hear you! As your campus AI assistant, I can help you find items, estimate prices, draft listings, or navigate campus rentals.\n\n` +
               `Try asking me something like:\n` +
               `• *"Show me electronics under ₹1500"*\n` +
               `• *"How much should I charge for a study table?"*\n` +
               `• *"Write a listing description for a bicycle"*\n` +
               `• *"What happens if my rental is overdue?"*`
    };
}

// POST /api/ai/chat — Conversational AI Campus Assistant
app.post('/api/ai/chat', optionalAuth, async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
        }

        const query = message.trim();
        const userName = req.user ? req.user.name.split(' ')[0] : 'Student';

        // 1. Google Gemini API Integration if API key is provided in environment
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (apiKey) {
            try {
                const activeItems = db.prepare("SELECT id, name, category, price, hostel_block, condition FROM items WHERE status = 'available' LIMIT 15").all();
                const systemPrompt = `You are DashBot, an intelligent and friendly AI campus marketplace assistant for DashDrop.
You help college students buy, sell, rent, find items across hostel blocks (Block A to E), price used items fairly, write good listing descriptions, and explain rental rules.
Be concise, helpful, friendly, and use relevant emojis. Use Indian Rupee (₹) for prices.
Current active items in DashDrop database: ${JSON.stringify(activeItems)}.
If recommending an item from the list, mention its name, price, and block.`;

                const contents = [];
                if (Array.isArray(history)) {
                    for (const h of history.slice(-6)) {
                        contents.push({
                            role: h.sender === 'user' ? 'user' : 'model',
                            parts: [{ text: h.text }]
                        });
                    }
                }
                contents.push({ role: 'user', parts: [{ text: query }] });

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        contents
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (reply) {
                        return res.json({ success: true, reply, source: 'gemini' });
                    }
                }
            } catch (geminiErr) {
                console.warn('Gemini API call failed, falling back to built-in campus assistant:', geminiErr.message);
            }
        }

        // 2. High-Accuracy Built-in Campus Intelligence
        const replyObj = generateBuiltinAIResponse(query, userName);
        return res.json({ success: true, ...replyObj, source: 'builtin' });
    } catch (err) {
        console.error('AI chat error:', err);
        res.status(500).json({ success: false, error: 'AI Assistant temporarily unavailable.' });
    }
});

// ==========================================
// START HTTP SERVER (Socket.IO needs httpServer, not app.listen)
// ==========================================
httpServer.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 DashDrop RBAC Backend Server is Running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`📂 Frontend served at: http://localhost:${PORT}/index.html`);
    console.log(`💬 Socket.IO real-time chat: enabled`);
    console.log(`🔐 Roles configured: 'student' (default), 'admin'`);
    console.log(`===============================================`);
});

module.exports = { app, httpServer, io };


