// ==========================================
// DashDrop - Automated Test Suite
// Using Node.js Native Test Runner (node:test & node:assert)
// ==========================================

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = 'http://localhost:5000/api';

describe('DashDrop API Automated Test Suite', () => {
    let studentToken = '';
    let adminToken = '';
    let createdItemId = null;

    // Helper fetch wrapper
    async function api(path, options = {}) {
        const url = `${BASE_URL}${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        const json = await res.json().catch(() => null);
        return { status: res.status, ok: res.ok, json };
    }

    // 1. Health Check
    test('1. Health check returns status online', async () => {
        const { status, json } = await api('/health');
        assert.equal(status, 200);
        assert.equal(json.status, 'online');
        assert.equal(json.database, 'SQLite (native node:sqlite)');
    });

    // 2. Authentication: Student Login
    test('2. Student login returns valid token and role=student', async () => {
        const { status, json } = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'surya@college.edu', password: 'Student@123' })
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.token);
        assert.equal(json.user.role, 'student');
        studentToken = json.token;
    });

    // 3. Authentication: Admin Login
    test('3. Admin login returns valid token and role=admin', async () => {
        const { status, json } = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'admin@campus.edu', password: 'Admin@123' })
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.token);
        assert.equal(json.user.role, 'admin');
        adminToken = json.token;
    });

    // 4. Authentication: Invalid Credentials
    test('4. Login with wrong password returns 401', async () => {
        const { status, json } = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'surya@college.edu', password: 'WrongPassword' })
        });
        assert.equal(status, 401);
        assert.equal(json.success, false);
    });

    // 5. Auth Profile (/api/auth/me)
    test('5. GET /api/auth/me returns current user info with token', async () => {
        const { status, json } = await api('/auth/me', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.equal(json.user.email, 'surya@college.edu');
    });

    // 6. Pagination & Filtering on Items
    test('6. GET /api/items supports pagination structure', async () => {
        const { status, json } = await api('/items?page=1&limit=3');
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.pagination);
        assert.equal(json.pagination.page, 1);
        assert.equal(json.pagination.limit, 3);
        assert.ok(json.pagination.totalItems >= 1);
        assert.ok(json.data.length <= 3);
    });

    // 7. Search Filter on Items
    test('7. GET /api/items filters by category', async () => {
        const { status, json } = await api('/items?category=books');
        assert.equal(status, 200);
        assert.equal(json.success, true);
        for (const item of json.data) {
            assert.equal(item.category.toLowerCase(), 'books');
        }
    });

    // 8. CRUD: Student Creates Item
    test('8. Student creates a new item listing', async () => {
        const { status, json } = await api('/items', {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({
                name: 'Automated Test Textbook',
                category: 'books',
                price: 150,
                condition: 'good',
                description: 'Created by automated test suite',
                contact: 'Test Suite Hostel 101'
            })
        });
        assert.equal(status, 201);
        assert.equal(json.success, true);
        assert.ok(json.data.id);
        createdItemId = json.data.id;
    });

    // 9. CRUD: Read Single Item
    test('9. GET /api/items/:id retrieves the created item', async () => {
        assert.ok(createdItemId);
        const { status, json } = await api(`/items/${createdItemId}`);
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.equal(json.data.name, 'Automated Test Textbook');
    });

    // 10. RBAC Protection: Student Cannot Access Admin Dashboard
    test('10. RBAC: Student cannot access Admin Dashboard (returns 403 Forbidden)', async () => {
        const { status, json } = await api('/admin/dashboard', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 403);
        assert.equal(json.success, false);
    });

    // 11. RBAC: Admin Successfully Accesses Admin Dashboard
    test('11. RBAC: Admin successfully accesses Admin Dashboard', async () => {
        const { status, json } = await api('/admin/dashboard', {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.stats.totalUsers >= 2);
        assert.ok(Array.isArray(json.users));
        assert.ok(Array.isArray(json.logs));
    });

    // 12. Rentals: Place Rental
    test('12. Place rental request creates active record', async () => {
        const { status, json } = await api('/rentals', {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({
                item_name: 'Test Rental Bicycle',
                category: 'mobility',
                daily_price: 50,
                days: 3
            })
        });
        assert.equal(status, 201);
        assert.equal(json.success, true);
        assert.equal(json.rental.total_price, 150);
    });

    // 13. CRUD + RBAC: Admin Deletes Listing
    test('13. RBAC Moderation: Admin deletes the created item listing', async () => {
        assert.ok(createdItemId);
        const { status, json } = await api(`/items/${createdItemId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);

        // Verify it is gone
        const verify = await api(`/items/${createdItemId}`);
        assert.equal(verify.status, 404);
    });

    // 14. Chat: Retrieve Chat History for an Item
    test('14. Buyer or Seller can retrieve chat history for an item', async () => {
        // Items table seeded with item 1 (Dell laptop, owned by Surya id=2)
        const { status, json } = await api('/chat/1/history?buyerId=1', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.equal(json.room, 'item_1_buyer_1');
        assert.ok(Array.isArray(json.messages));
    });

    // 15. Chat: Get User Active Conversations
    test('15. GET /api/chat/conversations returns list of active conversations', async () => {
        const { status, json } = await api('/chat/conversations', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(Array.isArray(json.conversations));
    });

    // 16. Chat Security: Non-participant cannot access private chat room
    test('16. Chat Security: Non-participant cannot read private buyer-seller chat (returns 403)', async () => {
        // Dell laptop is item 1, owned by Surya (id=2).
        // Let's test with a room between buyerId=999 and another owner where Admin (id=1) is neither buyer nor owner.
        // Wait, for item 1, owner is Surya (id=2). If buyerId is 999, Admin (id=1) is neither buyer (999) nor owner (2).
        const { status, json } = await api('/chat/1/history?buyerId=999', {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(status, 403);
        assert.equal(json.success, false);
    });

    // 17. Rental Return Tracker Overview Stats
    test('17. GET /api/rentals/overview returns tracker metrics and stats', async () => {
        const { status, json } = await api('/rentals/overview', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.stats);
        assert.ok(typeof json.stats.totalRentals === 'number');
        assert.ok(Array.isArray(json.alerts));
    });

    // 18. Extend Rental Request
    test('18. Student extends active rental by 3 days', async () => {
        const rentalsRes = await api('/rentals', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.ok(rentalsRes.json.data.length > 0);
        const targetRental = rentalsRes.json.data[0];

        const { status, json } = await api(`/rentals/${targetRental.id}/extend`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({ extra_days: 3 })
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.newDueDate);
    });

    // 19. Send Overdue Reminder Notice
    test('19. Admin dispatches overdue return reminder notice', async () => {
        const rentalsRes = await api('/rentals', {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.ok(rentalsRes.json.data.length > 0);
        const targetRental = rentalsRes.json.data[0];

        const { status, json } = await api(`/rentals/${targetRental.id}/remind`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.remindedAt);
    });

    // 20. Process Rental Return
    test('20. Student returns rented item successfully', async () => {
        const rentalsRes = await api('/rentals', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        const activeRental = rentalsRes.json.data.find(r => r.status !== 'returned') || rentalsRes.json.data[0];

        const { status, json } = await api(`/rentals/${activeRental.id}/return`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.returnedAt);
    });

    // 21. Hostel/Block Filter on Marketplace Items
    test('21. GET /api/items filters by hostel_block', async () => {
        const blocksRes = await api('/items/blocks');
        const activeBlock = blocksRes.json?.blocks?.find(b => b.name !== 'All Blocks' && b.count > 0);
        const blockName = activeBlock ? activeBlock.name : 'Block A';

        const { status, json } = await api(`/items?hostel_block=${encodeURIComponent(blockName)}`);
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.data.length >= 1);
        for (const item of json.data) {
            assert.equal(item.hostel_block.toLowerCase(), blockName.toLowerCase());
        }
    });

    // 22. Get Hostel Blocks Summary
    test('22. GET /api/items/blocks returns available blocks and counts', async () => {
        const { status, json } = await api('/items/blocks');
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(Array.isArray(json.blocks));
        assert.ok(json.blocks.some(b => b.name === 'All Blocks'));
        assert.ok(json.total >= 1);
    });

    // 23. Create Item with Specific Hostel Block
    test('23. Student creates listing with specific hostel_block', async () => {
        const { status, json } = await api('/items', {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({
                name: 'Hostel Filter Test Desk Lamp',
                category: 'electronics',
                price: 250,
                condition: 'like-new',
                description: 'Testing hostel filter location tagging',
                contact: 'Block C, Room 410',
                hostel_block: 'Block C'
            })
        });
        assert.equal(status, 201);
        assert.equal(json.success, true);
        assert.equal(json.data.hostel_block, 'Block C');

        // Cleanup the test item
        if (json.data.id) {
            await api(`/items/${json.data.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${adminToken}` }
            });
        }
    });

    // 24. In-App Notifications: Get Notifications
    test('24. GET /api/notifications returns user notifications and unread count', async () => {
        const { status, json } = await api('/notifications', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(Array.isArray(json.notifications));
        assert.equal(typeof json.unreadCount, 'number');
    });

    // 25. In-App Notifications: Mark Single Notification as Read
    test('25. PUT /api/notifications/:id/read marks notification as read', async () => {
        const listRes = await api('/notifications', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(listRes.status, 200);
        const unread = listRes.json.notifications.find(n => n.is_read === 0);
        if (unread) {
            const { status, json } = await api(`/notifications/${unread.id}/read`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${studentToken}` }
            });
            assert.equal(status, 200);
            assert.equal(json.success, true);
            assert.equal(typeof json.unreadCount, 'number');
        } else {
            assert.ok(true);
        }
    });

    // 26. In-App Notifications: Mark All as Read
    test('26. PUT /api/notifications/read-all marks all user notifications as read', async () => {
        const { status, json } = await api('/notifications/read-all', {
            method: 'PUT',
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.equal(json.unreadCount, 0);

        // Verify unread count is now 0
        const check = await api('/notifications', {
            headers: { Authorization: `Bearer ${studentToken}` }
        });
        assert.equal(check.json.unreadCount, 0);
    });

    // 27. AI Campus Assistant: Item Discovery & Database Search
    test('27. POST /api/ai/chat finds items in database based on natural language query', async () => {
        const { status, json } = await api('/ai/chat', {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({ message: 'Find books on campus' })
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.reply);
        assert.ok(Array.isArray(json.items));
        assert.ok(json.items.length >= 1);
        assert.ok(json.items.some(i => i.name.toLowerCase().includes('book')));
    });

    // 28. AI Campus Assistant: Pricing Advice
    test('28. POST /api/ai/chat provides intelligent campus pricing recommendations', async () => {
        const { status, json } = await api('/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ message: 'How much should I sell a cycle for on campus?' })
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.reply.includes('₹'));
        assert.ok(json.reply.toLowerCase().includes('cycle'));
    });

    // 29. AI Campus Assistant: Listing Generator
    test('29. POST /api/ai/chat generates structured listing description for sellers', async () => {
        const { status, json } = await api('/ai/chat', {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({ message: 'Write description to sell my study lamp' })
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(json.reply.toLowerCase().includes('study lamp'));
        assert.ok(json.reply.includes('Title:'));
        assert.ok(json.reply.includes('Description:'));
    });

    // 30. Admin Block Management: Rename Block Name
    test('30. Admin renames a campus block and cascades to items', async () => {
        const testName = 'Test Block ' + Date.now();
        const renamedName = 'Renamed Block ' + Date.now();

        // Add a test block first
        await api('/admin/blocks', {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ name: testName })
        });

        // Rename the block
        const { status, json } = await api('/admin/blocks/rename', {
            method: 'PUT',
            headers: { Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ oldName: testName, newName: renamedName })
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.equal(json.newName, renamedName);

        // Verify in blocks list
        const list = await api('/admin/blocks', {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.ok(list.json.blocks.some(b => b.name === 'Renamed Block Z'));
    });

    // 31. Admin Seller Moderation: Fetch Sellers List
    test('31. Admin retrieves list of sellers for moderation', async () => {
        const { status, json } = await api('/admin/sellers', {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(status, 200);
        assert.equal(json.success, true);
        assert.ok(Array.isArray(json.sellers));
        assert.ok(json.sellers.some(s => s.email === 'surya@college.edu'));
    });

    // 32. Admin Seller Moderation: Block Seller
    test('32. Admin blocks a seller and seller is prevented from listing items', async () => {
        const sellersRes = await api('/admin/sellers', {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const surya = sellersRes.json.sellers.find(s => s.email === 'surya@college.edu');
        assert.ok(surya);

        // Block Surya
        const blockRes = await api(`/admin/sellers/${surya.id}/block`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ is_blocked: 1 })
        });
        assert.equal(blockRes.status, 200);
        assert.equal(blockRes.json.success, true);
        assert.equal(blockRes.json.is_blocked, 1);

        // Surya tries to create an item while blocked -> should be 403 Forbidden
        const postRes = await api('/items', {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({
                name: 'Forbidden Item',
                category: 'electronics',
                price: 100,
                condition: 'fair',
                contact: 'Room 101'
            })
        });
        assert.equal(postRes.status, 403);
        assert.equal(postRes.json.success, false);
    });

    // 33. Admin Seller Moderation: Unblock Seller
    test('33. Admin unblocks the seller and seller can list items again', async () => {
        const sellersRes = await api('/admin/sellers', {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const surya = sellersRes.json.sellers.find(s => s.email === 'surya@college.edu');
        assert.ok(surya);

        // Unblock Surya
        const unblockRes = await api(`/admin/sellers/${surya.id}/block`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ is_blocked: 0 })
        });
        assert.equal(unblockRes.status, 200);
        assert.equal(unblockRes.json.success, true);
        assert.equal(unblockRes.json.is_blocked, 0);

        // Surya can create listing again
        const postRes = await api('/items', {
            method: 'POST',
            headers: { Authorization: `Bearer ${studentToken}` },
            body: JSON.stringify({
                name: 'Unblocked Seller Item',
                category: 'electronics',
                price: 150,
                condition: 'good',
                contact: 'Room 101'
            })
        });
        assert.equal(postRes.status, 201);
        assert.equal(postRes.json.success, true);

        // Clean up created item
        if (postRes.json.data && postRes.json.data.id) {
            await api(`/items/${postRes.json.data.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${adminToken}` }
            });
        }
    });
});

