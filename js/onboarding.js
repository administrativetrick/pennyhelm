// ─────────────────────────────────────────────
// ONBOARDING GUIDE
// ─────────────────────────────────────────────

import { store } from './store.js';

var ONBOARDING_KEY = 'pennyhelm_onboarding_complete';
var ONBOARDING_VERSION = 2; // Bumped for usage type step

var currentStep = 0;
var totalSteps = 0;
var onboardingOverlay = null;
var activeSteps = []; // Built dynamically based on user choices

var BASE_STEPS = [
    {
        id: 'welcome',
        title: 'Welcome to PennyHelm!',
        body: 'PennyHelm is your personal finance command center. Let\'s take a quick tour of the key features so you can get the most out of it.',
        icon: '\uD83D\uDE80',
        highlight: null,
        position: 'center',
    },
    {
        id: 'usage-type',
        title: 'How will you use PennyHelm?',
        body: 'This helps us tailor the experience. You can change this anytime in Settings.',
        icon: '\uD83C\uDFAF',
        highlight: null,
        position: 'center',
        interactive: 'usage-type',
    },
    {
        id: 'business-name',
        title: 'Create Your First Business',
        body: 'Add a business name to start categorizing expenses. You can add more later in Settings.',
        icon: '\uD83C\uDFE2',
        highlight: null,
        position: 'center',
        interactive: 'business-name',
        conditional: function() {
            var ut = store.getUsageType();
            return ut === 'business' || ut === 'both';
        },
    },
    {
        id: 'dashboard',
        title: 'Dashboard',
        body: 'Your financial overview at a glance. See your monthly income, total bills, remaining balance, net worth, and pay period breakdowns. You can even customize which widgets you see by clicking the gear icon.',
        icon: '\uD83D\uDCCA',
        highlight: '[data-page="dashboard"]',
        position: 'right',
    },
    {
        id: 'bills',
        title: 'Bills',
        body: 'Track all your recurring bills in one place. Add bills with due dates, amounts, categories, and payment sources. Mark bills as paid each month to see your progress.',
        icon: '\uD83D\uDCCB',
        highlight: '[data-page="bills"]',
        position: 'right',
    },
    {
        id: 'calendar',
        title: 'Calendar',
        body: 'See your bills on a monthly calendar so you know exactly what\'s due and when. Bills are color-coded by payment status \u2014 paid, upcoming, or overdue.',
        icon: '\uD83D\uDCC5',
        highlight: '[data-page="calendar"]',
        position: 'right',
    },
    {
        id: 'income',
        title: 'Income',
        body: 'Set up your pay schedule and track all income sources. This page also includes sub-tabs for tax documents, deductions, and assets. You\'ll also find your balance history chart here.',
        icon: '\uD83D\uDCB0',
        highlight: '[data-page="income"]',
        position: 'right',
    },
    {
        id: 'debts',
        title: 'Debts & Expenses',
        body: 'Manage your debt payoff strategy and track expenses. If you connect a bank account, transactions are automatically imported as expenses. You can mark each expense as Personal or Business.',
        icon: '\uD83D\uDCB3',
        highlight: '[data-page="debts"]',
        position: 'right',
    },
    {
        id: 'accounts',
        title: 'Accounts',
        body: 'Connect your bank accounts, credit cards, investments, and track property or vehicle values. Your accounts feed into your net worth calculation on the dashboard.',
        icon: '\uD83C\uDFE6',
        highlight: '[data-page="accounts"]',
        position: 'right',
    },
    {
        id: 'settings',
        title: 'Settings',
        body: 'Configure your profile, pay schedule, credit scores, payment sources, business names, and more. You can also manage a partner or household member and set your preferred theme.',
        icon: '\u2699\uFE0F',
        highlight: '[data-page="settings"]',
        position: 'right',
    },
    {
        id: 'reports',
        title: 'Reports & Export',
        body: 'Click the Reports tab here to generate PDF reports or export your data as CSV files. Great for sharing with your accountant or keeping records.',
        icon: '\uD83D\uDCC4',
        highlight: '.filter-chip[data-tab="reports"]',
        position: 'content',
    },
    {
        id: 'done',
        title: 'You\'re All Set!',
        body: 'Start by adding your income in Settings, then add your bills, and connect your accounts. PennyHelm will handle the rest \u2014 showing you where every dollar goes.\n\nYou can revisit this guide anytime from Settings.',
        icon: '\u2705',
        highlight: null,
        position: 'center',
    },
];

function buildActiveSteps() {
    activeSteps = [];
    for (var i = 0; i < BASE_STEPS.length; i++) {
        var step = BASE_STEPS[i];
        if (step.conditional && !step.conditional()) {
            continue;
        }
        activeSteps.push(step);
    }
    totalSteps = activeSteps.length;
}

export function shouldShowOnboarding() {
    var saved = localStorage.getItem(ONBOARDING_KEY);
    if (!saved) return true;
    try {
        var data = JSON.parse(saved);
        return data.version < ONBOARDING_VERSION;
    } catch (e) {
        return true;
    }
}

export function markOnboardingComplete() {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({
        version: ONBOARDING_VERSION,
        completedAt: new Date().toISOString(),
    }));
}

export function resetOnboarding() {
    localStorage.removeItem(ONBOARDING_KEY);
}

export function startOnboarding() {
    currentStep = 0;
    buildActiveSteps();
    // Navigate to dashboard so sidebar highlights and Reports chip are available
    if (window.location.hash !== '#dashboard' && window.location.hash !== '') {
        window.location.hash = 'dashboard';
    }
    // Small delay to let dashboard render before showing overlay
    setTimeout(function() {
        createOverlay();
        renderStep();
    }, 100);
}

function createOverlay() {
    // Remove if exists
    var existing = document.getElementById('onboarding-overlay');
    if (existing) existing.remove();

    onboardingOverlay = document.createElement('div');
    onboardingOverlay.id = 'onboarding-overlay';
    onboardingOverlay.className = 'onboarding-overlay';
    onboardingOverlay.innerHTML = '<div class="onboarding-backdrop"></div><div class="onboarding-card" id="onboarding-card"></div><div class="onboarding-highlight-ring" id="onboarding-highlight"></div>';
    document.body.appendChild(onboardingOverlay);

    // Backdrop click = nothing (force use buttons)
    onboardingOverlay.querySelector('.onboarding-backdrop').addEventListener('click', function(e) {
        e.stopPropagation();
    });
}

function ensureDashboard(callback) {
    if (window.location.hash !== '#dashboard') {
        window.location.hash = 'dashboard';
        setTimeout(callback, 150);
    } else {
        callback();
    }
}

function renderStep() {
    var step = activeSteps[currentStep];

    // Make sure we're on the dashboard for steps that highlight sidebar or dashboard content
    if (step.highlight && window.location.hash !== '#dashboard') {
        ensureDashboard(function() { renderStep(); });
        return;
    }
    var card = document.getElementById('onboarding-card');
    var highlight = document.getElementById('onboarding-highlight');
    var isFirst = currentStep === 0;
    var isLast = currentStep === totalSteps - 1;

    // Build card HTML
    var html = '';
    html += '<div class="onboarding-card-inner">';

    // Progress bar
    html += '<div class="onboarding-progress">';
    html += '<div class="onboarding-progress-fill" style="width:' + ((currentStep + 1) / totalSteps * 100) + '%;"></div>';
    html += '</div>';

    // Step counter
    html += '<div class="onboarding-step-counter">' + (currentStep + 1) + ' of ' + totalSteps + '</div>';

    // Icon
    html += '<div class="onboarding-icon">' + step.icon + '</div>';

    // Title
    html += '<h3 class="onboarding-title">' + step.title + '</h3>';

    // Body
    var bodyLines = step.body.split('\n');
    bodyLines.forEach(function(line) {
        if (line.trim() === '') {
            html += '<br>';
        } else {
            html += '<p class="onboarding-body">' + line + '</p>';
        }
    });

    // Interactive content
    if (step.interactive === 'usage-type') {
        html += renderUsageTypeStep();
    } else if (step.interactive === 'business-name') {
        html += renderBusinessNameStep();
    }

    // Buttons
    html += '<div class="onboarding-actions">';
    if (isFirst) {
        html += '<button class="btn btn-secondary btn-sm onboarding-skip" id="onboarding-skip">Skip Tour</button>';
        html += '<button class="btn btn-primary btn-sm onboarding-next" id="onboarding-next">Let\'s Go!</button>';
    } else if (isLast) {
        html += '<button class="btn btn-secondary btn-sm onboarding-back" id="onboarding-back">Back</button>';
        html += '<button class="btn btn-primary btn-sm onboarding-finish" id="onboarding-finish">Get Started</button>';
    } else if (step.interactive === 'usage-type') {
        html += '<button class="btn btn-secondary btn-sm onboarding-back" id="onboarding-back">Back</button>';
        html += '<div style="display:flex;gap:8px;align-items:center;">';
        html += '<button class="btn onboarding-skip-small" id="onboarding-skip" style="font-size:11px;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:4px 8px;">Skip</button>';
        html += '<button class="btn btn-primary btn-sm onboarding-next" id="onboarding-next">Next</button>';
        html += '</div>';
    } else if (step.interactive === 'business-name') {
        html += '<button class="btn btn-secondary btn-sm onboarding-back" id="onboarding-back">Back</button>';
        html += '<div style="display:flex;gap:8px;align-items:center;">';
        html += '<button class="btn onboarding-skip-small" id="onboarding-skip-biz" style="font-size:11px;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:4px 8px;">Skip</button>';
        html += '<button class="btn btn-primary btn-sm" id="onboarding-save-biz">Save & Continue</button>';
        html += '</div>';
    } else {
        html += '<button class="btn btn-secondary btn-sm onboarding-back" id="onboarding-back">Back</button>';
        html += '<div style="display:flex;gap:8px;align-items:center;">';
        html += '<button class="btn onboarding-skip-small" id="onboarding-skip" style="font-size:11px;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:4px 8px;">Skip</button>';
        html += '<button class="btn btn-primary btn-sm onboarding-next" id="onboarding-next">Next</button>';
        html += '</div>';
    }
    html += '</div>';
    html += '</div>';

    card.innerHTML = html;

    // Position card and highlight
    positionCard(step, card, highlight);

    // Bind events
    bindStepEvents(step);
}

function renderUsageTypeStep() {
    var currentType = store.getUsageType() || '';
    var html = '<div class="onboarding-usage-type" style="display:flex;gap:10px;margin:16px 0;justify-content:center;">';
    var options = [
        { value: 'personal', label: 'Personal', icon: '\uD83D\uDC64', desc: 'Track personal finances' },
        { value: 'business', label: 'Business', icon: '\uD83D\uDCBC', desc: 'Track business expenses' },
        { value: 'both', label: 'Both', icon: '\uD83D\uDD00', desc: 'Personal + business' },
    ];
    for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        var selected = currentType === opt.value ? ' onboarding-option-selected' : '';
        html += '<button class="onboarding-option-btn' + selected + '" data-usage="' + opt.value + '" style="flex:1;padding:12px 8px;border-radius:8px;border:2px solid ' + (currentType === opt.value ? 'var(--accent)' : 'var(--border)') + ';background:' + (currentType === opt.value ? 'var(--accent)10' : 'var(--bg-secondary)') + ';cursor:pointer;text-align:center;">';
        html += '<div style="font-size:24px;margin-bottom:4px;">' + opt.icon + '</div>';
        html += '<div style="font-weight:600;font-size:13px;">' + opt.label + '</div>';
        html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + opt.desc + '</div>';
        html += '</button>';
    }
    html += '</div>';
    return html;
}

function renderBusinessNameStep() {
    var existingNames = store.getBusinessNames();
    var html = '<div style="margin:16px 0;">';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
    html += '<input type="text" class="form-input" id="onboarding-biz-name" placeholder="e.g., Acme Corp" style="flex:1;font-size:14px;padding:10px 12px;">';
    html += '</div>';
    if (existingNames.length > 0) {
        html += '<div style="margin-top:8px;">';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Your businesses:</div>';
        for (var i = 0; i < existingNames.length; i++) {
            html += '<span class="badge" style="background:var(--accent)15;color:var(--accent);border:1px solid var(--accent)30;margin:2px 4px 2px 0;">' + existingNames[i] + '</span>';
        }
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function bindStepEvents(step) {
    var skipBtn = document.getElementById('onboarding-skip');
    var nextBtn = document.getElementById('onboarding-next');
    var backBtn = document.getElementById('onboarding-back');
    var finishBtn = document.getElementById('onboarding-finish');

    if (skipBtn) {
        skipBtn.addEventListener('click', function() {
            finishOnboarding();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            // Save usage type if on that step
            if (step.interactive === 'usage-type') {
                // Rebuild steps since conditional steps may change
                buildActiveSteps();
                // Find the next step index in the new array
                var nextStepIndex = -1;
                for (var i = 0; i < activeSteps.length; i++) {
                    if (activeSteps[i].id === step.id) {
                        nextStepIndex = i + 1;
                        break;
                    }
                }
                currentStep = nextStepIndex >= 0 ? nextStepIndex : currentStep + 1;
            } else {
                currentStep++;
            }
            renderStep();
        });
    }
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            currentStep--;
            if (currentStep < 0) currentStep = 0;
            // Rebuild steps in case we need to recalculate
            buildActiveSteps();
            if (currentStep >= activeSteps.length) currentStep = activeSteps.length - 1;
            renderStep();
        });
    }
    if (finishBtn) {
        finishBtn.addEventListener('click', function() {
            finishOnboarding();
        });
    }

    // Interactive: usage type buttons
    if (step.interactive === 'usage-type') {
        var optBtns = document.querySelectorAll('.onboarding-option-btn');
        optBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                // Update visuals
                optBtns.forEach(function(b) {
                    b.style.border = '2px solid var(--border)';
                    b.style.background = 'var(--bg-secondary)';
                    b.classList.remove('onboarding-option-selected');
                });
                btn.style.border = '2px solid var(--accent)';
                btn.style.background = 'var(--accent)10';
                btn.classList.add('onboarding-option-selected');
                // Save to store
                store.setUsageType(btn.dataset.usage);
            });
        });
    }

    // Interactive: business name
    if (step.interactive === 'business-name') {
        var saveBizBtn = document.getElementById('onboarding-save-biz');
        var skipBizBtn = document.getElementById('onboarding-skip-biz');

        if (saveBizBtn) {
            saveBizBtn.addEventListener('click', function() {
                var input = document.getElementById('onboarding-biz-name');
                var name = input ? input.value.trim() : '';
                if (name) {
                    store.addBusinessName(name);
                }
                currentStep++;
                renderStep();
            });
        }
        if (skipBizBtn) {
            skipBizBtn.addEventListener('click', function() {
                currentStep++;
                renderStep();
            });
        }

        // Enter key in input
        var bizInput = document.getElementById('onboarding-biz-name');
        if (bizInput) {
            bizInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && saveBizBtn) {
                    saveBizBtn.click();
                }
            });
            // Auto-focus
            setTimeout(function() { bizInput.focus(); }, 100);
        }
    }
}

function positionCard(step, card, highlight) {
    // Reset
    card.style.position = 'fixed';
    card.style.top = '';
    card.style.left = '';
    card.style.transform = '';
    highlight.style.display = 'none';
    card.classList.remove('onboarding-card-right', 'onboarding-card-center', 'onboarding-card-content');

    if (!step.highlight) {
        // Center the card
        card.classList.add('onboarding-card-center');
        return;
    }

    // Find the element to highlight
    var target = document.querySelector(step.highlight);
    if (!target) {
        card.classList.add('onboarding-card-center');
        return;
    }

    var rect = target.getBoundingClientRect();

    // Show highlight ring around the element
    highlight.style.display = 'block';
    highlight.style.top = (rect.top - 4) + 'px';
    highlight.style.left = (rect.left - 4) + 'px';
    highlight.style.width = (rect.width + 8) + 'px';
    highlight.style.height = (rect.height + 8) + 'px';

    var isMobile = window.innerWidth <= 768;

    if (step.position === 'content') {
        // Position card below the highlighted element in the main content area
        if (isMobile) {
            card.classList.add('onboarding-card-center');
        } else {
            card.classList.add('onboarding-card-content');
            var topPos = rect.bottom + 16;
            var leftPos = Math.max(20, rect.left);
            // Keep card on screen
            if (topPos + 360 > window.innerHeight) {
                topPos = Math.max(20, rect.top - 370);
            }
            if (leftPos + 400 > window.innerWidth) {
                leftPos = window.innerWidth - 420;
            }
            card.style.top = topPos + 'px';
            card.style.left = leftPos + 'px';
        }
    } else {
        // Sidebar items: position card to the right of sidebar
        if (isMobile) {
            card.classList.add('onboarding-card-center');
        } else {
            card.classList.add('onboarding-card-right');
            // Vertically align near the highlighted item
            var cardHeight = 340; // approximate
            var topPos = Math.max(20, Math.min(rect.top - 40, window.innerHeight - cardHeight - 20));
            card.style.top = topPos + 'px';
        }
    }
}

function finishOnboarding() {
    markOnboardingComplete();
    destroyOverlay();
}

function destroyOverlay() {
    if (onboardingOverlay) {
        onboardingOverlay.classList.add('onboarding-fade-out');
        setTimeout(function() {
            if (onboardingOverlay && onboardingOverlay.parentNode) {
                onboardingOverlay.parentNode.removeChild(onboardingOverlay);
            }
            onboardingOverlay = null;
        }, 300);
    }
}
