// MFA Guard — blocks sensitive features (document uploads, statement scanning)
// when the user hasn't enabled two-factor authentication.
import { auth } from './auth.js';
import { capabilities } from './mode/mode.js';
import { openModal, closeModal } from './app.js';

export function requireMFAForUpload(callback) {
    if (!capabilities().mfa || auth.isMFAEnabled()) {
        callback();
        return;
    }

    openModal('Two-Factor Authentication Required', `
        <div style="padding:8px 0 16px;">
            <div style="font-size:48px;text-align:center;margin-bottom:12px;">&#128274;</div>
            <p style="font-size:14px;line-height:1.6;color:var(--text-secondary);">
                Document uploads and statement scanning require two-factor authentication (2FA)
                to protect your sensitive financial data.
            </p>
            <p style="font-size:14px;color:var(--text-secondary);margin-top:12px;">
                Please enable 2FA in <strong>Settings &rarr; Security</strong> before using this feature.
            </p>
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="mfa-goto-settings">Go to Settings</button>
        </div>
    `);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('mfa-goto-settings').addEventListener('click', () => {
        closeModal();
        window.location.hash = 'settings';
    });
}
