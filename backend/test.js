// ==========================================
// DashDrop - Automated Test Suite
// Using Node.js Native Test Runner (node:test & node:assert)
// ==========================================

const { test, describe, before } = require('node:test');
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
});
