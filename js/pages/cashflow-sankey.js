/**
 * Cashflow Sankey Diagram
 *
 * Interactive D3 sankey visualizing how monthly income flows through
 * expense categories and into savings (or shortfall).
 *
 * Depends on window.d3 and window.d3.sankey (loaded via CDN in app.html).
 */

import { formatCurrency } from '../utils.js';

/**
 * Render the Sankey diagram into the given container element.
 *
 * @param {HTMLElement} mount - Element to mount the SVG into (will be cleared)
 * @param {Object} data
 * @param {Array<{name:string, amount:number}>} data.incomeSources
 * @param {Array<[string, number]>} data.expenseCategories - [name, amount] tuples
 * @param {number} data.netCashflow - positive = savings, negative = shortfall
 */
export function renderCashflowSankey(mount, { incomeSources, expenseCategories, netCashflow }) {
    if (!mount) return;
    mount.innerHTML = '';

    const d3 = window.d3;
    if (!d3 || typeof d3.sankey !== 'function' || typeof d3.sankeyLinkHorizontal !== 'function') {
        mount.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:24px;text-align:center;">Chart library failed to load.</div>';
        return;
    }

    let totalIncome = incomeSources.reduce((s, x) => s + x.amount, 0);
    const totalExpenses = expenseCategories.reduce((s, [, v]) => s + v, 0);

    if (totalIncome <= 0 && totalExpenses <= 0) {
        mount.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:24px;text-align:center;">Connect a bank or add income and bills to see your cashflow.</div>';
        return;
    }

    // If we have spending but no income configured, synthesize a balanced income
    // node so the Sankey still draws. Zero out netCashflow so we don't add an
    // unbalanced Shortfall node on top of it.
    if (totalIncome <= 0 && totalExpenses > 0) {
        incomeSources = [{ name: 'Income (estimated)', amount: totalExpenses }];
        totalIncome = totalExpenses;
        netCashflow = 0;
    }

    // Filter out zero/negative expense categories (d3-sankey will throw on value <= 0)
    expenseCategories = expenseCategories.filter(([, v]) => v > 0);

    // ─── Build nodes & links ───
    // Layout:
    //   [income sources]  →  [Monthly Budget hub]  →  [expense categories + Savings/Shortfall]
    const HUB = 'Monthly Budget';
    const SAVINGS = 'Savings';
    const SHORTFALL = 'Shortfall';

    const nodes = [];
    const nodeIndex = new Map();
    const addNode = (name, kind) => {
        if (nodeIndex.has(name)) return nodeIndex.get(name);
        nodeIndex.set(name, nodes.length);
        nodes.push({ name, kind });
        return nodes.length - 1;
    };

    const hubIdx = addNode(HUB, 'hub');
    incomeSources.forEach(src => addNode(src.name, 'income'));
    expenseCategories.forEach(([cat]) => addNode(cat, 'expense'));
    if (netCashflow >= 0 && netCashflow > 0) addNode(SAVINGS, 'savings');
    if (netCashflow < 0) addNode(SHORTFALL, 'shortfall');

    const links = [];
    for (const src of incomeSources) {
        if (src.amount <= 0) continue;
        links.push({
            source: nodeIndex.get(src.name),
            target: hubIdx,
            value: src.amount,
            kind: 'income',
        });
    }
    for (const [cat, amount] of expenseCategories) {
        if (amount <= 0) continue;
        links.push({
            source: hubIdx,
            target: nodeIndex.get(cat),
            value: amount,
            kind: 'expense',
        });
    }
    if (netCashflow > 0) {
        links.push({
            source: hubIdx,
            target: nodeIndex.get(SAVINGS),
            value: netCashflow,
            kind: 'savings',
        });
    } else if (netCashflow < 0) {
        // Shortfall is "income" coming in from outside to balance the hub
        links.push({
            source: nodeIndex.get(SHORTFALL),
            target: hubIdx,
            value: Math.abs(netCashflow),
            kind: 'shortfall',
        });
    }

    // ─── Dimensions ───
    // Fall back to parent width or a sensible default if the mount hasn't laid out yet.
    let width = mount.clientWidth;
    if (!width && mount.parentElement) width = mount.parentElement.clientWidth;
    if (!width) width = 800;
    width = Math.max(320, width);
    const height = Math.max(360, Math.min(640, (nodes.length - 1) * 28 + 120));

    const svg = d3.select(mount)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('max-width', '100%')
        .style('height', 'auto')
        .style('font-family', 'inherit');

    // Note: no .nodeId() — links use numeric indices into the nodes array,
    // which is d3-sankey's default lookup behavior.
    const sankeyGen = d3.sankey()
        .nodeAlign(d3.sankeyJustify)
        .nodeWidth(14)
        .nodePadding(12)
        .extent([[8, 16], [width - 8, height - 16]]);

    let graph;
    try {
        graph = sankeyGen({
            nodes: nodes.map(d => Object.assign({}, d)),
            links: links.map(d => Object.assign({}, d)),
        });
    } catch (err) {
        console.error('[cashflow-sankey] layout failed:', err, { nodes, links });
        mount.innerHTML = `<div style="font-size:13px;color:var(--text-muted);padding:24px;text-align:center;">Chart layout failed: ${escapeHtml(err.message || 'unknown error')}</div>`;
        return;
    }
    if (!graph.nodes.length || !graph.links.length) {
        console.warn('[cashflow-sankey] empty graph', { nodes, links });
        mount.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:24px;text-align:center;">Not enough data to draw the Sankey.</div>';
        return;
    }

    // ─── Colors ───
    const color = (d) => {
        switch (d.kind) {
            case 'income':    return '#10b981'; // green
            case 'hub':       return '#6366f1'; // indigo
            case 'expense':   return '#ef4444'; // red
            case 'savings':   return '#22c55e'; // emerald
            case 'shortfall': return '#f59e0b'; // amber
            default:          return '#888';
        }
    };
    const linkColor = (d) => {
        switch (d.kind) {
            case 'income':    return '#10b981';
            case 'expense':   return '#ef4444';
            case 'savings':   return '#22c55e';
            case 'shortfall': return '#f59e0b';
            default:          return '#888';
        }
    };

    // ─── Tooltip ───
    const tooltip = d3.select(mount).append('div')
        .attr('class', 'sankey-tooltip')
        .style('position', 'absolute')
        .style('pointer-events', 'none')
        .style('padding', '8px 10px')
        .style('background', 'var(--bg-secondary, #1f2937)')
        .style('color', 'var(--text-primary, #fff)')
        .style('border', '1px solid var(--border, #333)')
        .style('border-radius', '6px')
        .style('font-size', '12px')
        .style('box-shadow', '0 4px 12px rgba(0,0,0,0.25)')
        .style('opacity', 0)
        .style('transition', 'opacity 120ms')
        .style('z-index', 10);

    // Position the container relatively so the absolute tooltip anchors correctly
    const computedPosition = window.getComputedStyle(mount).position;
    if (computedPosition === 'static') {
        mount.style.position = 'relative';
    }

    const showTooltip = (event, html) => {
        const rect = mount.getBoundingClientRect();
        tooltip.html(html)
            .style('left', (event.clientX - rect.left + 12) + 'px')
            .style('top', (event.clientY - rect.top + 12) + 'px')
            .style('opacity', 1);
    };
    const hideTooltip = () => tooltip.style('opacity', 0);

    // ─── Links ───
    const linkGroup = svg.append('g')
        .attr('fill', 'none')
        .attr('stroke-opacity', 0.35);

    linkGroup.selectAll('path')
        .data(graph.links)
        .join('path')
        .attr('d', d3.sankeyLinkHorizontal())
        .attr('stroke', linkColor)
        .attr('stroke-width', d => Math.max(1, d.width))
        .style('mix-blend-mode', 'multiply')
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke-opacity', 0.65);
            const pct = totalIncome > 0 ? (d.value / totalIncome * 100).toFixed(1) : '0.0';
            showTooltip(event, `
                <div style="font-weight:700;margin-bottom:2px;">${escapeHtml(d.source.name)} → ${escapeHtml(d.target.name)}</div>
                <div>${formatCurrency(d.value)} <span style="opacity:0.7;">(${pct}% of income)</span></div>
            `);
        })
        .on('mousemove', (event) => {
            const rect = mount.getBoundingClientRect();
            tooltip
                .style('left', (event.clientX - rect.left + 12) + 'px')
                .style('top', (event.clientY - rect.top + 12) + 'px');
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke-opacity', 0.35);
            hideTooltip();
        });

    // ─── Nodes ───
    const nodeGroup = svg.append('g');

    nodeGroup.selectAll('rect')
        .data(graph.nodes)
        .join('rect')
        .attr('x', d => d.x0)
        .attr('y', d => d.y0)
        .attr('width', d => d.x1 - d.x0)
        .attr('height', d => Math.max(1, d.y1 - d.y0))
        .attr('fill', color)
        .attr('rx', 3)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this).attr('opacity', 0.85);
            const incoming = graph.links.filter(l => l.target.name === d.name).reduce((s, l) => s + l.value, 0);
            const outgoing = graph.links.filter(l => l.source.name === d.name).reduce((s, l) => s + l.value, 0);
            const total = Math.max(incoming, outgoing);
            const pct = totalIncome > 0 ? (total / totalIncome * 100).toFixed(1) : '0.0';
            showTooltip(event, `
                <div style="font-weight:700;margin-bottom:2px;">${escapeHtml(d.name)}</div>
                <div>${formatCurrency(total)} <span style="opacity:0.7;">(${pct}% of income)</span></div>
            `);
        })
        .on('mousemove', (event) => {
            const rect = mount.getBoundingClientRect();
            tooltip
                .style('left', (event.clientX - rect.left + 12) + 'px')
                .style('top', (event.clientY - rect.top + 12) + 'px');
        })
        .on('mouseout', function() {
            d3.select(this).attr('opacity', 1);
            hideTooltip();
        });

    // ─── Node labels ───
    nodeGroup.selectAll('text')
        .data(graph.nodes)
        .join('text')
        .attr('x', d => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
        .attr('y', d => (d.y0 + d.y1) / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
        .attr('fill', 'currentColor')
        .style('font-size', '12px')
        .style('font-weight', 600)
        .style('pointer-events', 'none')
        .text(d => {
            const incoming = graph.links.filter(l => l.target.name === d.name).reduce((s, l) => s + l.value, 0);
            const outgoing = graph.links.filter(l => l.source.name === d.name).reduce((s, l) => s + l.value, 0);
            const total = Math.max(incoming, outgoing);
            return `${d.name} — ${formatCurrency(total)}`;
        });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
