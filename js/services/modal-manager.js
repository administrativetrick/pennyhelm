/**
 * ModalManager — centralized modal dialog management.
 *
 * Extracted from app.js to separate UI component logic from application orchestration.
 * Provides generic open/close plus specific modal builders for subscription flows.
 */

// ─── Generic Modal ────────────────────────────────

export function openModal(title, contentHtml) {
    const overlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    modalTitle.textContent = title;
    modalBody.innerHTML = contentHtml;
    overlay.classList.add('open');
}

export function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
}

// ─── Toast Notifications ──────────────────────────

export function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s;';

    const colors = {
        success: 'background:var(--green-bg,#dcfce7);color:var(--green,#16a34a);border:1px solid var(--green,#16a34a);',
        error: 'background:var(--red-bg,#fef2f2);color:var(--red,#dc2626);border:1px solid var(--red,#dc2626);',
        info: 'background:var(--accent-bg,#eff6ff);color:var(--accent,#3b82f6);border:1px solid var(--accent,#3b82f6);',
    };
    toast.style.cssText += colors[type] || colors.info;
    toast.textContent = message;

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ─── Subscription Modal ───────────────────────────

export function showSubscriptionModal(auth) {
    openModal('Choose Your Plan', `
        <div style="margin-bottom:16px;">
            <p style="color:var(--text-secondary);margin-bottom:16px;">Select a plan to continue using PennyHelm Cloud.</p>
            <div id="plan-options" style="display:flex;gap:12px;flex-wrap:wrap;">
                <div class="plan-option" data-plan="annual" style="flex:1;min-width:180px;background:var(--accent-bg);border:2px solid var(--accent);border-radius:12px;padding:20px;cursor:pointer;text-align:center;position:relative;">
                    <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:10px;white-space:nowrap;">BEST VALUE</div>
                    <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">Annual</div>
                    <div style="font-size:24px;font-weight:800;color:var(--text-primary);">$4.99<span style="font-size:13px;font-weight:500;color:var(--text-secondary);">/mo</span></div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">$59.88/yr first year</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Then $8/mo ($96/yr)</div>
                </div>
                <div class="plan-option" data-plan="monthly" style="flex:1;min-width:180px;background:var(--bg-card);border:2px solid var(--border);border-radius:12px;padding:20px;cursor:pointer;text-align:center;">
                    <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">Monthly</div>
                    <div style="font-size:24px;font-weight:800;color:var(--text-primary);">$10<span style="font-size:13px;font-weight:500;color:var(--text-secondary);">/mo</span></div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Billed monthly</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Cancel anytime</div>
                </div>
            </div>
            <p style="font-size:12px;color:var(--text-muted);margin-top:12px;text-align:center;">Cancel anytime</p>
        </div>
        <div id="subscribe-error" style="color:var(--red);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-subscribe">Subscribe</button>
        </div>
    `);

    let selectedPlan = 'annual';
    const planOptions = document.querySelectorAll('.plan-option');
    planOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            planOptions.forEach(o => {
                o.style.borderColor = 'var(--border)';
                o.style.background = 'var(--bg-card)';
            });
            opt.style.borderColor = 'var(--accent)';
            opt.style.background = 'var(--accent-bg)';
            selectedPlan = opt.dataset.plan;
        });
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-subscribe').addEventListener('click', async () => {
        const btn = document.getElementById('modal-subscribe');
        const errorDiv = document.getElementById('subscribe-error');
        btn.textContent = 'Redirecting...';
        btn.disabled = true;

        try {
            const result = await auth.createCheckoutSession(selectedPlan);
            if (result.url) {
                window.location.href = result.url;
            } else {
                errorDiv.textContent = 'Failed to create checkout session.';
                errorDiv.style.display = 'block';
                btn.textContent = 'Subscribe';
                btn.disabled = false;
            }
        } catch (e) {
            console.error('Checkout error:', e);
            errorDiv.textContent = 'Something went wrong. Please try again.';
            errorDiv.style.display = 'block';
            btn.textContent = 'Subscribe';
            btn.disabled = false;
        }
    });
}

// ─── Redeem Code Modal ────────────────────────────

export function showRedeemCodeModal(auth) {
    // This flow is cloud-only. It's only ever imported by the cloud mode's
    // gateAccess phase (js/mode/cloud.js); selfhost never reaches it.
    openModal('Redeem Trial Code', `
        <div class="form-group">
            <label>Enter your trial code</label>
            <input type="text" class="form-input" id="redeem-code-input"
                   placeholder="e.g., BETA2026" style="text-transform:uppercase;font-family:monospace;">
        </div>
        <div id="redeem-error" style="color:var(--red);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-redeem">Redeem</button>
        </div>
    `);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-redeem').addEventListener('click', async () => {
        const code = document.getElementById('redeem-code-input').value.trim().toUpperCase();
        const errorDiv = document.getElementById('redeem-error');

        if (!code) {
            errorDiv.textContent = 'Please enter a code.';
            errorDiv.style.display = 'block';
            return;
        }

        const db = firebase.firestore();
        try {
            const codeDoc = await db.collection('trialCodeLookup').doc(code).get();
            if (!codeDoc.exists) {
                errorDiv.textContent = 'Invalid code.';
                errorDiv.style.display = 'block';
                return;
            }
            const codeData = codeDoc.data();
            if (!codeData.active) {
                errorDiv.textContent = 'This code is no longer active.';
                errorDiv.style.display = 'block';
                return;
            }
            if (codeData.maxUses > 0 && codeData.currentUses >= codeData.maxUses) {
                errorDiv.textContent = 'This code has reached its maximum uses.';
                errorDiv.style.display = 'block';
                return;
            }

            const uid = auth.getUserId();
            await db.collection('users').doc(uid).update({
                subscriptionStatus: 'trial',
                trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
                trialCode: code,
                trialDays: codeData.trialDays
            });

            closeModal();
            window.location.reload();
        } catch (e) {
            errorDiv.textContent = 'Failed to redeem code. Please try again.';
            errorDiv.style.display = 'block';
            console.error('Redemption error:', e);
        }
    });
}

// ─── Trial/Subscription Banners ───────────────────

export function showPastDueBanner(onManage) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:var(--red-bg);color:var(--red);text-align:center;padding:8px 16px;font-size:13px;font-weight:600;border-bottom:1px solid var(--red);position:fixed;top:0;left:0;right:0;z-index:200;';
    banner.innerHTML = 'Payment issue with your subscription. <a href="#" style="color:var(--accent);text-decoration:underline;margin-left:8px;" id="pastdue-manage-btn">Update payment method</a>';
    document.body.prepend(banner);
    document.body.style.paddingTop = '36px';
    document.getElementById('pastdue-manage-btn').addEventListener('click', (e) => {
        e.preventDefault();
        onManage();
    });
}

export function showTrialBanner(daysRemaining, onSubscribe) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:var(--orange-bg);color:var(--orange);text-align:center;padding:8px 16px;font-size:13px;font-weight:600;border-bottom:1px solid var(--orange);position:fixed;top:0;left:0;right:0;z-index:200;';
    banner.innerHTML = 'Your free trial expires in <strong>' + daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : '') + '</strong>. <a href="#" style="color:var(--accent);text-decoration:underline;margin-left:8px;" id="trial-banner-subscribe">Subscribe &mdash; plans from $4.99/mo</a>';
    document.body.prepend(banner);
    document.getElementById('trial-banner-subscribe').addEventListener('click', (e) => {
        e.preventDefault();
        onSubscribe();
    });
    document.body.style.paddingTop = '36px';
}

export function showTrialExpiredScreen(auth, onSubscribe, onRedeem) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'none';
    const main = document.getElementById('main-content');
    if (main) {
        main.style.marginLeft = '0';
        main.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
                <div style="max-width:480px;text-align:center;padding:40px;">
                    <div style="width:64px;height:64px;background:linear-gradient(135deg,var(--accent),#7c3aed);border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;margin:0 auto 24px;">PH</div>
                    <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:12px;">Your Trial Has Expired</h1>
                    <p style="color:var(--text-secondary);margin-bottom:8px;">Your free trial of PennyHelm Cloud has ended.</p>
                    <p style="color:var(--text-secondary);margin-bottom:8px;">Subscribe to continue using PennyHelm Cloud, or redeem a trial code.</p>
                    <div style="background:var(--accent-bg);border:1px solid var(--accent);border-radius:10px;padding:16px;margin-bottom:24px;text-align:center;">
                        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">Plans starting at</div>
                        <div style="font-size:24px;font-weight:800;color:var(--text-primary);">$4.99<span style="font-size:14px;font-weight:500;color:var(--text-secondary);">/mo</span></div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">First year annual &middot; $10/mo monthly</div>
                    </div>
                    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                        <button style="padding:12px 28px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;" id="expired-subscribe-btn">Subscribe Now</button>
                        <button style="padding:12px 28px;background:transparent;color:var(--text-primary);border:1px solid var(--border);border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;" id="trial-redeem-code">Redeem Code</button>
                        <button style="padding:12px 28px;background:transparent;color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;" id="trial-signout">Sign Out</button>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('trial-signout')?.addEventListener('click', () => auth.signOut());
        document.getElementById('trial-redeem-code')?.addEventListener('click', () => onRedeem());
        document.getElementById('expired-subscribe-btn')?.addEventListener('click', () => onSubscribe());
    }
}

// ─── Stripe Portal ────────────────────────────────

export async function openManageSubscription(auth) {
    try {
        const result = await auth.createPortalSession();
        if (result.url) {
            window.location.href = result.url;
        }
    } catch (e) {
        console.error('Portal error:', e);
        alert('Unable to open subscription management. Please try again.');
    }
}
