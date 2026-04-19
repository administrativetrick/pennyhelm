import { store } from './store.js';
import { formatCurrency, escapeHtml } from './utils.js';

const STORAGE_KEY = 'pennyhelm_chat_history';
const MAX_HISTORY = 50;
const MAX_CONTEXT_MESSAGES = 10;

let messages = [];
let isOpen = false;
let isLoading = false;

// ─── Financial Summary Builder ───────────────────────────────────

function monthlyAmount(amount, frequency) {
    switch (frequency) {
        case 'weekly': return amount * 52 / 12;
        case 'biweekly': return amount * 26 / 12;
        case 'semimonthly': return amount * 2;
        case 'semi-annual': return amount / 6;
        case 'quarterly': return amount / 3;
        case 'yearly': return amount / 12;
        default: return amount; // monthly
    }
}

function buildFinancialSummary() {
    const data = store.getData();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Income
    const income = data.income || {};
    const payFreq = data.paySchedule?.frequency || income.user?.frequency || 'biweekly';
    const userMonthlyPay = monthlyAmount(income.user?.payAmount || 0, payFreq);

    let dependentMonthlyPay = 0;
    if (data.dependentEnabled && income.dependent?.employed) {
        dependentMonthlyPay = monthlyAmount(income.dependent?.payAmount || 0, income.dependent?.frequency || 'monthly');
    }

    const otherIncomeTotal = (data.otherIncome || []).reduce((sum, src) => {
        return sum + monthlyAmount(src.amount || 0, src.frequency);
    }, 0);

    const totalMonthlyIncome = userMonthlyPay + dependentMonthlyPay + otherIncomeTotal;

    // Bills
    const bills = (data.bills || []).filter(b => !b.frozen);
    const totalMonthlyBills = bills.reduce((sum, b) => sum + monthlyAmount(b.amount || 0, b.frequency), 0);

    const billsByCategory = {};
    bills.forEach(b => {
        const cat = b.category || 'uncategorized';
        billsByCategory[cat] = (billsByCategory[cat] || 0) + monthlyAmount(b.amount || 0, b.frequency);
    });

    // Unpaid bills this month
    const paidKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const paidThisMonth = data.paidHistory?.[paidKey] || {};
    const isBillPaidForChat = (billId) => {
        if (paidThisMonth[billId]) return true;
        const prefix = billId + '_';
        return Object.keys(paidThisMonth).some(k => k.startsWith(prefix) && paidThisMonth[k]);
    };
    const unpaidBills = bills.filter(b => !isBillPaidForChat(b.id) && b.frequency !== 'yearly');

    // Debts
    const debts = data.debts || [];
    const totalDebt = debts.reduce((s, d) => s + (d.currentBalance || 0), 0);
    const totalMinPayments = debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);

    // Accounts
    const accounts = data.accounts || [];
    const byType = (type) => accounts.filter(a => a.type === type).reduce((s, a) => s + (a.balance || 0), 0);
    const checkingBalance = byType('checking');
    const savingsBalance = byType('savings');
    const creditUsed = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + (a.amountOwed || a.balance || 0), 0);
    const investmentBalance = byType('investment') + byType('retirement');

    // Savings Goals
    const goals = data.savingsGoals || [];

    // Credit Scores
    const creditScores = data.creditScores || {};

    // Build summary
    let s = `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.\n`;
    s += `User: ${data.userName || 'User'}\n`;
    if (data.dependentEnabled) s += `Partner: ${data.dependentName || 'Partner'}\n`;

    s += `\nMONTHLY INCOME: ${formatCurrency(totalMonthlyIncome)}`;
    s += ` (take-home pay: ${formatCurrency(userMonthlyPay)}`;
    if (dependentMonthlyPay > 0) s += `, partner pay: ${formatCurrency(dependentMonthlyPay)}`;
    if (otherIncomeTotal > 0) s += `, other: ${formatCurrency(otherIncomeTotal)}`;
    s += `)\n`;
    s += `Pay frequency: ${payFreq}, pay amount per period: ${formatCurrency(income.user?.payAmount || 0)}\n`;

    // Upcoming pay dates (critical for paycheck-to-paycheck questions)
    try {
        const today = now.toISOString().slice(0, 10);
        const futureDate = new Date(now);
        futureDate.setDate(futureDate.getDate() + 60);
        const payDates = store.getPayDates(today, futureDate.toISOString().slice(0, 10));
        if (payDates.length > 0) {
            s += `Upcoming pay dates: ${payDates.slice(0, 4).map(d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })).join(', ')}\n`;
        }
    } catch (e) { /* getPayDates may not exist in all modes */ }

    if (data.otherIncome?.length > 0) {
        s += `Other income: ${data.otherIncome.map(src => `${src.name}: ${formatCurrency(src.amount)}/${src.frequency}`).join(', ')}\n`;
    }

    s += `\nMONTHLY BILLS: ${formatCurrency(totalMonthlyBills)} across ${bills.length} bills\n`;
    if (Object.keys(billsByCategory).length > 0) {
        s += `By category: ${Object.entries(billsByCategory).map(([cat, amt]) => `${cat}: ${formatCurrency(amt)}`).join(', ')}\n`;
    }

    if (unpaidBills.length > 0) {
        const monthName = now.toLocaleDateString('en-US', { month: 'short' });
        s += `Unpaid this month: ${unpaidBills.slice(0, 15).map(b => `${b.name} (${formatCurrency(b.amount)}, due ${monthName} ${b.dueDay})`).join('; ')}`;
        if (unpaidBills.length > 15) s += ` ...and ${unpaidBills.length - 15} more`;
        s += '\n';
    }

    // All bills with due days for cross-paycheck analysis
    if (bills.length > 0) {
        s += `All active bills: ${bills.slice(0, 20).map(b => `${b.name}: ${formatCurrency(b.amount)} ${b.frequency}, due day ${b.dueDay}${b.autoPay ? ' (autopay)' : ''}`).join('; ')}\n`;
    }

    s += `\nNET MONTHLY: ${formatCurrency(totalMonthlyIncome - totalMonthlyBills)}\n`;

    s += `\nACCOUNTS: Checking: ${formatCurrency(checkingBalance)}, Savings: ${formatCurrency(savingsBalance)}, Credit used: ${formatCurrency(creditUsed)}, Investments: ${formatCurrency(investmentBalance)}\n`;
    if (accounts.length > 0) {
        s += `Details: ${accounts.map(a => `${a.name} (${a.type}): ${formatCurrency(a.balance || 0)}`).join('; ')}\n`;
    }

    if (debts.length > 0) {
        s += `\nDEBTS: Total owed: ${formatCurrency(totalDebt)}, Min monthly payments: ${formatCurrency(totalMinPayments)}\n`;
        s += `Details: ${debts.map(d => `${d.name} (${d.type}): ${formatCurrency(d.currentBalance)} at ${d.interestRate || 0}% APR, min ${formatCurrency(d.minimumPayment || 0)}`).join('; ')}\n`;
        s += `Payoff strategy: ${data.debtBudget?.strategy || 'avalanche'}, monthly budget: ${formatCurrency(data.debtBudget?.totalMonthlyBudget || 0)}\n`;
    }

    if (goals.length > 0) {
        s += `\nSAVINGS GOALS:\n`;
        goals.forEach(g => {
            const pct = g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0;
            s += `- ${g.name}: ${formatCurrency(g.currentAmount)} / ${formatCurrency(g.targetAmount)} (${pct}%)${g.targetDate ? `, target: ${g.targetDate}` : ''}\n`;
        });
    }

    if (creditScores.user?.score) {
        s += `\nCREDIT SCORE: ${creditScores.user.score}`;
        if (data.dependentEnabled && creditScores.dependent?.score) s += `, partner: ${creditScores.dependent.score}`;
        s += '\n';
    }

    return s;
}

// ─── Message Rendering ──────────────────────────────────────────

function formatResponse(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function renderMessages() {
    const container = document.getElementById('chatbot-messages');
    if (!container) return;

    let html = '';
    for (const msg of messages) {
        if (msg.role === 'user') {
            html += `<div class="chatbot-msg chatbot-msg-user">${escapeHtml(msg.content)}</div>`;
        } else {
            html += `<div class="chatbot-msg chatbot-msg-assistant">${formatResponse(msg.content)}</div>`;
        }
    }

    if (isLoading) {
        html += `<div class="chatbot-typing"><span class="chatbot-typing-dot"></span><span class="chatbot-typing-dot"></span><span class="chatbot-typing-dot"></span></div>`;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

// ─── Chat State Persistence ─────────────────────────────────────

function saveHistory() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
    } catch (e) { /* quota exceeded — silently fail */ }
}

function loadHistory() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) messages = JSON.parse(raw);
    } catch (e) { messages = []; }
}

function clearHistory() {
    messages = [];
    localStorage.removeItem(STORAGE_KEY);
    addWelcomeMessage();
    renderMessages();
}

function addWelcomeMessage() {
    messages.push({
        role: 'assistant',
        content: "Hi! I'm your PennyHelm financial assistant. Ask me anything about your bills, income, debts, savings goals, or accounts. I can help you understand your spending, plan ahead, or answer budgeting questions.",
        timestamp: Date.now()
    });
}

// ─── Cloud Function Communication ───────────────────────────────

async function sendMessage(userMessage) {
    messages.push({ role: 'user', content: userMessage, timestamp: Date.now() });
    isLoading = true;
    renderMessages();

    const conversationHistory = messages
        .slice(-MAX_CONTEXT_MESSAGES)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));

    const financialSummary = buildFinancialSummary();

    try {
        const fn = firebase.app().functions().httpsCallable('askFinancialQuestion');
        const result = await fn({
            message: userMessage,
            conversationHistory,
            financialSummary
        });

        messages.push({
            role: 'assistant',
            content: result.data.response,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Chatbot error:', error);
        let errorMsg = 'Sorry, I encountered an error. Please try again.';
        if (error.code === 'functions/resource-exhausted') {
            errorMsg = 'Too many requests. Please wait a moment and try again.';
        } else if (error.code === 'functions/unauthenticated') {
            errorMsg = 'You need to be signed in to use the assistant.';
        }
        messages.push({ role: 'assistant', content: errorMsg, timestamp: Date.now() });
    } finally {
        isLoading = false;
        saveHistory();
        renderMessages();
    }
}

// ─── UI Toggle ──────────────────────────────────────────────────

function togglePanel() {
    isOpen = !isOpen;
    const panel = document.getElementById('chatbot-panel');
    const bubble = document.getElementById('chatbot-bubble');
    if (panel) panel.classList.toggle('open', isOpen);
    if (bubble) bubble.classList.toggle('active', isOpen);

    if (isOpen) {
        const input = document.getElementById('chatbot-input');
        if (input) setTimeout(() => input.focus(), 100);
    }
}

function closePanel() {
    isOpen = false;
    const panel = document.getElementById('chatbot-panel');
    const bubble = document.getElementById('chatbot-bubble');
    if (panel) panel.classList.remove('open');
    if (bubble) bubble.classList.remove('active');
}

// ─── DOM Creation & Initialization ──────────────────────────────

export function initChatbot() {
    loadHistory();
    if (messages.length === 0) addWelcomeMessage();

    // Create bubble
    const bubble = document.createElement('button');
    bubble.id = 'chatbot-bubble';
    bubble.className = 'chatbot-bubble';
    bubble.setAttribute('aria-label', 'Open financial assistant');
    bubble.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    bubble.addEventListener('click', togglePanel);

    // Create panel
    const panel = document.createElement('div');
    panel.id = 'chatbot-panel';
    panel.className = 'chatbot-panel';
    panel.innerHTML = `
        <div class="chatbot-header">
            <div class="chatbot-header-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Financial Assistant
            </div>
            <div class="chatbot-header-actions">
                <button id="chatbot-close" aria-label="Close chat" title="Close">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>
        <div class="chatbot-messages" id="chatbot-messages"></div>
        <div class="chatbot-input-area">
            <input type="text" class="chatbot-input" id="chatbot-input" placeholder="Ask about your finances..." maxlength="2000" autocomplete="off">
            <button class="chatbot-send" id="chatbot-send" aria-label="Send message">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
        </div>
        <div class="chatbot-clear">
            <button id="chatbot-clear-btn">Clear chat</button>
        </div>
    `;

    document.body.appendChild(panel);
    document.body.appendChild(bubble);

    // Event listeners
    document.getElementById('chatbot-close').addEventListener('click', closePanel);
    document.getElementById('chatbot-clear-btn').addEventListener('click', clearHistory);

    const input = document.getElementById('chatbot-input');
    const sendBtn = document.getElementById('chatbot-send');

    function handleSend() {
        const text = input.value.trim();
        if (!text || isLoading) return;
        input.value = '';
        sendMessage(text);
    }

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) closePanel();
    });

    // Initial render
    renderMessages();
}
