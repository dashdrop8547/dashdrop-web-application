/* =======================================================
   DashDrop - Main JavaScript Application
   Campus Peer-to-Peer Marketplace with Authentication & RBAC
   Connected to backend API at http://localhost:5000
   ======================================================= */

// -------------------------------------------------------
// CONFIG & AUTH STATE
// -------------------------------------------------------
// Auto-detect production host or fallback to localhost
const API = (window.location.protocol.startsWith('http') && window.location.port !== '5500')
    ? `${window.location.origin}/api`
    : 'http://localhost:5000/api';

function getAuthToken() {
    return localStorage.getItem('dashdrop_token');
}

function getCurrentUser() {
    try {
        const u = localStorage.getItem('dashdrop_user');
        return u ? JSON.parse(u) : null;
    } catch (_) {
        return null;
    }
}

function setAuthSession(token, user) {
    localStorage.setItem('dashdrop_token', token);
    localStorage.setItem('dashdrop_user', JSON.stringify(user));
}

function clearAuthSession() {
    localStorage.removeItem('dashdrop_token');
    localStorage.removeItem('dashdrop_user');
}

function getAuthHeaders(includeContentType = true) {
    const headers = {};
    if (includeContentType) headers['Content-Type'] = 'application/json';
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------

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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function maskPhone(phone) {
    if (!phone || phone === 'Not provided') return 'Not provided';
    const str = String(phone).trim();
    const digits = str.replace(/\D/g, '');
    if (digits.length >= 10) {
        const last10 = digits.slice(-10);
        return `${last10.slice(0, 5)}XXXXX`;
    }
    if (str.length > 5) {
        return str.slice(0, 5) + 'X'.repeat(Math.max(4, str.length - 5));
    }
    return str + 'XXXXX';
}

function maskEmail(email) {
    if (!email) return '';
    const str = String(email).trim();
    const atIndex = str.indexOf('@');
    if (atIndex <= 1) return str;
    const userPart = str.slice(0, atIndex);
    const domainPart = str.slice(atIndex);
    const visibleChars = Math.min(2, userPart.length);
    const maskedLength = Math.max(4, userPart.length - visibleChars);
    return `${userPart.slice(0, visibleChars)}${'X'.repeat(maskedLength)}${domainPart}`;
}

function showFormFeedback(elementId, message, type) {
    const feedback = document.getElementById(elementId);
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `form-feedback ${type}`;
    feedback.style.display = 'block';
}

function goToItems() {
    window.location.href = 'items.html';
}

// Update Top Navigation Bar according to Login State & Role
function updateNavbarAuthUI() {
    const user = getCurrentUser();
    const loginBtns = document.querySelectorAll('.login-btn');
    const navs = document.querySelectorAll('.navbar nav');
    const headers = document.querySelectorAll('.navbar');

    loginBtns.forEach(btn => {
        if (user) {
            btn.innerHTML = `${user.role === 'admin' ? '🛡️ Admin' : '👤'} ${escapeHtml(user.name.split(' ')[0])}`;
            btn.title = `Logged in as ${user.email} (${user.role})`;
            btn.onclick = () => { window.location.href = 'account.html'; };
        } else {
            btn.textContent = 'Login';
            btn.onclick = () => openAuthModal('login');
        }
    });

    // Ensure any legacy admin-panel link is removed from navbar
    document.querySelectorAll('.admin-link').forEach(el => el.remove());

    // Manage Notification Bell Icon in navbar
    headers.forEach(header => {
        let wrapper = header.querySelector('.notification-wrapper');
        if (user) {
            if (!wrapper) {
                const notifHTML = `
                    <div class="notification-wrapper" id="notifWrapper">
                        <button type="button" class="notification-btn" id="notifBellBtn" onclick="toggleNotificationDropdown(event)" aria-label="Notifications" title="Notifications">
                            🔔
                            <span class="notification-badge" id="notifBadge">0</span>
                        </button>
                        <div class="notification-dropdown" id="notifDropdown">
                            <div class="notification-header">
                                <h4 class="notification-header-title">🔔 Notifications</h4>
                                <button type="button" class="notification-mark-all" onclick="markAllNotificationsRead(event)">Mark all read</button>
                            </div>
                            <div class="notification-list" id="notifList">
                                <div class="notification-empty">Loading notifications...</div>
                            </div>
                            <div class="notification-footer">
                                <a href="account.html" style="color: #4f46e5; text-decoration: none; font-weight: 500;">View in Account →</a>
                            </div>
                        </div>
                    </div>
                `;
                const btn = header.querySelector('.login-btn');
                if (btn) {
                    btn.insertAdjacentHTML('beforebegin', notifHTML);
                } else {
                    header.insertAdjacentHTML('beforeend', notifHTML);
                }
            }
        } else {
            if (wrapper) wrapper.remove();
        }
    });

    if (user) {
        initGlobalNotificationSocket();
        loadNotifications();
    }
}

// ==========================================
// NOTIFICATION CENTER LOGIC
// ==========================================

let globalNotifSocket = null;
let currentNotifications = [];

function getNotificationIcon(type) {
    switch (type) {
        case 'chat': return '💬';
        case 'purchase': return '🛍️';
        case 'rental_reminder': return '⏰';
        case 'system': return '📢';
        default: return '🔔';
    }
}

function formatNotifTime(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        const diffMs = Date.now() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (_) {
        return '';
    }
}

function initGlobalNotificationSocket() {
    const user = getCurrentUser();
    const token = getAuthToken();
    if (!user || !token || typeof io === 'undefined') return;

    if (globalNotifSocket && globalNotifSocket.connected) return;

    try {
        globalNotifSocket = io({ auth: { token } });
        globalNotifSocket.on('new_notification', (notif) => {
            handleIncomingNotification(notif);
        });
    } catch (err) {
        console.warn('Socket.IO notification error:', err);
    }
}

function handleIncomingNotification(notif) {
    currentNotifications.unshift(notif);
    renderNotificationList(currentNotifications);

    const badges = document.querySelectorAll('.notification-badge');
    badges.forEach(badge => {
        const currentCount = parseInt(badge.textContent, 10) || 0;
        const newCount = currentCount + 1;
        badge.textContent = newCount > 99 ? '99+' : newCount;
        badge.classList.add('visible');
    });
}

async function loadNotifications() {
    const user = getCurrentUser();
    const token = getAuthToken();
    if (!user || !token) return;

    try {
        const res = await fetch(`${API}/notifications?limit=20`, {
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            currentNotifications = data.notifications || [];
            updateNotificationBadge(data.unreadCount || 0);
            renderNotificationList(currentNotifications);
        }
    } catch (err) {
        console.error('Failed to load notifications:', err);
    }
}

function updateNotificationBadge(unreadCount) {
    const badges = document.querySelectorAll('.notification-badge');
    badges.forEach(badge => {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.classList.add('visible');
        } else {
            badge.textContent = '0';
            badge.classList.remove('visible');
        }
    });
}

function renderNotificationList(notifications) {
    const lists = document.querySelectorAll('#notifList');
    lists.forEach(list => {
        if (!notifications || notifications.length === 0) {
            list.innerHTML = `
                <div class="notification-empty">
                    <div class="notification-empty-icon">🔕</div>
                    <p style="margin: 0; font-weight: 500;">No notifications yet</p>
                    <span style="font-size: 11px;">You're all caught up!</span>
                </div>
            `;
            return;
        }

        list.innerHTML = notifications.map(notif => {
            const icon = getNotificationIcon(notif.type);
            const time = formatNotifTime(notif.created_at);
            const unreadClass = notif.is_read ? '' : 'unread';
            const safeTitle = escapeHtml(notif.title);
            const safeMsg = escapeHtml(notif.message);
            const link = notif.link ? escapeHtml(notif.link) : '';

            return `
                <div class="notification-item ${unreadClass}" onclick="onNotificationItemClick(${notif.id}, '${link}')">
                    <div class="notification-icon-box">${icon}</div>
                    <div class="notification-body">
                        <div class="notification-title">${safeTitle}</div>
                        <div class="notification-message">${safeMsg}</div>
                        <div class="notification-time">${time}</div>
                    </div>
                    ${!notif.is_read ? '<span class="notification-dot"></span>' : ''}
                </div>
            `;
        }).join('');
    });
}

function toggleNotificationDropdown(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('notifDropdown');
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('active');
    if (!isOpen) {
        dropdown.classList.add('active');
        loadNotifications();
    } else {
        dropdown.classList.remove('active');
    }
}

async function onNotificationItemClick(id, link) {
    try {
        const dropdown = document.getElementById('notifDropdown');
        if (dropdown) dropdown.classList.remove('active');

        const res = await fetch(`${API}/notifications/${id}/read`, {
            method: 'PUT',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            updateNotificationBadge(data.unreadCount);
            const target = currentNotifications.find(n => n.id === id);
            if (target) target.is_read = 1;
            renderNotificationList(currentNotifications);
        }

        if (link) {
            window.location.href = link;
        }
    } catch (err) {
        console.error('Error handling notification click:', err);
    }
}

async function markAllNotificationsRead(e) {
    if (e) e.stopPropagation();
    try {
        const res = await fetch(`${API}/notifications/read-all`, {
            method: 'PUT',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            updateNotificationBadge(0);
            currentNotifications.forEach(n => { n.is_read = 1; });
            renderNotificationList(currentNotifications);
        }
    } catch (err) {
        console.error('Failed to mark all notifications as read:', err);
    }
}

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notifDropdown');
    const wrapper = document.getElementById('notifWrapper');
    if (dropdown && dropdown.classList.contains('active')) {
        if (wrapper && !wrapper.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    }
});

// -------------------------------------------------------
// MODAL: LOGIN / REGISTER (GLOBAL)
// -------------------------------------------------------

function ensureAuthModalDOM() {
    if (document.getElementById('authModal')) return;

    const modalHTML = `
        <div class="modal-overlay" id="authModal">
            <div class="modal-card" style="max-width: 440px; text-align: left;">
                <button class="modal-close" onclick="closeAuthModal()">&times;</button>
                <div style="text-align: center; margin-bottom: 20px;">
                    <div style="font-size: 38px;">🎓</div>
                    <h3 id="authModalTitle" style="font-size: 22px; color: #1e1b4b; margin-top: 8px;">Login to DashDrop</h3>
                    <p style="font-size: 13px; color: #6b7280;" id="authModalSubtitle">Access campus marketplace, listings & rentals</p>
                </div>

                <!-- Toggle Tabs -->
                <div style="display: flex; gap: 8px; margin-bottom: 20px; background: #e0e7ff; padding: 4px; border-radius: 12px;">
                    <button type="button" id="tabLogin" onclick="switchAuthTab('login')" 
                        style="flex: 1; border: none; padding: 8px; border-radius: 8px; font-weight: 600; cursor: pointer; background: #4f46e5; color: white;">
                        Login
                    </button>
                    <button type="button" id="tabRegister" onclick="switchAuthTab('register')" 
                        style="flex: 1; border: none; padding: 8px; border-radius: 8px; font-weight: 600; cursor: pointer; background: transparent; color: #4338ca;">
                        Register
                    </button>
                </div>

                <!-- Form -->
                <form id="authForm" onsubmit="handleAuthSubmit(event)">
                    <div id="registerFields" style="display: none;">
                        <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">Full Name *</label>
                        <input type="text" id="authName" placeholder="e.g. Surya Sharma" style="width:100%; padding:10px 14px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:12px;">
                        
                        <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">Phone Number</label>
                        <input type="text" id="authPhone" placeholder="+91 98765 43210" style="width:100%; padding:10px 14px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:12px;">

                        <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">College / Campus</label>
                        <input type="text" id="authCollege" placeholder="e.g. Engineering Campus" value="Engineering Campus" style="width:100%; padding:10px 14px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:12px;">
                    </div>

                    <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">College Email *</label>
                    <input type="email" id="authEmail" placeholder="yourname@college.edu" required style="width:100%; padding:10px 14px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:12px;">

                    <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">Password *</label>
                    <input type="password" id="authPassword" placeholder="••••••••" required style="width:100%; padding:10px 14px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:16px;">

                    <button type="submit" id="authSubmitBtn" class="login-btn" style="width:100%; border-radius:8px; padding:12px;">
                        Sign In
                    </button>

                    <div id="authFeedback" class="form-feedback" style="margin-top:14px;"></div>
                </form>

                <div style="margin-top:16px; padding:12px; background:#f9fafb; border-radius:8px; font-size:12px; color:#6b7280;">
                    <b>💡 Quick demo credentials:</b><br>
                    • Student: <code>surya@college.edu</code> / <code>Student@123</code><br>
                    • Admin: <code>admin@campus.edu</code> / <code>Admin@123</code>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modalEl = document.getElementById('authModal');
    modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) closeAuthModal();
    });
}

let currentAuthTab = 'login';

function openAuthModal(mode = 'login') {
    ensureAuthModalDOM();
    switchAuthTab(mode);
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.add('active');
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('active');
}

function switchAuthTab(tab) {
    currentAuthTab = tab;
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const regFields = document.getElementById('registerFields');
    const title = document.getElementById('authModalTitle');
    const subtitle = document.getElementById('authModalSubtitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    const feedback = document.getElementById('authFeedback');

    if (feedback) feedback.style.display = 'none';

    if (tab === 'login') {
        if (tabLogin) { tabLogin.style.background = '#4f46e5'; tabLogin.style.color = '#fff'; }
        if (tabRegister) { tabRegister.style.background = 'transparent'; tabRegister.style.color = '#4338ca'; }
        if (regFields) regFields.style.display = 'none';
        if (title) title.textContent = 'Login to DashDrop';
        if (subtitle) subtitle.textContent = 'Welcome back! Enter your campus account credentials.';
        if (submitBtn) submitBtn.textContent = 'Sign In';
    } else {
        if (tabRegister) { tabRegister.style.background = '#4f46e5'; tabRegister.style.color = '#fff'; }
        if (tabLogin) { tabLogin.style.background = 'transparent'; tabLogin.style.color = '#4338ca'; }
        if (regFields) regFields.style.display = 'block';
        if (title) title.textContent = 'Create Student Account';
        if (subtitle) subtitle.textContent = 'Join the student peer-to-peer campus network.';
        if (submitBtn) submitBtn.textContent = 'Register Account';
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail')?.value.trim();
    const password = document.getElementById('authPassword')?.value;
    const name = document.getElementById('authName')?.value.trim();
    const phone = document.getElementById('authPhone')?.value.trim();
    const college = document.getElementById('authCollege')?.value.trim();

    try {
        if (currentAuthTab === 'login') {
            const res = await fetch(`${API}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (data.success) {
                setAuthSession(data.token, data.user);
                showFormFeedback('authFeedback', `🎉 Welcome back, ${data.user.name}!`, 'success');
                setTimeout(() => {
                    closeAuthModal();
                    updateNavbarAuthUI();
                    if (window.location.pathname.includes('account.html')) {
                        loadAccountData();
                    } else if (window.location.pathname.includes('items.html')) {
                        renderItemsGrid();
                    }
                }, 900);
            } else {
                showFormFeedback('authFeedback', data.error || 'Login failed.', 'error');
            }
        } else {
            if (!name) {
                showFormFeedback('authFeedback', 'Please provide your full name.', 'error');
                return;
            }
            const res = await fetch(`${API}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, phone, college })
            });
            const data = await res.json();
            if (data.success) {
                setAuthSession(data.token, data.user);
                showFormFeedback('authFeedback', '🎉 Registered successfully! Welcome to DashDrop.', 'success');
                setTimeout(() => {
                    closeAuthModal();
                    updateNavbarAuthUI();
                    if (window.location.pathname.includes('account.html')) {
                        loadAccountData();
                    }
                }, 900);
            } else {
                showFormFeedback('authFeedback', data.error || 'Registration failed.', 'error');
            }
        }
    } catch (err) {
        showFormFeedback('authFeedback', 'Cannot connect to backend server. Make sure server is running.', 'error');
    }
}

// -------------------------------------------------------
// ITEMS PAGE (items.html) — with Pagination & RBAC Controls
// -------------------------------------------------------

let selectedCategory = 'all';
let selectedBlock = 'all';
let searchKeyword = '';
let currentPage = 1;
const itemsPerPage = 6;
let currentActiveItem = null;

async function renderItemsGrid(page = currentPage) {
    currentPage = page;
    const grid = document.getElementById('itemsGrid');
    const paginationContainer = document.getElementById('paginationContainer');
    if (!grid) return;

    grid.innerHTML = '<p style="text-align:center;padding:2rem;">Loading items...</p>';
    if (paginationContainer) paginationContainer.innerHTML = '';

    try {
        const params = new URLSearchParams();
        if (selectedCategory !== 'all') params.set('category', selectedCategory);
        if (selectedBlock !== 'all') params.set('hostel_block', selectedBlock);
        if (searchKeyword) params.set('search', searchKeyword);
        params.set('page', currentPage);
        params.set('limit', itemsPerPage);

        const res = await fetch(`${API}/items?${params}`);
        const json = await res.json();

        grid.innerHTML = '';

        if (!json.success || !json.data || json.data.length === 0) {
            grid.innerHTML = `
                <div class="no-items-message">
                    <h3>🔍 No items found</h3>
                    <p>No items matched your filter. Try a different block or keyword!</p>
                </div>
            `;
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        const currentUser = getCurrentUser();

        // Fetch current user's wishlist item IDs to highlight saved hearts
        let userWishlistIds = [];
        if (currentUser) {
            try {
                const wRes = await fetch(`${API}/wishlist/ids`, { headers: getAuthHeaders(false) });
                const wJson = await wRes.json();
                if (wJson.success && Array.isArray(wJson.ids)) {
                    userWishlistIds = wJson.ids;
                }
            } catch (_) {}
        }

        json.data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.style.position = 'relative';
            card.setAttribute('data-category', item.category || 'others');

            const icon = item.icon || categoryIcons[item.category] || '📦';
            const formattedPrice = '₹' + Number(item.price).toLocaleString('en-IN');

            const isOwner = currentUser && item.owner_id === currentUser.id;
            const isAdmin = currentUser && currentUser.role === 'admin';
            const isSaved = userWishlistIds.includes(item.id);

            card.innerHTML = `
                <!-- Wishlist Heart Button -->
                <button type="button" class="wishlist-heart-btn ${isSaved ? 'active' : ''}" 
                    title="${isSaved ? 'Saved in Wishlist' : 'Save to Wishlist'}" 
                    onclick="toggleWishlist(${item.id}, event)">
                    ${isSaved ? '❤️' : '🤍'}
                </button>

                <div class="item-image">${icon}</div>
                <div class="item-info">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:4px; margin-bottom:4px;">
                        <span class="item-block-badge">📍 ${escapeHtml(item.hostel_block || 'Main Campus')}</span>
                    </div>
                    <h2>${escapeHtml(item.name)}</h2>
                    <p>${escapeHtml(item.description || 'No description provided.')}</p>
                    <div class="item-bottom">
                        <span class="price">${formattedPrice}</span>
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="view-btn">View</button>
                            ${(isOwner || isAdmin) ? `<button type="button" class="delete-btn" style="background:#fee2e2; color:#dc2626; border:none; padding:6px 12px; border-radius:16px; cursor:pointer; font-weight:600; font-size:12px;" title="${isAdmin ? 'Admin Delete' : 'Owner Delete'}">🗑️</button>` : ''}
                        </div>
                    </div>
                </div>
            `;

            card.querySelector('.view-btn').addEventListener('click', () => openItemModal(item));

            const delBtn = card.querySelector('.delete-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteItem(item.id, item.name);
                });
            }

            grid.appendChild(card);
        });

        // Render Pagination Controls
        if (paginationContainer && json.pagination) {
            renderPaginationControls(json.pagination, paginationContainer);
        }

    } catch (err) {
        console.error('Failed to load items:', err);
        grid.innerHTML = `
            <div class="no-items-message">
                <h3>⚠️ Could not connect to server</h3>
                <p>Make sure the backend is running at <code>http://localhost:5000</code></p>
            </div>
        `;
    }
}

function renderPaginationControls(pagination, container) {
    const { page, totalPages, totalItems, hasPrev, hasNext } = pagination;
    if (totalPages <= 1) {
        container.innerHTML = `<span style="font-size: 13px; color: #6b7280;">Showing all ${totalItems} item(s)</span>`;
        return;
    }

    let buttonsHTML = `
        <button class="pagination-btn" ${!hasPrev ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} onclick="renderItemsGrid(${page - 1})">
            ← Prev
        </button>
    `;

    for (let p = 1; p <= totalPages; p++) {
        const isActive = p === page;
        buttonsHTML += `
            <button class="pagination-btn ${isActive ? 'active' : ''}" 
                style="${isActive ? 'background:#4f46e5; color:white; font-weight:700;' : ''}" 
                onclick="renderItemsGrid(${p})">
                ${p}
            </button>
        `;
    }

    buttonsHTML += `
        <button class="pagination-btn" ${!hasNext ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} onclick="renderItemsGrid(${page + 1})">
            Next →
        </button>
        <span style="font-size:13px; color:#6b7280; margin-left:8px;">Page ${page} of ${totalPages} (${totalItems} total)</span>
    `;

    container.innerHTML = buttonsHTML;
}

async function deleteItem(itemId, itemName) {
    const user = getCurrentUser();
    if (!user) {
        alert('Please login to delete this listing.');
        openAuthModal('login');
        return;
    }

    if (!confirm(`Are you sure you want to remove listing "${itemName}"?`)) return;

    try {
        const res = await fetch(`${API}/items/${itemId}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ ${data.message}`);
            renderItemsGrid(currentPage);
        } else {
            alert(`⚠️ Error: ${data.error}`);
        }
    } catch (err) {
        alert('Failed to connect to backend server.');
    }
}

function filterCategory(category, buttonEl) {
    selectedCategory = category;
    currentPage = 1; // Reset to page 1 on category filter
    const container = document.getElementById('categoryContainer');
    if (container) {
        container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        if (buttonEl) buttonEl.classList.add('active');
    }
    renderItemsGrid(1);
}

function filterHostelBlock(block, buttonEl) {
    selectedBlock = block;
    currentPage = 1; // Reset to page 1 on block filter
    const container = document.getElementById('blockFilterContainer');
    if (container) {
        container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        if (buttonEl) buttonEl.classList.add('active');
    }
    renderItemsGrid(1);
}

function searchItems() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    searchKeyword = input.value.trim();
    currentPage = 1; // Reset to page 1 on search
    renderItemsGrid(1);
}

const searchInputEl = document.getElementById('searchInput');
if (searchInputEl) {
    searchInputEl.addEventListener('input', function () {
        searchKeyword = this.value.trim();
        currentPage = 1;
        renderItemsGrid(1);
    });
    searchInputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); searchItems(); }
    });
}

// -------------------------------------------------------
// ITEM DETAILS MODAL (items.html)
// -------------------------------------------------------

function openItemModal(item) {
    currentActiveItem = item;
    const modal = document.getElementById('itemModal');
    if (!modal) return;

    const modalIcon     = document.getElementById('modalIcon');
    const modalTitle    = document.getElementById('modalTitle');
    const modalCategory = document.getElementById('modalCategory');
    const modalDesc     = document.getElementById('modalDesc');
    const modalPrice    = document.getElementById('modalPrice');

    if (modalIcon)     modalIcon.textContent = item.icon || categoryIcons[item.category] || '📦';
    if (modalTitle)    modalTitle.textContent = item.name;
    if (modalCategory) modalCategory.textContent = (item.category || 'Item') + (item.condition ? ` • ${item.condition} condition` : '');
    if (modalDesc) {
        let desc = item.description || 'No description provided.';
        if (item.hostel_block) desc += `\n\n🏢 Campus Location: ${item.hostel_block}`;
        if (item.contact) desc += `\n📍 Pickup / Contact: ${item.contact}`;
        if (item.owner_name) desc += `\n👤 Listed by: ${item.owner_name}`;
        modalDesc.innerText = desc;
    }
    if (modalPrice) modalPrice.textContent = '₹' + Number(item.price).toLocaleString('en-IN');

    modal.classList.add('active');
}

function closeModal() {
    const modal = document.getElementById('itemModal');
    if (modal) modal.classList.remove('active');
    // Tear down chat when modal closes
    closeChatPanel();
}

const itemModalEl = document.getElementById('itemModal');
if (itemModalEl) {
    itemModalEl.addEventListener('click', function (e) {
        if (e.target === itemModalEl) closeModal();
    });
}

// -------------------------------------------------------
// REAL-TIME BUYER-SELLER CHAT  (Socket.IO)
// -------------------------------------------------------

let chatSocket  = null;   // active socket connection
let chatItemId  = null;   // item being chatted about
let chatBuyerId = null;   // buyer user id (current user if buyer, or item.id asked by buyer)
let typingTimer = null;

/**
 * Toggle the chat panel open/closed from the "💬 Chat with Seller" button.
 */
function toggleChatPanel() {
    const panel = document.getElementById('chatPanel');
    if (!panel) return;

    if (panel.style.display === 'none' || panel.style.display === '') {
        openChat();
    } else {
        closeChatPanel();
    }
}

/**
 * Open chat panel, authenticate, load history, connect socket.
 */
async function openChat() {
    const panel     = document.getElementById('chatPanel');
    const authNote  = document.getElementById('chatAuthNote');
    const inputRow  = document.querySelector('.chat-input-row');
    const chatBtn   = document.getElementById('openChatBtn');

    if (!panel || !currentActiveItem) return;

    panel.style.display = 'flex';
    if (chatBtn) chatBtn.textContent = '✖ Close Chat';

    const user = getCurrentUser();
    if (!user) {
        // Not logged in — show auth prompt
        if (authNote)  authNote.style.display  = 'block';
        if (inputRow)  inputRow.style.display  = 'none';
        document.getElementById('chatMessages').innerHTML =
            `<p style="color:#9ca3af; text-align:center; font-size:13px; padding:20px;">Please log in to start chatting.</p>`;
        return;
    }

    if (authNote)  authNote.style.display  = 'none';
    if (inputRow)  inputRow.style.display  = 'flex';

    const item     = currentActiveItem;
    chatItemId     = item.id;

    // If user IS the seller of this item:
    if (item.owner_id && user.id === item.owner_id) {
        if (inputRow) inputRow.style.display = 'none';
        const msgBox = document.getElementById('chatMessages');
        msgBox.innerHTML = `<p style="color:#6b7280; font-size:13px; text-align:center;">Checking for interested buyer inquiries…</p>`;

        try {
            const res = await fetch(`${API}/chat/${item.id}/buyers`, { headers: getAuthHeaders(false) });
            const data = await res.json();
            if (data.success && data.buyers && data.buyers.length > 0) {
                msgBox.innerHTML = `
                    <div style="padding: 10px; background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; width: 100%;">
                        <p style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 8px;">
                            💬 Inquiries from Students (${data.buyers.length}):
                        </p>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            ${data.buyers.map(b => `
                                <button class="buyer-chip-btn" onclick="openChatForSellerWithBuyer(${item.id}, ${b.buyer_id}, '${escapeHtml(b.buyer_name)}')">
                                    👤 ${escapeHtml(b.buyer_name)}
                                </button>
                            `).join('')}
                        </div>
                        <p style="font-size: 12px; color: #6b7280; margin-top: 8px;">
                            Click any student above to view their messages and reply in real-time.
                        </p>
                    </div>
                `;
            } else {
                msgBox.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #6b7280; font-size: 13px;">
                        🏷️ You are the seller of this item.<br>No students have sent messages for this item yet.
                    </div>
                `;
            }
        } catch (e) {
            msgBox.innerHTML = `<p style="color:#ef4444; font-size:13px; text-align:center;">Failed to load buyer inquiries.</p>`;
        }
        return;
    }

    chatBuyerId = user.id;

    // Load message history
    const msgBox = document.getElementById('chatMessages');
    msgBox.innerHTML = `<p style="color:#9ca3af; text-align:center; font-size:13px;">Loading messages…</p>`;

    try {
        const res  = await fetch(`${API}/chat/${chatItemId}/history?buyerId=${chatBuyerId}`, {
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        msgBox.innerHTML = '';

        if (data.success && data.messages.length > 0) {
            data.messages.forEach(m => appendMessage(m, user.id));
        } else {
            msgBox.innerHTML = `<p style="color:#9ca3af; text-align:center; font-size:13px; padding:20px;">No messages yet. Say hi! 👋</p>`;
        }
        msgBox.scrollTop = msgBox.scrollHeight;
    } catch (e) {
        msgBox.innerHTML = `<p style="color:#ef4444; font-size:13px; text-align:center;">Failed to load messages.</p>`;
    }

    // Connect Socket.IO (if not already connected)
    connectChatSocket(chatItemId, chatBuyerId, user);
}

/**
 * Seller opens chat with a specific buyer who messaged about the item
 */
async function openChatForSellerWithBuyer(itemId, buyerId, buyerName) {
    const inputRow = document.querySelector('.chat-input-row');
    const msgBox = document.getElementById('chatMessages');
    const user = getCurrentUser();
    if (!user) return;

    if (inputRow) inputRow.style.display = 'flex';
    chatItemId = itemId;
    chatBuyerId = buyerId;

    msgBox.innerHTML = `<p style="color:#9ca3af; text-align:center; font-size:13px;">Loading conversation with ${escapeHtml(buyerName)}…</p>`;

    try {
        const res = await fetch(`${API}/chat/${chatItemId}/history?buyerId=${chatBuyerId}`, {
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        msgBox.innerHTML = '';

        if (data.success && data.messages.length > 0) {
            data.messages.forEach(m => appendMessage(m, user.id));
        } else {
            msgBox.innerHTML = `<p style="color:#9ca3af; text-align:center; font-size:13px; padding:20px;">No messages yet. Say hi! 👋</p>`;
        }
        msgBox.scrollTop = msgBox.scrollHeight;
    } catch (e) {
        msgBox.innerHTML = `<p style="color:#ef4444; font-size:13px; text-align:center;">Failed to load messages.</p>`;
    }

    connectChatSocket(chatItemId, chatBuyerId, user);
}

/**
 * Create and connect a Socket.IO socket for this chat room.
 */
function connectChatSocket(itemId, buyerId, user) {
    // Disconnect any existing socket first
    if (chatSocket) chatSocket.disconnect();

    const token = localStorage.getItem('dashdrop_token');
    if (!token) return;

    // socket.io.js served by backend at /socket.io/socket.io.js
    chatSocket = io({ auth: { token } });

    chatSocket.on('connect', () => {
        chatSocket.emit('join_room', { itemId, buyerId });
    });

    chatSocket.on('room_joined', ({ room }) => {
        console.log('Joined chat room:', room);
    });

    chatSocket.on('new_message', (msg) => {
        // Remove "no messages yet" placeholder if present
        const msgBox = document.getElementById('chatMessages');
        if (msgBox) {
            const placeholder = msgBox.querySelector('p');
            if (placeholder) placeholder.remove();
            appendMessage(msg, user.id);
            msgBox.scrollTop = msgBox.scrollHeight;
        }
    });

    chatSocket.on('user_typing', ({ name }) => {
        const indicator = document.getElementById('chatTypingIndicator');
        if (indicator) {
            indicator.textContent = `${name} is typing…`;
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => { indicator.textContent = ''; }, 2000);
        }
    });

    chatSocket.on('chat_error', (err) => {
        alert('Chat error: ' + err);
    });

    chatSocket.on('connect_error', (err) => {
        console.warn('Socket connect error:', err.message);
    });
}

/**
 * Render a single message bubble into the chat messages container.
 */
function appendMessage(msg, myUserId) {
    const msgBox = document.getElementById('chatMessages');
    if (!msgBox) return;

    const isMine = msg.sender_id === myUserId;
    const time   = new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMine ? 'chat-bubble-mine' : 'chat-bubble-theirs'}`;
    bubble.innerHTML = `
        ${!isMine ? `<span class="chat-sender">${escapeHtml(msg.sender_name)}</span>` : ''}
        <div class="chat-text">${escapeHtml(msg.message)}</div>
        <span class="chat-time">${time}</span>
    `;
    msgBox.appendChild(bubble);
}

/**
 * Send the typed message via socket.
 */
function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input || !chatSocket || !input.value.trim()) return;

    chatSocket.emit('send_message', { message: input.value.trim() });
    input.value = '';
    input.focus();
}

/** Enter key handler for chat input */
function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

/** Emit typing event (debounced — only once every 1.5 s) */
let _typingDebounce = null;
function emitTyping() {
    if (!chatSocket) return;
    if (_typingDebounce) return;
    chatSocket.emit('typing');
    _typingDebounce = setTimeout(() => { _typingDebounce = null; }, 1500);
}

/** Close/hide chat panel and disconnect socket */
function closeChatPanel() {
    const panel  = document.getElementById('chatPanel');
    const chatBtn = document.getElementById('openChatBtn');
    if (panel)   panel.style.display = 'none';
    if (chatBtn) chatBtn.textContent = '💬 Chat with Seller';
    if (chatSocket) { chatSocket.disconnect(); chatSocket = null; }
    chatItemId  = null;
    chatBuyerId = null;
    const indicator = document.getElementById('chatTypingIndicator');
    if (indicator) indicator.textContent = '';
}

function contactSeller() {
    if (!currentActiveItem) return;
    const contactInfo = currentActiveItem.contact || 'Check student portal or hostel reception.';
    alert(`📞 Seller Contact Details:\n\nItem: ${currentActiveItem.name}\nContact: ${contactInfo}\n\nReach out to complete your purchase!`);
    closeModal();
}

async function buyCurrentItem() {
    const user = getCurrentUser();
    if (!user) {
        alert('Please login to buy items on DashDrop.');
        openAuthModal('login');
        return;
    }

    if (!currentActiveItem) return;

    if (currentActiveItem.owner_id === user.id) {
        alert('⚠️ You cannot buy your own listed item.');
        return;
    }

    const confirmBuy = confirm(`Confirm purchase of "${currentActiveItem.name}" for ₹${Number(currentActiveItem.price).toLocaleString('en-IN')}?`);
    if (!confirmBuy) return;

    try {
        const res = await fetch(`${API}/items/${currentActiveItem.id}/buy`, {
            method: 'POST',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            alert(`🎉 ${data.message}\n\nSeller contact: ${data.purchase.seller_contact}`);
            closeModal();
            renderItemsGrid(currentPage);
        } else {
            alert(`⚠️ Purchase failed: ${data.error}`);
        }
    } catch (err) {
        alert('Failed to connect to backend server.');
    }
}

// -------------------------------------------------------
// SELL PAGE (sell.html)
// -------------------------------------------------------

async function listItem() {
    const user = getCurrentUser();
    if (!user) {
        alert('Please login first to list an item on the marketplace.');
        openAuthModal('login');
        return;
    }

    const name        = document.getElementById('itemName')?.value.trim();
    const category    = document.getElementById('category')?.value;
    const price       = parseFloat(document.getElementById('price')?.value);
    const condition   = document.getElementById('condition')?.value;
    const hostel_block = document.getElementById('hostelBlock')?.value || 'Block A';
    const description = document.getElementById('description')?.value.trim();
    const contact     = document.getElementById('contact')?.value.trim();

    if (!name || !category || isNaN(price) || price < 0 || !condition || !contact) {
        showFormFeedback('formFeedback', '⚠️ Please fill in all required fields (Name, Category, Price, Condition, and Contact).', 'error');
        return;
    }

    try {
        const res = await fetch(`${API}/items`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ name, category, price, condition, description, contact, hostel_block })
        });

        const json = await res.json();

        if (json.success) {
            showFormFeedback('formFeedback', '🎉 Success! Your item has been listed on DashDrop. Redirecting...', 'success');
            const form = document.getElementById('sellForm');
            if (form) form.reset();
            setTimeout(() => window.location.href = 'items.html', 1200);
        } else {
            showFormFeedback('formFeedback', '⚠️ ' + (json.error || 'Something went wrong.'), 'error');
        }
    } catch (err) {
        console.error('Sell error:', err);
        showFormFeedback('formFeedback', '⚠️ Could not connect to server.', 'error');
    }
}

// -------------------------------------------------------
// RENT PAGE (rent.html)
// -------------------------------------------------------

let rentCategory = 'all';

function filterRentCategory(category, buttonEl) {
    rentCategory = category;
    const container = document.getElementById('rentCategoryContainer');
    if (container) {
        container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        if (buttonEl) buttonEl.classList.add('active');
    }
    applyRentFilter();
}

function searchRentItems() { applyRentFilter(); }

function applyRentFilter() {
    const searchInput = document.getElementById('rentSearch');
    const searchText  = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const cards       = document.querySelectorAll('#rentGrid .item-card');

    cards.forEach(card => {
        const cardCategory = card.getAttribute('data-category') || '';
        const title        = card.querySelector('h2')?.textContent.toLowerCase() || '';
        const matchesCat   = rentCategory === 'all' || cardCategory.toLowerCase() === rentCategory;
        const matchesSearch = searchText === '' || title.includes(searchText);
        card.style.display = matchesCat && matchesSearch ? 'block' : 'none';
    });
}

const rentSearchInput = document.getElementById('rentSearch');
if (rentSearchInput) {
    rentSearchInput.addEventListener('input', applyRentFilter);
    rentSearchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); applyRentFilter(); }
    });
}

async function rentItem(itemName, dailyPrice, category) {
    const user = getCurrentUser();
    if (!user) {
        alert('Please login to place a rental request.');
        openAuthModal('login');
        return;
    }

    const days = prompt(`How many days do you want to rent "${itemName}"?`, '1');
    if (!days || isNaN(days) || parseInt(days) <= 0) return;

    try {
        const res = await fetch(`${API}/rentals`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({
                item_name: itemName,
                category: category || 'general',
                daily_price: dailyPrice,
                days: parseInt(days),
                student_name: user.name
            })
        });
        const json = await res.json();
        if (json.success) {
            alert(`✅ Rental Confirmed!\n\n${json.message}\n\nPick up at the campus pickup desk!`);
        } else {
            alert('⚠️ Rental failed: ' + (json.error || 'Unknown error'));
        }
    } catch (err) {
        alert('⚠️ Could not connect to server.');
    }
}

// -------------------------------------------------------
// ACCOUNT & ADMIN DASHBOARD PAGE (account.html)
// -------------------------------------------------------

async function loadAccountData() {
    const profileNameEl = document.getElementById('profileName');
    if (!profileNameEl) return;

    const user = getCurrentUser();

    try {
        const res  = await fetch(`${API}/profile`, { headers: getAuthHeaders(false) });
        const json = await res.json();

        if (!json.success) return;

        const { profile, stats } = json;

        if (profile.name) profileNameEl.textContent = profile.name;
        if (profile.email) {
            const emailEl = document.getElementById('profileEmail');
            if (emailEl) {
                emailEl.textContent = maskEmail(profile.email);
                emailEl.dataset.fullValue = profile.email;
                emailEl.title = 'Protected personal information';
            }
        }
        if (profile.phone) {
            const phoneEl = document.getElementById('profilePhone');
            if (phoneEl) {
                phoneEl.textContent = maskPhone(profile.phone);
                phoneEl.dataset.fullValue = profile.phone;
                phoneEl.title = 'Protected personal information';
            }
        } else {
            const phoneEl = document.getElementById('profilePhone');
            if (phoneEl) phoneEl.textContent = 'Not provided';
        }
        if (profile.college) document.getElementById('profileCollege').textContent = profile.college || 'Engineering Campus';

        const roleBadge = document.getElementById('userRoleBadge');
        if (roleBadge) {
            roleBadge.textContent = (profile.role || 'student').toUpperCase();
            roleBadge.className = `role-badge ${profile.role === 'admin' ? 'role-admin' : 'role-student'}`;
        }

        const heading = document.getElementById('userHeading');
        if (heading && profile.name) heading.textContent = `${profile.name}'s Account`;

        const listedCountEl = document.getElementById('listedCount');
        const rentedCountEl = document.getElementById('rentedCount');
        const soldCountEl   = document.getElementById('soldCount');

        if (listedCountEl) listedCountEl.textContent = stats.listed ?? '0';
        if (rentedCountEl) rentedCountEl.textContent = stats.rented ?? '0';
        if (soldCountEl)   soldCountEl.textContent   = stats.sold   ?? '0';

        // Load Products I am Selling & Products I Bought & Rental Tracker & Wishlist & Conversations
        loadMySellingProducts();
        loadMyBoughtProducts();
        loadMyRentalTracker();
        loadMyWishlist();
        loadMyConversations();

        // Load Admin Panel if user is Admin
        if (user && user.role === 'admin') {
            loadAdminPanel();
        } else {
            const adminSection = document.getElementById('adminSection');
            if (adminSection) adminSection.style.display = 'none';
        }

    } catch (err) {
        console.error('Failed to load profile:', err);
    }
}

// Render Products I am Selling
async function loadMySellingProducts() {
    const container = document.getElementById('mySellingList');
    if (!container) return;

    const user = getCurrentUser();
    if (!user) {
        container.innerHTML = `<p style="color:#6b7280; font-size:14px;"><a href="#" onclick="openAuthModal('login'); return false;" style="color:#4f46e5; font-weight:600;">Log in</a> to see your listed products.</p>`;
        return;
    }

    try {
        const res = await fetch(`${API}/my-products/selling`, { headers: getAuthHeaders(false) });
        const json = await res.json();

        if (!json.success || !json.data || json.data.length === 0) {
            container.innerHTML = `
                <div style="padding:16px; background:#f9fafb; border-radius:8px; text-align:center; color:#6b7280; font-size:14px; width:100%;">
                    You haven't listed any products yet. Have something to sell? <a href="sell.html" style="color:#4f46e5; font-weight:600;">List an item now</a>!
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        json.data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'my-product-item';
            const isSold = item.status === 'sold';
            card.innerHTML = `
                <div style="font-size:32px; background:#f3f4f6; width:52px; height:52px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${item.icon || '📦'}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <h4 style="margin:0; font-size:15px; color:#111827; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.name)}</h4>
                        <span class="product-status-badge ${isSold ? 'status-sold' : 'status-active'}">${isSold ? 'SOLD' : 'AVAILABLE'}</span>
                    </div>
                    <p style="margin:2px 0 0; font-size:13px; color:#6b7280;">${escapeHtml(item.category)} • ₹${Number(item.price).toLocaleString('en-IN')}</p>
                    <small style="color:#9ca3af; font-size:11px;">Listed on: ${new Date(item.created_at).toLocaleDateString()}</small>
                </div>
                <button onclick="deleteItem(${item.id}, '${escapeHtml(item.name).replace(/'/g, "\\'")}')" 
                    style="background:#fee2e2; color:#dc2626; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">
                    🗑️ Remove
                </button>
            `;
            container.appendChild(card);
        });

    } catch (err) {
        container.innerHTML = `<p style="color:#ef4444; font-size:13px;">Failed to load your selling listings.</p>`;
    }
}

// Render Products I Bought
async function loadMyBoughtProducts() {
    const container = document.getElementById('myBoughtList');
    if (!container) return;

    const user = getCurrentUser();
    if (!user) {
        container.innerHTML = `<p style="color:#6b7280; font-size:14px;"><a href="#" onclick="openAuthModal('login'); return false;" style="color:#4f46e5; font-weight:600;">Log in</a> to view your purchase history.</p>`;
        return;
    }

    try {
        const res = await fetch(`${API}/my-products/bought`, { headers: getAuthHeaders(false) });
        const json = await res.json();

        if (!json.success || !json.data || json.data.length === 0) {
            container.innerHTML = `
                <div style="padding:16px; background:#f9fafb; border-radius:8px; text-align:center; color:#6b7280; font-size:14px; width:100%;">
                    You haven't bought any products yet. Browse fellow students' items in the <a href="items.html" style="color:#10b981; font-weight:600;">Marketplace</a>!
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        json.data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'my-product-item';
            card.innerHTML = `
                <div style="font-size:32px; background:#ecfdf5; width:52px; height:52px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${item.icon || '🛍️'}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <h4 style="margin:0; font-size:15px; color:#111827; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.item_name)}</h4>
                        <span class="product-status-badge status-bought">BOUGHT</span>
                    </div>
                    <p style="margin:2px 0 0; font-size:13px; color:#059669; font-weight:600;">₹${Number(item.price).toLocaleString('en-IN')}</p>
                    <small style="color:#6b7280; font-size:11px;">Seller: ${escapeHtml(item.seller_name || 'Student')} (${escapeHtml(item.seller_contact || 'Campus')})</small><br>
                    <small style="color:#9ca3af; font-size:11px;">Purchased on: ${new Date(item.purchased_at).toLocaleDateString()}</small>
                </div>
            `;
            container.appendChild(card);
        });

    } catch (err) {
        container.innerHTML = `<p style="color:#ef4444; font-size:13px;">Failed to load your purchase history.</p>`;
    }
}

// ==========================================
// WISHLIST / SAVED ITEMS
// ==========================================

// Toggle wishlist from heart button on item cards
async function toggleWishlist(itemId, event) {
    event.stopPropagation();
    const user = getCurrentUser();
    if (!user) {
        openAuthModal('login');
        return;
    }

    try {
        const res = await fetch(`${API}/wishlist/${itemId}`, {
            method: 'POST',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            // Update heart button appearance without full re-render
            const btn = event.target.closest('.wishlist-heart-btn');
            if (btn) {
                btn.textContent = data.saved ? '❤️' : '🤍';
                btn.title = data.saved ? 'Remove from Wishlist' : 'Save to Wishlist';
                btn.classList.toggle('active', data.saved);
            }
            // Refresh wishlist section on account page if it's open
            if (document.getElementById('myWishlistList')) loadMyWishlist();
        } else {
            alert('⚠️ ' + (data.error || 'Something went wrong.'));
        }
    } catch (err) {
        alert('Failed to connect to backend.');
    }
}

// Render Wishlist / Saved Items section on account page
async function loadMyWishlist() {
    const container = document.getElementById('myWishlistList');
    if (!container) return;

    const user = getCurrentUser();
    if (!user) {
        container.innerHTML = `<p style="color:#6b7280; font-size:14px;"><a href="#" onclick="openAuthModal('login'); return false;" style="color:#ec4899; font-weight:600;">Log in</a> to see your saved items.</p>`;
        return;
    }

    container.innerHTML = `<p style="color:#6b7280; font-size:13px;">Loading wishlist…</p>`;

    try {
        const res = await fetch(`${API}/wishlist`, { headers: getAuthHeaders(false) });
        const json = await res.json();

        if (!json.success || !json.data || json.data.length === 0) {
            container.innerHTML = `
                <div style="padding:16px; background:#fdf2f8; border-radius:8px; text-align:center; color:#6b7280; font-size:14px; width:100%;">
                    Your wishlist is empty. Browse the
                    <a href="items.html" style="color:#ec4899; font-weight:600;">Marketplace</a>
                    and click ❤️ on any item to save it!
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        json.data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'my-product-item';
            const isSold = item.status === 'sold';
            card.innerHTML = `
                <div style="font-size:32px; background:#fdf2f8; width:52px; height:52px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${item.icon || '📦'}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <h4 style="margin:0; font-size:15px; color:#111827;">${escapeHtml(item.name)}</h4>
                        <span class="product-status-badge ${isSold ? 'status-sold' : 'status-active'}">${isSold ? 'SOLD' : 'AVAILABLE'}</span>
                    </div>
                    <p style="margin:2px 0 0; font-size:13px; color:#ec4899; font-weight:600;">₹${Number(item.price).toLocaleString('en-IN')}</p>
                    <small style="color:#9ca3af; font-size:11px;">Saved on: ${new Date(item.saved_at).toLocaleDateString()}</small>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0; align-items:center;">
                    <button onclick="removeFromWishlist(${item.id})" style="background:#fce7f3; color:#be185d; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">💔 Remove</button>
                    ${!isSold ? `<a href="items.html" style="background:#4f46e5; color:white; text-decoration:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:600;">View</a>` : ''}
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<p style="color:#ef4444; font-size:13px;">Failed to load your wishlist.</p>`;
    }
}

// Remove item from wishlist (called from wishlist section remove button)
async function removeFromWishlist(itemId) {
    try {
        const res = await fetch(`${API}/wishlist/${itemId}`, {
            method: 'POST',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) loadMyWishlist();
    } catch (_) {}
}

// ==========================================
// MY CONVERSATIONS & INQUIRIES (account.html)
// ==========================================

let accChatSocket = null;
let accChatRoom = null;
let accChatTypingTimer = null;

async function loadMyConversations() {
    const container = document.getElementById('myConversationsList');
    if (!container) return;

    const user = getCurrentUser();
    if (!user) {
        container.innerHTML = `<p style="color:#6b7280; font-size:14px;"><a href="#" onclick="openAuthModal('login'); return false;" style="color:#8b5cf6; font-weight:600;">Log in</a> to view your conversations.</p>`;
        return;
    }

    container.innerHTML = `<p style="color:#6b7280; font-size:13px;">Loading conversations…</p>`;

    try {
        const res = await fetch(`${API}/chat/conversations`, { headers: getAuthHeaders(false) });
        const json = await res.json();

        if (!json.success || !json.conversations || json.conversations.length === 0) {
            container.innerHTML = `
                <div style="padding:16px; background:#f5f3ff; border-radius:8px; text-align:center; color:#6b7280; font-size:14px; width:100%;">
                    No active chat conversations yet.<br>
                    Browse the <a href="items.html" style="color:#8b5cf6; font-weight:600;">Marketplace</a> and click <b>💬 Chat with Seller</b> on any item to connect!
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        json.conversations.forEach(conv => {
            const card = document.createElement('div');
            card.className = 'my-product-item';
            const roleBadgeClass = conv.isBuyer ? 'badge-chat-buyer' : 'badge-chat-seller';
            const roleBadgeText  = conv.isBuyer ? `SELLER: ${conv.sellerName}` : `BUYER: ${conv.buyerName}`;
            const timeStr        = new Date(conv.lastSentAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

            card.innerHTML = `
                <div style="font-size:32px; background:#f5f3ff; width:52px; height:52px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${conv.itemIcon || '📦'}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <h4 style="margin:0; font-size:15px; color:#111827;">${escapeHtml(conv.itemName)}</h4>
                        <span class="${roleBadgeClass}">${escapeHtml(roleBadgeText)}</span>
                    </div>
                    <p style="margin:3px 0 0; font-size:13px; color:#4b5563; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        <b>${escapeHtml(conv.lastSenderName)}:</b> ${escapeHtml(conv.lastMessage)}
                    </p>
                    <small style="color:#9ca3af; font-size:11px;">Last message: ${timeStr} • ₹${Number(conv.itemPrice).toLocaleString('en-IN')}</small>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0; align-items:center;">
                    <button onclick="openAccountConversation('${conv.room}', ${conv.itemId}, ${conv.buyerId}, '${escapeHtml(conv.otherPartyName)}', '${escapeHtml(conv.itemName)}', '${conv.itemIcon || '📦'}')" style="background:linear-gradient(135deg, #ec4899, #8b5cf6); color:white; border:none; padding:7px 12px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer;">
                        💬 Open Chat
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<p style="color:#ef4444; font-size:13px;">Failed to load conversations.</p>`;
    }
}

/**
 * Open Conversation Modal from Account Page
 */
async function openAccountConversation(room, itemId, buyerId, otherPartyName, itemName, itemIcon) {
    const modal = document.getElementById('accountChatModal');
    if (!modal) return;

    accChatRoom = room;
    const user = getCurrentUser();
    if (!user) return;

    document.getElementById('accChatIcon').textContent = itemIcon || '📦';
    document.getElementById('accChatTitle').textContent = itemName;
    document.getElementById('accChatSubtitle').textContent = `Chatting with: ${otherPartyName}`;
    document.getElementById('accChatHeaderTitle').textContent = `💬 ${otherPartyName}`;

    const msgBox = document.getElementById('accChatMessages');
    msgBox.innerHTML = `<p style="color:#9ca3af; text-align:center; font-size:13px;">Loading messages…</p>`;

    modal.classList.add('active');

    // Load message history
    try {
        const res = await fetch(`${API}/chat/${itemId}/history?buyerId=${buyerId}`, {
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        msgBox.innerHTML = '';

        if (data.success && data.messages.length > 0) {
            data.messages.forEach(m => appendAccountMessage(m, user.id));
        } else {
            msgBox.innerHTML = `<p style="color:#9ca3af; text-align:center; font-size:13px; padding:20px;">No messages yet.</p>`;
        }
        msgBox.scrollTop = msgBox.scrollHeight;
    } catch (e) {
        msgBox.innerHTML = `<p style="color:#ef4444; font-size:13px; text-align:center;">Failed to load messages.</p>`;
    }

    // Connect socket
    connectAccountChatSocket(itemId, buyerId, user);
}

function connectAccountChatSocket(itemId, buyerId, user) {
    if (accChatSocket) accChatSocket.disconnect();

    const token = localStorage.getItem('dashdrop_token');
    if (!token) return;

    accChatSocket = io({ auth: { token } });

    accChatSocket.on('connect', () => {
        accChatSocket.emit('join_room', { itemId, buyerId });
    });

    accChatSocket.on('new_message', (msg) => {
        const msgBox = document.getElementById('accChatMessages');
        if (msgBox) {
            const placeholder = msgBox.querySelector('p');
            if (placeholder) placeholder.remove();
            appendAccountMessage(msg, user.id);
            msgBox.scrollTop = msgBox.scrollHeight;
        }
        // Refresh conversation list preview
        loadMyConversations();
    });

    accChatSocket.on('user_typing', ({ name }) => {
        const indicator = document.getElementById('accChatTypingIndicator');
        if (indicator) {
            indicator.textContent = `${name} is typing…`;
            clearTimeout(accChatTypingTimer);
            accChatTypingTimer = setTimeout(() => { indicator.textContent = ''; }, 2000);
        }
    });

    accChatSocket.on('chat_error', (err) => {
        alert('Chat error: ' + err);
    });
}

function appendAccountMessage(msg, myUserId) {
    const msgBox = document.getElementById('accChatMessages');
    if (!msgBox) return;

    const isMine = msg.sender_id === myUserId;
    const time   = new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMine ? 'chat-bubble-mine' : 'chat-bubble-theirs'}`;
    bubble.innerHTML = `
        ${!isMine ? `<span class="chat-sender">${escapeHtml(msg.sender_name)}</span>` : ''}
        <div class="chat-text">${escapeHtml(msg.message)}</div>
        <span class="chat-time">${time}</span>
    `;
    msgBox.appendChild(bubble);
}

function sendAccChatMessage() {
    const input = document.getElementById('accChatInput');
    if (!input || !accChatSocket || !input.value.trim()) return;

    accChatSocket.emit('send_message', { message: input.value.trim() });
    input.value = '';
    input.focus();
}

function handleAccChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAccChatMessage();
    }
}

let _accTypingDebounce = null;
function emitAccTyping() {
    if (!accChatSocket) return;
    if (_accTypingDebounce) return;
    accChatSocket.emit('typing');
    _accTypingDebounce = setTimeout(() => { _accTypingDebounce = null; }, 1500);
}

function closeAccountChatModal() {
    const modal = document.getElementById('accountChatModal');
    if (modal) modal.classList.remove('active');
    if (accChatSocket) {
        accChatSocket.disconnect();
        accChatSocket = null;
    }
    accChatRoom = null;
}

// ==========================================
// RENTAL RETURN TRACKER & OVERDUE REMINDERS
// ==========================================

async function loadMyRentalTracker() {
    const container = document.getElementById('myRentalsTrackerList');
    if (!container) return;

    const user = getCurrentUser();
    if (!user) {
        container.innerHTML = `<p style="color:#6b7280; font-size:14px;"><a href="#" onclick="openAuthModal('login'); return false;" style="color:#0284c7; font-weight:600;">Log in</a> to track your rented campus gear.</p>`;
        return;
    }

    container.innerHTML = `<p style="color:#6b7280; font-size:13px;">Loading rental tracker…</p>`;

    try {
        const res = await fetch(`${API}/rentals`, { headers: getAuthHeaders(false) });
        const json = await res.json();

        if (!json.success || !json.data || json.data.length === 0) {
            container.innerHTML = `
                <div style="padding:16px; background:#f0f9ff; border-radius:8px; text-align:center; color:#6b7280; font-size:14px; width:100%;">
                    You have no active or previous rentals.<br>
                    Browse <a href="rent.html" style="color:#0284c7; font-weight:600;">Rent Items</a> to borrow calculators, lab coats, cycles, and tech!
                </div>
            `;
            const overdueBanner = document.getElementById('rentalOverdueBanner');
            if (overdueBanner) overdueBanner.style.display = 'none';
            return;
        }

        const rentals = json.data;
        const activeCount = rentals.filter(r => r.status === 'active').length;
        const overdueCount = rentals.filter(r => r.status === 'overdue').length;
        const returnedCount = rentals.filter(r => r.status === 'returned').length;
        const totalLateFee = rentals.filter(r => r.status === 'overdue').reduce((sum, r) => sum + (r.late_fee || 0), 0);

        // Update Tracker Metrics Counters
        const activeCountEl = document.getElementById('trackerActiveCount');
        const overdueCountEl = document.getElementById('trackerOverdueCount');
        const returnedCountEl = document.getElementById('trackerReturnedCount');
        if (activeCountEl) activeCountEl.textContent = activeCount;
        if (overdueCountEl) overdueCountEl.textContent = overdueCount;
        if (returnedCountEl) returnedCountEl.textContent = returnedCount;

        // Overdue Alert Banner
        const overdueBanner = document.getElementById('rentalOverdueBanner');
        const overdueBannerText = document.getElementById('rentalOverdueBannerText');
        if (overdueBanner) {
            if (overdueCount > 0) {
                overdueBanner.style.display = 'block';
                if (overdueBannerText) {
                    overdueBannerText.textContent = `You have ${overdueCount} overdue item(s) with an accumulated late fee of ₹${totalLateFee}. Please return or extend immediately!`;
                }
            } else {
                overdueBanner.style.display = 'none';
            }
        }

        container.innerHTML = '';
        rentals.forEach(rental => {
            const card = document.createElement('div');
            card.className = 'my-product-item';
            
            let statusBadge = '';
            let actionButtons = '';

            if (rental.status === 'overdue') {
                statusBadge = `<span class="rental-badge-overdue">⚠️ OVERDUE (${rental.days_overdue}d late • Fee: ₹${rental.late_fee})</span>`;
                actionButtons = `
                    <button class="btn-rental-action btn-rental-return" onclick="returnRental(${rental.id}, '${escapeHtml(rental.item_name)}')">
                        🔄 Return Now
                    </button>
                    <button class="btn-rental-action btn-rental-extend" onclick="extendRental(${rental.id}, '${escapeHtml(rental.item_name)}')">
                        ➕ Extend
                    </button>
                `;
            } else if (rental.status === 'active') {
                const remainingText = rental.days_remaining === 0 ? 'Due Today' : `Due in ${rental.days_remaining}d`;
                statusBadge = `<span class="rental-badge-active">⏳ ${remainingText} (${rental.formatted_due_date})</span>`;
                actionButtons = `
                    <button class="btn-rental-action btn-rental-return" onclick="returnRental(${rental.id}, '${escapeHtml(rental.item_name)}')">
                        🔄 Return
                    </button>
                    <button class="btn-rental-action btn-rental-extend" onclick="extendRental(${rental.id}, '${escapeHtml(rental.item_name)}')">
                        ➕ Extend
                    </button>
                `;
            } else {
                statusBadge = `<span class="rental-badge-returned">✅ Returned (${rental.formatted_returned_at || 'Completed'})</span>`;
                actionButtons = `<span style="font-size:12px; color:#10b981; font-weight:600;">✅ Completed</span>`;
            }

            const categoryIcons = {
                academic: '📚',
                mobility: '🚲',
                electronics: '⚡',
                music: '🎸',
                general: '📦'
            };
            const icon = categoryIcons[rental.category] || '📦';

            card.innerHTML = `
                <div style="font-size:32px; background:#f0f9ff; width:52px; height:52px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${icon}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <h4 style="margin:0; font-size:15px; color:#111827;">${escapeHtml(rental.item_name)}</h4>
                        ${statusBadge}
                    </div>
                    <p style="margin:3px 0 0; font-size:13px; color:#0369a1; font-weight:600;">
                        ₹${rental.daily_price}/day • Total: ₹${rental.total_price} (${rental.days} days)
                    </p>
                    <small style="color:#6b7280; font-size:11px;">Rented on: ${rental.formatted_rented_at} • Return Due: <b>${rental.formatted_due_date}</b></small>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0; align-items:center; flex-wrap:wrap;">
                    ${actionButtons}
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = `<p style="color:#ef4444; font-size:13px;">Failed to load rental tracker.</p>`;
    }
}

async function returnRental(rentalId, itemName) {
    if (!confirm(`Are you ready to return "${itemName}" to the campus pickup desk?`)) return;

    try {
        const res = await fetch(`${API}/rentals/${rentalId}/return`, {
            method: 'POST',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ ${data.message}`);
            loadMyRentalTracker();
            loadAccountData();
        } else {
            alert(`⚠️ Return failed: ${data.error}`);
        }
    } catch (err) {
        alert('⚠️ Could not connect to server.');
    }
}

async function extendRental(rentalId, itemName) {
    const daysStr = prompt(`How many additional days would you like to extend "${itemName}"? (1-14 days):`, '3');
    if (!daysStr) return;

    const extraDays = parseInt(daysStr, 10);
    if (isNaN(extraDays) || extraDays < 1 || extraDays > 14) {
        alert('Please enter a valid number of days between 1 and 14.');
        return;
    }

    try {
        const res = await fetch(`${API}/rentals/${rentalId}/extend`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ extra_days: extraDays })
        });
        const data = await res.json();
        if (data.success) {
            alert(`🎉 ${data.message}\nAdded cost: ₹${data.addedCost}. New total: ₹${data.newTotal}`);
            loadMyRentalTracker();
            loadAccountData();
        } else {
            alert(`⚠️ Extension failed: ${data.error}`);
        }
    } catch (err) {
        alert('⚠️ Could not connect to server.');
    }
}

async function checkRentPageTracker() {
    const banner = document.getElementById('rentPageTrackerBanner');
    if (!banner) return;
    const user = getCurrentUser();
    if (!user) return;

    try {
        const res = await fetch(`${API}/rentals/overview`, { headers: getAuthHeaders(false) });
        const data = await res.json();
        if (!data.success || !data.stats) return;

        if (data.stats.overdueRentals > 0) {
            banner.style.display = 'block';
            banner.style.background = '#fef2f2';
            banner.style.border = '1.5px solid #f87171';
            banner.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <span style="color:#991b1b; font-weight:600;">
                        ⚠️ Overdue Warning: You have ${data.stats.overdueRentals} overdue item(s) (Late fees: ₹${data.stats.totalLateFees}).
                    </span>
                    <a href="account.html#myRentalsTrackerSection" style="background:#dc2626; color:white; padding:5px 12px; border-radius:6px; text-decoration:none; font-weight:600; font-size:12px;">
                        Open Return Tracker ➤
                    </a>
                </div>
            `;
        } else if (data.stats.activeRentals > 0) {
            banner.style.display = 'block';
            banner.style.background = '#f0f9ff';
            banner.style.border = '1.5px solid #bae6fd';
            banner.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <span style="color:#0369a1; font-weight:600;">
                        ⏱️ Active Rentals: You currently have ${data.stats.activeRentals} item(s) rented on campus.
                    </span>
                    <a href="account.html#myRentalsTrackerSection" style="background:#0284c7; color:white; padding:5px 12px; border-radius:6px; text-decoration:none; font-weight:600; font-size:12px;">
                        Manage &amp; Return Items ➤
                    </a>
                </div>
            `;
        }
    } catch (_) {}
}

async function adminSendReminder(rentalId, studentName, itemName) {
    try {
        const res = await fetch(`${API}/rentals/${rentalId}/remind`, {
            method: 'POST',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            alert(`🔔 Reminder Notice Sent!\n\nOverdue return alert dispatched to ${studentName} for "${itemName}".`);
            loadAdminPanel();
        } else {
            alert(`⚠️ Failed: ${data.error}`);
        }
    } catch (_) {
        alert('Could not send reminder.');
    }
}

async function adminMarkReturned(rentalId, itemName) {
    if (!confirm(`Mark item "${itemName}" as physically returned to campus desk?`)) return;
    try {
        const res = await fetch(`${API}/rentals/${rentalId}/return`, {
            method: 'POST',
            headers: getAuthHeaders(false)
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ ${data.message}`);
            loadAdminPanel();
        } else {
            alert(`⚠️ ${data.error}`);
        }
    } catch (_) {
        alert('Could not mark returned.');
    }
}

// ==========================================
// ADMIN: CAMPUS BLOCK NAMES & SELLER MODERATION
// ==========================================

async function loadAdminPanel() {
    const adminSection = document.getElementById('adminSection');
    if (!adminSection) return;

    const user = getCurrentUser();
    if (!user || user.role !== 'admin') {
        adminSection.style.display = 'none';
        return;
    }

    adminSection.style.display = 'block';

    // 1. Load Campus Blocks
    try {
        const blocksRes = await fetch(`${API}/admin/blocks`, { headers: getAuthHeaders(false) });
        const blocksData = await blocksRes.json();
        const blocksTbody = document.getElementById('adminBlocksTableBody');

        if (blocksTbody && blocksData.success) {
            if (!blocksData.blocks || blocksData.blocks.length === 0) {
                blocksTbody.innerHTML = `<tr><td colspan="3" style="padding:14px; text-align:center; color:#94a3b8;">No blocks registered.</td></tr>`;
            } else {
                blocksTbody.innerHTML = blocksData.blocks.map(b => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 12px 14px; font-weight: 600; color: #1e1b4b;">
                            🏢 ${escapeHtml(b.name)}
                        </td>
                        <td style="padding: 12px 14px;">
                            <span style="background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 11.5px;">
                                ${b.item_count || 0} active listing(s)
                            </span>
                        </td>
                        <td style="padding: 12px 14px; text-align: right;">
                            <button type="button" onclick="adminRenameBlock('${escapeHtml(b.name)}')"
                                style="background: #4f46e5; color: white; border: none; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                                ✏️ Rename Block
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        }
    } catch (err) {
        console.error('Failed to load admin blocks:', err);
    }

    // 2. Load Sellers for Moderation
    try {
        const sellersRes = await fetch(`${API}/admin/sellers`, { headers: getAuthHeaders(false) });
        const sellersData = await sellersRes.json();
        const sellersTbody = document.getElementById('adminSellersTableBody');

        if (sellersTbody && sellersData.success) {
            if (!sellersData.sellers || sellersData.sellers.length === 0) {
                sellersTbody.innerHTML = `<tr><td colspan="5" style="padding:14px; text-align:center; color:#94a3b8;">No student sellers registered yet.</td></tr>`;
            } else {
                sellersTbody.innerHTML = sellersData.sellers.map(s => {
                    const isBlocked = s.is_blocked === 1;
                    const statusBadge = isBlocked
                        ? `<span style="background:#fee2e2; color:#b91c1c; padding:3px 9px; border-radius:12px; font-weight:700; font-size:11px;">🚫 BLOCKED</span>`
                        : `<span style="background:#dcfce7; color:#15803d; padding:3px 9px; border-radius:12px; font-weight:700; font-size:11px;">✅ ACTIVE</span>`;
                    
                    const btnClass = isBlocked ? 'background:#10b981;' : 'background:#ef4444;';
                    const btnText = isBlocked ? '✅ Unblock Seller' : '🚫 Block Seller';

                    return `
                        <tr style="border-bottom: 1px solid #f1f5f9; ${isBlocked ? 'background: #fff5f5;' : ''}">
                            <td style="padding: 12px 14px;">
                                <div style="font-weight: 600; color: #111827;">${escapeHtml(s.name)}</div>
                                <small style="color: #64748b;">${escapeHtml(s.email)}</small>
                            </td>
                            <td style="padding: 12px 14px; color: #475569;">
                                <div>${escapeHtml(s.college || 'Campus')}</div>
                                <small style="color: #94a3b8;">${escapeHtml(s.phone || 'No phone')}</small>
                            </td>
                            <td style="padding: 12px 14px; font-weight: 600; color: #1e1b4b;">
                                📦 ${s.listings_count || 0}
                            </td>
                            <td style="padding: 12px 14px;">
                                ${statusBadge}
                            </td>
                            <td style="padding: 12px 14px; text-align: right;">
                                <button type="button" onclick="adminToggleBlockSeller(${s.id}, '${escapeHtml(s.name)}', ${isBlocked})"
                                    style="${btnClass} color: white; border: none; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                                    ${btnText}
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch (err) {
        console.error('Failed to load admin sellers:', err);
    }
}

async function adminRenameBlock(oldName) {
    const newName = prompt(`Enter new name for block "${oldName}":`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;

    try {
        const res = await fetch(`${API}/admin/blocks/rename`, {
            method: 'PUT',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ oldName, newName: newName.trim() })
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ ${data.message}`);
            loadAdminPanel();
        } else {
            alert(`⚠️ Failed to rename block: ${data.error}`);
        }
    } catch (err) {
        alert('⚠️ Could not connect to server.');
    }
}

async function adminAddBlock(e) {
    e.preventDefault();
    const input = document.getElementById('newBlockNameInput');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;

    try {
        const res = await fetch(`${API}/admin/blocks`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.success) {
            input.value = '';
            alert(`✅ ${data.message}`);
            loadAdminPanel();
        } else {
            alert(`⚠️ Failed to add block: ${data.error}`);
        }
    } catch (err) {
        alert('⚠️ Could not connect to server.');
    }
}

async function adminToggleBlockSeller(sellerId, sellerName, currentlyBlocked) {
    const action = currentlyBlocked ? 'unblock' : 'block';
    const warning = currentlyBlocked 
        ? `Are you sure you want to unblock seller "${sellerName}"? Their items will become visible on the marketplace again.`
        : `Are you sure you want to block seller "${sellerName}"? They will NOT be able to list items and their existing listings will be hidden.`;

    if (!confirm(warning)) return;

    try {
        const res = await fetch(`${API}/admin/sellers/${sellerId}/block`, {
            method: 'PUT',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ is_blocked: !currentlyBlocked })
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ ${data.message}`);
            loadAdminPanel();
        } else {
            alert(`⚠️ Failed: ${data.error}`);
        }
    } catch (err) {
        alert('⚠️ Could not connect to server.');
    }
}

async function editProfile() {
    const user = getCurrentUser() || {};
    const emailEl = document.getElementById('profileEmail');
    const phoneEl = document.getElementById('profilePhone');

    const currentName    = document.getElementById('profileName')?.textContent || user.name || 'Surya';
    const currentEmail   = emailEl?.dataset.fullValue || user.email || 'surya@college.edu';
    const currentPhone   = phoneEl?.dataset.fullValue || user.phone || '+91 98765 43210';
    const currentCollege = document.getElementById('profileCollege')?.textContent || user.college || 'Engineering Campus';

    const newName    = prompt('Enter your Name:',           currentName);    if (!newName)    return;
    const newEmail   = prompt('Enter your College Email:',  currentEmail);   if (!newEmail)   return;
    const newPhone   = prompt('Enter your Phone Number:',   currentPhone);   if (!newPhone)   return;
    const newCollege = prompt('Enter your College / Campus:', currentCollege); if (!newCollege) return;

    try {
        const res = await fetch(`${API}/profile`, {
            method: 'PUT',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ name: newName, email: newEmail, phone: newPhone, college: newCollege })
        });
        const json = await res.json();
        if (json.success) {
            const user = getCurrentUser();
            if (user) {
                user.name = newName;
                user.email = newEmail;
                user.phone = newPhone;
                user.college = newCollege;
                localStorage.setItem('dashdrop_user', JSON.stringify(user));
            }
            await loadAccountData();
            updateNavbarAuthUI();
            alert('✅ Profile updated successfully!');
        } else {
            alert('⚠️ Update failed: ' + (json.error || 'Unknown error'));
        }
    } catch (err) {
        alert('⚠️ Could not connect to server.');
    }
}

async function logout() {
    if (confirm('Are you sure you want to logout of DashDrop?')) {
        try {
            await fetch(`${API}/auth/logout`, {
                method: 'POST',
                headers: getAuthHeaders(false)
            });
        } catch (_) {}
        clearAuthSession();
        window.location.href = 'index.html';
    }
}

// -------------------------------------------------------
// ON PAGE LOAD DISPATCHER
// -------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    updateNavbarAuthUI();
    initAIChatWidget();
    if (document.getElementById('itemsGrid'))   renderItemsGrid();
    if (document.getElementById('profileName')) loadAccountData();
    if (document.getElementById('rentPageTrackerBanner')) checkRentPageTracker();
    if (document.getElementById('hostelBlock')) populateSellHostelBlocks();
});

async function populateSellHostelBlocks() {
    const select = document.getElementById('hostelBlock');
    if (!select) return;

    try {
        const res = await fetch(`${API}/items/blocks`);
        const data = await res.json();
        if (data.success && data.blocks) {
            const currentVal = select.value;
            const validBlocks = data.blocks.filter(b => b.name !== 'All Blocks');
            select.innerHTML = '<option value="">Select Pickup Location</option>' + 
                validBlocks.map(b => `<option value="${escapeHtml(b.name)}">🏢 ${escapeHtml(b.name)}</option>`).join('');
            if (currentVal) select.value = currentVal;
        }
    } catch (_) {}
}

// ==========================================
// AI CAMPUS ASSISTANT (DashBot) CLIENT LOGIC
// ==========================================

let aiChatHistory = [];
let isAITyping = false;

function initAIChatWidget() {
    if (document.getElementById('aiChatLauncher')) return;

    const user = getCurrentUser();
    const studentName = user ? escapeHtml(user.name.split(' ')[0]) : 'Student';

    const widgetHTML = `
        <!-- Floating AI Chat Launcher Button -->
        <button id="aiChatLauncher" class="ai-chat-launcher" onclick="toggleAIChatWindow()" title="Chat with DashBot Campus AI" aria-label="Open AI Assistant">
            🤖
            <span class="ai-launcher-pulse"></span>
        </button>

        <!-- Floating AI Chat Window -->
        <div id="aiChatWindow" class="ai-chat-window">
            <!-- Header -->
            <div class="ai-chat-header">
                <div class="ai-header-left">
                    <div class="ai-avatar">🤖</div>
                    <div class="ai-title-wrap">
                        <h3>DashBot AI <span style="font-size: 11px; background: rgba(255,255,255,0.2); padding: 1px 6px; border-radius: 8px;">Campus</span></h3>
                        <p><span class="ai-status-dot"></span> Online • Powered by DashDrop</p>
                    </div>
                </div>
                <div class="ai-header-actions">
                    <button class="ai-action-btn" onclick="clearAIChat()" title="Clear chat history">🗑️</button>
                    <button class="ai-action-btn" onclick="toggleAIChatWindow()" title="Minimize">✖</button>
                </div>
            </div>

            <!-- Quick Suggestions Bar -->
            <div class="ai-prompts-bar">
                <button type="button" class="ai-prompt-chip" onclick="handleAIPromptClick('Find items in Block A')">🔍 Block A items</button>
                <button type="button" class="ai-prompt-chip" onclick="handleAIPromptClick('How much should I sell a cycle for?')">🚲 Cycle price</button>
                <button type="button" class="ai-prompt-chip" onclick="handleAIPromptClick('Write description to sell my study lamp')">📝 Sell description</button>
                <button type="button" class="ai-prompt-chip" onclick="handleAIPromptClick('How do rentals and extensions work?')">⏰ Rental rules</button>
                <button type="button" class="ai-prompt-chip" onclick="handleAIPromptClick('Where are safe places to meet for item handoffs?')">🛡️ Safe handoffs</button>
            </div>

            <!-- Messages Stream -->
            <div class="ai-messages-container" id="aiMessagesContainer">
                <div class="ai-msg ai-msg-bot">
                    <div class="ai-msg-avatar">🤖</div>
                    <div class="ai-msg-bubble">
                        <p>Hey <b>${studentName}</b>! 👋 I'm <b>DashBot</b>, your campus marketplace assistant.</p>
                        <p>Ask me to find items across hostel blocks, get fair pricing advice, write listing descriptions, or learn about rentals!</p>
                    </div>
                </div>
            </div>

            <!-- Footer / Input Form -->
            <div class="ai-chat-footer">
                <form class="ai-input-form" onsubmit="handleAISubmit(event)">
                    <input type="text" id="aiInputField" class="ai-input-field" placeholder="Ask DashBot anything..." autocomplete="off">
                    <button type="submit" id="aiSendBtn" class="ai-send-btn" title="Send message">➤</button>
                </form>
                <div class="ai-footer-note">DashDrop AI Campus Concierge • Real-time DB Search</div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', widgetHTML);
}

function toggleAIChatWindow() {
    const win = document.getElementById('aiChatWindow');
    if (!win) return;
    const isActive = win.classList.contains('active');
    if (isActive) {
        win.classList.remove('active');
    } else {
        win.classList.add('active');
        const input = document.getElementById('aiInputField');
        if (input) setTimeout(() => input.focus(), 150);
    }
}

function clearAIChat() {
    aiChatHistory = [];
    const container = document.getElementById('aiMessagesContainer');
    if (!container) return;
    const user = getCurrentUser();
    const studentName = user ? escapeHtml(user.name.split(' ')[0]) : 'Student';
    container.innerHTML = `
        <div class="ai-msg ai-msg-bot">
            <div class="ai-msg-avatar">🤖</div>
            <div class="ai-msg-bubble">
                <p>Chat cleared! How can I assist you with DashDrop, <b>${studentName}</b>?</p>
            </div>
        </div>
    `;
}

function handleAIPromptClick(promptText) {
    const input = document.getElementById('aiInputField');
    if (input) input.value = promptText;
    sendAIMessage(promptText);
}

function handleAISubmit(e) {
    e.preventDefault();
    const input = document.getElementById('aiInputField');
    if (!input) return;
    const text = input.value.trim();
    if (!text || isAITyping) return;
    input.value = '';
    sendAIMessage(text);
}

function formatAIMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Bold **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Bullet points • or * at start of lines
    html = html.replace(/^[•*]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    // Blockquote > text
    html = html.replace(/^&gt;\s*&quot;(.*?)&quot;$/gm, '<blockquote>“$1”</blockquote>');
    html = html.replace(/^&gt;\s*(.*)$/gm, '<blockquote>$1</blockquote>');
    // Line breaks
    html = html.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
    // Markdown links [text](url)
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    return html;
}

async function sendAIMessage(userText) {
    const container = document.getElementById('aiMessagesContainer');
    const sendBtn = document.getElementById('aiSendBtn');
    if (!container) return;

    // Append User Message
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'ai-msg ai-msg-user';
    userMsgEl.innerHTML = `<div class="ai-msg-bubble">${escapeHtml(userText)}</div>`;
    container.appendChild(userMsgEl);
    container.scrollTop = container.scrollHeight;

    aiChatHistory.push({ sender: 'user', text: userText });

    // Show Typing Indicator
    isAITyping = true;
    if (sendBtn) sendBtn.disabled = true;

    const typingEl = document.createElement('div');
    typingEl.className = 'ai-msg ai-msg-bot';
    typingEl.id = 'aiTypingIndicator';
    typingEl.innerHTML = `
        <div class="ai-msg-avatar">🤖</div>
        <div class="ai-typing-indicator">
            <span class="ai-typing-dot"></span>
            <span class="ai-typing-dot"></span>
            <span class="ai-typing-dot"></span>
        </div>
    `;
    container.appendChild(typingEl);
    container.scrollTop = container.scrollHeight;

    try {
        const res = await fetch(`${API}/ai/chat`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({
                message: userText,
                history: aiChatHistory
            })
        });

        const data = await res.json();
        const indicator = document.getElementById('aiTypingIndicator');
        if (indicator) indicator.remove();

        const botReply = data.success && data.reply ? data.reply : 'Sorry, I had trouble processing that request. Please try again!';
        aiChatHistory.push({ sender: 'bot', text: botReply });

        const botMsgEl = document.createElement('div');
        botMsgEl.className = 'ai-msg ai-msg-bot';

        let cardsHtml = '';
        if (data.items && data.items.length > 0) {
            cardsHtml = `
                <div class="ai-item-card-list">
                    ${data.items.map(item => `
                        <div class="ai-item-card">
                            <div class="ai-item-card-info">
                                <div class="ai-item-card-title">${item.icon || '📦'} ${escapeHtml(item.name)}</div>
                                <div class="ai-item-card-meta">₹${Number(item.price).toLocaleString()} • 📍 ${escapeHtml(item.hostel_block || 'Campus')}</div>
                            </div>
                            <button type="button" class="ai-item-card-btn" onclick="window.location.href='items.html'">View</button>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        botMsgEl.innerHTML = `
            <div class="ai-msg-avatar">🤖</div>
            <div class="ai-msg-bubble">
                ${formatAIMarkdown(botReply)}
                ${cardsHtml}
            </div>
        `;
        container.appendChild(botMsgEl);
        container.scrollTop = container.scrollHeight;

    } catch (err) {
        console.error('AI chat failed:', err);
        const indicator = document.getElementById('aiTypingIndicator');
        if (indicator) indicator.remove();

        const errorEl = document.createElement('div');
        errorEl.className = 'ai-msg ai-msg-bot';
        errorEl.innerHTML = `
            <div class="ai-msg-avatar">🤖</div>
            <div class="ai-msg-bubble" style="color: #ef4444;">
                ⚠️ Cannot connect to DashBot server. Please ensure the backend is running.
            </div>
        `;
        container.appendChild(errorEl);
        container.scrollTop = container.scrollHeight;
    } finally {
        isAITyping = false;
        if (sendBtn) sendBtn.disabled = false;
    }
}
