/**
 * Cloud-only sidebar additions: admin nav link + sign-out row.
 * Extracted from app.js so the selfhost boot path never imports it.
 */

export function addCloudUI(auth, navigate) {
    const user = auth.getUser();
    const displayName = user?.displayName || user?.email || 'User';

    // Admin nav link (desktop + mobile)
    if (auth.isAdmin()) {
        const navLinks = document.querySelector('.nav-links');
        if (navLinks) {
            const adminLi = document.createElement('li');
            adminLi.innerHTML = `
                <a href="#admin" class="nav-link" data-page="admin">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/>
                    </svg>
                    <span>Admin</span>
                </a>
            `;
            const settingsLi = navLinks.querySelector('[data-page="settings"]')?.closest('li');
            if (settingsLi) {
                navLinks.insertBefore(adminLi, settingsLi);
            } else {
                navLinks.appendChild(adminLi);
            }
            adminLi.querySelector('.nav-link').addEventListener('click', (e) => {
                e.preventDefault();
                navigate('admin');
            });
        }

        const mobileNav = document.querySelector('.mobile-nav');
        if (mobileNav) {
            const settingsMobileLink = mobileNav.querySelector('[data-page="settings"]');
            if (settingsMobileLink) {
                const adminMobileLink = document.createElement('a');
                adminMobileLink.href = '#admin';
                adminMobileLink.dataset.page = 'admin';
                adminMobileLink.innerHTML = `
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/>
                    </svg>
                    Admin
                `;
                mobileNav.insertBefore(adminMobileLink, settingsMobileLink);
                adminMobileLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    navigate('admin');
                });
            }
        }
    }

    // Sign out row at bottom of sidebar
    const signOutDiv = document.createElement('div');
    signOutDiv.style.cssText = 'padding:8px 18px 12px;border-top:1px solid var(--border);';
    signOutDiv.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;" id="sidebar-display-name"></div>
            <button id="cloud-signout" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;font-weight:500;padding:4px 8px;border-radius:4px;transition:color 0.15s;" onmouseover="this.style.color='var(--text-primary)'" onmouseout="this.style.color='var(--text-muted)'">Sign Out</button>
        </div>
    `;

    const sidebarNav = document.querySelector('.sidebar');
    if (sidebarNav) sidebarNav.appendChild(signOutDiv);

    const nameEl = document.getElementById('sidebar-display-name');
    if (nameEl) {
        nameEl.textContent = displayName;
        nameEl.title = displayName;
    }

    const signOutBtn = document.getElementById('cloud-signout');
    if (signOutBtn) signOutBtn.addEventListener('click', () => auth.signOut());
}
