/* =======================================================
   DashDrop - Main JavaScript Application
   Campus Peer-to-Peer Marketplace with Authentication & RBAC
   Connected to backend API at http://localhost:5000
   ======================================================= */

// -------------------------------------------------------
// CONFIG & AUTH STATE
// -------------------------------------------------------
const API = 'http://localhost:5000/api';

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

    // If Admin, show link to Admin Dashboard in navbar if not already added
    if (user && user.role === 'admin') {
        navs.forEach(nav => {
            if (!nav.querySelector('.admin-link')) {
                const a = document.createElement('a');
                a.href = 'account.html#adminPanel';
                a.className = 'admin-link';
                a.style.color = '#ef4444';
                a.style.fontWeight = 'bold';
                a.textContent = '🛡️ Admin Panel';
                nav.appendChild(a);
            }
        });
    }
}

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
                    <p>No items matched your filter. Try a different keyword!</p>
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
        if (item.contact) desc += `\n\n📍 Contact / Pickup: ${item.contact}`;
        if (item.owner_name) desc += `\n👤 Listed by: ${item.owner_name}`;
        modalDesc.innerText = desc;
    }
    if (modalPrice) modalPrice.textContent = '₹' + Number(item.price).toLocaleString('en-IN');

    modal.classList.add('active');
}

function closeModal() {
    const modal = document.getElementById('itemModal');
    if (modal) modal.classList.remove('active');
}

const itemModalEl = document.getElementById('itemModal');
if (itemModalEl) {
    itemModalEl.addEventListener('click', function (e) {
        if (e.target === itemModalEl) closeModal();
    });
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

    const name      = document.getElementById('itemName')?.value.trim();
    const category  = document.getElementById('category')?.value;
    const price     = parseFloat(document.getElementById('price')?.value);
    const condition = document.getElementById('condition')?.value;
    const description = document.getElementById('description')?.value.trim();
    const contact   = document.getElementById('contact')?.value.trim();

    if (!name || !category || isNaN(price) || price < 0 || !condition || !contact) {
        showFormFeedback('formFeedback', '⚠️ Please fill in all required fields (Name, Category, Price, Condition, and Contact).', 'error');
        return;
    }

    try {
        const res = await fetch(`${API}/items`, {
            method: 'POST',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ name, category, price, condition, description, contact })
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

        if (profile.name)    profileNameEl.textContent = profile.name;
        if (profile.email)   document.getElementById('profileEmail').textContent   = profile.email;
        if (profile.phone)   document.getElementById('profilePhone').textContent   = profile.phone || 'Not provided';
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

        // Load Products I am Selling & Products I Bought & Wishlist
        loadMySellingProducts();
        loadMyBoughtProducts();
        loadMyWishlist();

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

async function loadAdminPanel() {
    let adminSection = document.getElementById('adminSection');
    if (!adminSection) return;

    adminSection.style.display = 'block';

    try {
        const res = await fetch(`${API}/admin/dashboard`, { headers: getAuthHeaders(false) });
        const data = await res.json();

        if (!data.success) {
            adminSection.innerHTML = `<p style="color:#ef4444;">${data.error}</p>`;
            return;
        }

        const stats = data.stats;
        document.getElementById('adminTotalUsers').textContent = stats.totalUsers;
        document.getElementById('adminTotalItems').textContent = stats.totalItems;
        document.getElementById('adminTotalRentals').textContent = stats.totalRentals;

        // Render Users Table
        const userTableBody = document.getElementById('adminUsersTableBody');
        if (userTableBody) {
            userTableBody.innerHTML = '';
            data.users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:10px; border-bottom:1px solid #e5e7eb;"><b>${escapeHtml(u.name)}</b><br><small style="color:#6b7280;">${escapeHtml(u.email)}</small></td>
                    <td style="padding:10px; border-bottom:1px solid #e5e7eb;"><span class="role-badge ${u.role === 'admin' ? 'role-admin' : 'role-student'}">${u.role.toUpperCase()}</span></td>
                    <td style="padding:10px; border-bottom:1px solid #e5e7eb;">
                        ${u.role === 'student' ? 
                            `<button onclick="changeUserRole(${u.id}, 'admin')" style="background:#4f46e5; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Promote to Admin</button>` :
                            `<button onclick="changeUserRole(${u.id}, 'student')" style="background:#6b7280; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Set as Student</button>`
                        }
                    </td>
                `;
                userTableBody.appendChild(tr);
            });
        }

        // Render Audit Logs
        const logsContainer = document.getElementById('adminLogsList');
        if (logsContainer) {
            logsContainer.innerHTML = '';
            data.logs.forEach(log => {
                const div = document.createElement('div');
                div.style.cssText = 'padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:12px;';
                div.innerHTML = `<span style="color:#4f46e5; font-weight:600;">[${escapeHtml(log.action)}]</span> ${escapeHtml(log.details)} <span style="color:#9ca3af; float:right;">${new Date(log.created_at).toLocaleTimeString()}</span>`;
                logsContainer.appendChild(div);
            });
        }
    } catch (e) {
        console.error('Failed to load admin panel data:', e);
    }
}

async function changeUserRole(userId, newRole) {
    if (!confirm(`Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`)) return;

    try {
        const res = await fetch(`${API}/admin/users/${userId}/role`, {
            method: 'PUT',
            headers: getAuthHeaders(true),
            body: JSON.stringify({ role: newRole })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            loadAdminPanel();
        } else {
            alert(data.error);
        }
    } catch (e) {
        alert('Server request failed.');
    }
}

async function editProfile() {
    const currentName    = document.getElementById('profileName')?.textContent    || 'Surya';
    const currentEmail   = document.getElementById('profileEmail')?.textContent   || 'surya@college.edu';
    const currentPhone   = document.getElementById('profilePhone')?.textContent   || '+91 98765 43210';
    const currentCollege = document.getElementById('profileCollege')?.textContent || 'Engineering Campus';

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
    if (document.getElementById('itemsGrid'))   renderItemsGrid();
    if (document.getElementById('profileName')) loadAccountData();
});
