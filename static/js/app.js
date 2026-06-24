/* ============================================================
   AIM Dashboard — Analytics in Motion
   Single-Page Application (FastAPI + Vanilla JS)
   ============================================================ */
(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────
    const S = {
        user: null,
        token: null,
        masterData: null,   // summary from /api/data/summary
        currentPage: 'welcome',
        fileUploaded: false,
        pdfReady: false,
        rules: null,
        comparisonData: null,
    };

    // ── Constants ─────────────────────────────────────────────
    const PRIMARY = '#10385A'; // Protiviti Navy
    const SECONDARY = '#E57200'; // Protiviti Orange
    const ACCENT = '#5998C5'; // Protiviti Light Blue
    const RED = '#EF4444';
    const GREEN = '#10B981';
    const AMBER = '#F59E0B';
    const COLORWAY = [PRIMARY, SECONDARY, ACCENT, RED, GREEN, '#14B8A6', '#64748B', AMBER, '#8B5CF6', '#EC4899'];
    const PLOTLY_LAYOUT = {
        font: { family: 'Inter, sans-serif', size: 13, color: '#1E293B' },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 60, r: 40, t: 30, b: 40 },
        colorway: COLORWAY,
    };

    const PLOTLY_CFG = { displayModeBar: false, responsive: false };

    // Resize all visible Plotly charts — called on window resize, fullscreen, and cache restore.
    function resizeAllPlots() {
        document.querySelectorAll('.js-plotly-plot').forEach(function (p) {
            if (p.offsetWidth > 0 && p.offsetHeight > 0) {
                try { Plotly.Plots.resize(p); } catch (e) { /* ignore */ }
            }
        });
    }
    var _resizeDebounce;
    function debouncedResize() {
        clearTimeout(_resizeDebounce);
        _resizeDebounce = setTimeout(resizeAllPlots, 100);
    }
    window.addEventListener('resize', debouncedResize);
    document.addEventListener('fullscreenchange', debouncedResize);
    document.addEventListener('webkitfullscreenchange', debouncedResize);

    function pLayout(extra) {
        const base = JSON.parse(JSON.stringify(PLOTLY_LAYOUT));
        if (extra) {
            // Deep-merge margin so individual sides aren't lost
            if (extra.margin) {
                base.margin = Object.assign({}, base.margin, extra.margin);
                delete extra.margin;
            }
            Object.assign(base, extra);
        }
        return base;
    }

    function severityColor(rate) {
        if (rate >= 40) return RED;
        if (rate >= 20) return AMBER;
        return GREEN;
    }

    // ── Toast Notifications ───────────────────────────────────
    function ensureToastContainer() {
        let c = document.querySelector('.toast-container');
        if (!c) {
            c = document.createElement('div');
            c.className = 'toast-container';
            document.body.appendChild(c);
        }
        return c;
    }

    function showToast(msg, type) {
        type = type || 'info';
        const c = ensureToastContainer();
        const t = document.createElement('div');
        t.className = 'toast toast-' + type;
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(function () {
            t.classList.add('removing');
            setTimeout(function () { t.remove(); }, 300);
        }, 3500);
    }

    // ── API Client ────────────────────────────────────────────
    async function api(url, options) {
        options = options || {};
        const token = sessionStorage.getItem('aim_token');
        const headers = Object.assign({}, options.headers || {});
        if (token) headers['Authorization'] = 'Bearer ' + token;
        if (options.body && !(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }
        try {
            const resp = await fetch(url, Object.assign({}, options, { headers: headers }));
            if (resp.status === 401) { logout(); return null; }
            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(errText || 'Request failed');
            }
            return resp;
        } catch (e) {
            if (e.message !== 'Failed to fetch') showToast(e.message, 'error');
            throw e;
        }
    }

    async function apiJSON(url, options) {
        const resp = await api(url, options);
        if (!resp) return null;
        return resp.json();
    }

    // ── Auth helpers ──────────────────────────────────────────
    function logout() {
        sessionStorage.removeItem('aim_token');
        S.user = null;
        S.token = null;
        S.masterData = null;
        S.fileUploaded = false;
        S.currentPage = 'welcome';
        render();
    }

    async function checkAuth() {
        const token = sessionStorage.getItem('aim_token');
        if (!token) return false;
        try {
            const data = await apiJSON('/api/auth/me');
            if (data && data.username) {
                S.user = data;
                S.token = token;
                return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    // ── HTML helpers ──────────────────────────────────────────
    function el(tag, attrs, children) {
        const e = document.createElement(tag);
        if (attrs) {
            for (const k in attrs) {
                if (k === 'className') e.className = attrs[k];
                else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
                else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
                else e.setAttribute(k, attrs[k]);
            }
        }
        if (children !== undefined && children !== null) {
            if (typeof children === 'string' || typeof children === 'number') e.textContent = String(children);
            else if (Array.isArray(children)) children.forEach(function (c) { if (c) e.appendChild(c); });
            else e.appendChild(children);
        }
        return e;
    }

    function html(parent, str) { parent.innerHTML = str; return parent; }

    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

    function spinner() {
        return '<div class="loading-container"><div class="spinner"></div><span>Loading...</span></div>';
    }

    // ── Sortable Table Builder ────────────────────────────────
    function buildTable(columns, rows, opts) {
        opts = opts || {};
        let sortCol = null;
        let sortDir = 'asc';
        const container = el('div', { className: 'table-container' });

        function renderTable() {
            let sorted = rows.slice();
            if (sortCol !== null) {
                sorted.sort(function (a, b) {
                    let va = a[sortCol], vb = b[sortCol];
                    if (va == null) va = '';
                    if (vb == null) vb = '';
                    if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
                    va = String(va).toLowerCase();
                    vb = String(vb).toLowerCase();
                    if (va < vb) return sortDir === 'asc' ? -1 : 1;
                    if (va > vb) return sortDir === 'asc' ? 1 : -1;
                    return 0;
                });
            }

            let h = '<table class="data-table"><thead><tr>';
            if (opts.checkbox) h += '<th style="width:40px"><input type="checkbox" class="select-all"></th>';
            columns.forEach(function (c, idx) {
                const key = c.key || c;
                const label = c.label || c;
                let icon = 'none';
                if (sortCol === idx) icon = sortDir;
                if (opts.noSort) {
                    h += '<th>' + esc(label) + '</th>';
                } else {
                    h += '<th data-col="' + idx + '">' + esc(label) + '<span class="sort-icon ' + icon + '"></span></th>';
                }
            });
            h += '</tr></thead><tbody>';

            if (sorted.length === 0) {
                h += '<tr><td colspan="' + (columns.length + (opts.checkbox ? 1 : 0)) + '" class="text-center text-muted" style="padding:2rem">No data</td></tr>';
            }

            sorted.forEach(function (row, ri) {
                let rowClass = '';
                if (opts.rowClass) rowClass = opts.rowClass(row);
                h += '<tr class="' + rowClass + '" data-idx="' + ri + '">';
                if (opts.checkbox) {
                    const checked = row._selected ? 'checked' : '';
                    h += '<td><input type="checkbox" class="row-check" data-orig="' + (row._orig_idx !== undefined ? row._orig_idx : ri) + '" ' + checked + '></td>';
                }
                columns.forEach(function (c) {
                    const key = c.key || c;
                    let val = row[key];
                    if (val === undefined || val === null) val = '';
                    if (c.render) val = c.render(val, row);
                    else val = esc(String(val));
                    const style = c.style ? ' style="' + c.style + '"' : '';
                    h += '<td' + style + '>' + val + '</td>';
                });
                h += '</tr>';
            });

            h += '</tbody></table>';
            container.innerHTML = h;

            // Sort handlers
            $$('th[data-col]', container).forEach(function (th) {
                th.addEventListener('click', function () {
                    const ci = parseInt(th.dataset.col);
                    if (sortCol === ci) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                    else { sortCol = ci; sortDir = 'asc'; }
                    renderTable();
                });
            });

            // Checkbox handlers
            if (opts.checkbox && opts.onSelectionChange) {
                const selectAll = $('.select-all', container);
                if (selectAll) {
                    selectAll.addEventListener('change', function () {
                        $$('.row-check', container).forEach(function (cb) { cb.checked = selectAll.checked; });
                        opts.onSelectionChange(getSelected());
                    });
                }
                $$('.row-check', container).forEach(function (cb) {
                    cb.addEventListener('change', function () {
                        opts.onSelectionChange(getSelected());
                    });
                });
            }
        }

        function getSelected() {
            return $$('.row-check:checked', container).map(function (cb) { return parseInt(cb.dataset.orig); });
        }

        renderTable();
        container.getSelected = getSelected;
        container.refresh = renderTable;
        return container;
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function fmtNum(n) {
        if (n == null) return '0';
        return Number(n).toLocaleString();
    }

    function fmtPct(n) {
        if (n == null) return '0%';
        return Number(n).toFixed(2) + '%';
    }

    // ── KPI Row Builder ───────────────────────────────────────
    function kpiRow(items) {
        // items = [{label, value, delta?}]
        let h = '<div class="kpi-row">';
        items.forEach(function (item) {
            let deltaHtml = '';
            if (item.delta !== undefined && item.delta !== null) {
                let cls = 'neutral';
                if (typeof item.delta === 'string') {
                    if (item.delta.startsWith('+')) cls = 'positive';
                    else if (item.delta.startsWith('-')) cls = 'negative';
                }
                deltaHtml = '<div class="kpi-delta ' + cls + '">' + esc(String(item.delta)) + '</div>';
            }
            h += '<div class="kpi-card"><div class="kpi-label">' + esc(item.label) + '</div><div class="kpi-value">' + esc(String(item.value)) + '</div>' + deltaHtml + '</div>';
        });
        h += '</div>';
        return h;
    }

    // ── Accordion Builder ─────────────────────────────────────
    function accordion(title, contentFn, expanded) {
        const wrap = el('div', { className: 'accordion' });
        const header = el('div', { className: 'accordion-header' });
        header.innerHTML = '<span>' + esc(title) + '</span><span class="toggle-icon ' + (expanded ? 'open' : '') + '">&#9660;</span>';
        const body = el('div', { className: 'accordion-body' + (expanded ? ' open' : '') });
        header.addEventListener('click', function () {
            const isOpen = body.classList.contains('open');
            body.classList.toggle('open');
            $('.toggle-icon', header).classList.toggle('open');
            if (!isOpen && body.children.length === 0) contentFn(body);
        });
        if (expanded) contentFn(body);
        wrap.appendChild(header);
        wrap.appendChild(body);
        return wrap;
    }

    // ── Tab Builder ───────────────────────────────────────────
    function buildTabs(tabs, container) {
        // tabs = [{label, id, render(contentDiv)}]
        let barH = '<div class="tab-bar">';
        tabs.forEach(function (t, i) {
            barH += '<div class="tab-item' + (i === 0 ? ' active' : '') + '" data-tab="' + t.id + '">' + esc(t.label) + '</div>';
        });
        barH += '</div>';

        let contentH = '';
        tabs.forEach(function (t, i) {
            contentH += '<div class="tab-content' + (i === 0 ? ' active' : '') + '" id="tab-' + t.id + '"></div>';
        });

        container.innerHTML = barH + contentH;

        // Render first tab
        tabs[0].render($('#tab-' + tabs[0].id, container));

        $$('.tab-item', container).forEach(function (ti) {
            ti.addEventListener('click', function () {
                $$('.tab-item', container).forEach(function (x) { x.classList.remove('active'); });
                $$('.tab-content', container).forEach(function (x) { x.classList.remove('active'); });
                ti.classList.add('active');
                const tabDiv = $('#tab-' + ti.dataset.tab, container);
                tabDiv.classList.add('active');
                const tab = tabs.find(function (t) { return t.id === ti.dataset.tab; });
                if (tab && tabDiv.children.length === 0) tab.render(tabDiv);
            });
        });
    }

    // ── Multiselect Builder ───────────────────────────────────
    function buildMultiselect(id, options, selected, onChange) {
        selected = selected || options.slice();
        const wrap = el('div', { className: 'multiselect-container', id: id });
        const trigger = el('div', { className: 'multiselect-trigger', tabindex: '0' });
        const dropdown = el('div', { className: 'multiselect-dropdown' });

        function renderTrigger() {
            trigger.innerHTML = '';
            if (selected.length === 0) {
                trigger.innerHTML = '<span class="text-muted text-small">Select...</span>';
            } else if (selected.length === options.length) {
                trigger.innerHTML = '<span class="text-small">All selected</span>';
            } else {
                selected.forEach(function (s) {
                    const tag = el('span', { className: 'multiselect-tag' });
                    tag.innerHTML = esc(s.length > 20 ? s.slice(0, 20) + '..' : s) + '<span class="remove-tag" data-val="' + esc(s) + '">&times;</span>';
                    trigger.appendChild(tag);
                });
            }
        }

        function renderDropdown() {
            dropdown.innerHTML = '';
            options.forEach(function (o) {
                const checked = selected.indexOf(o) >= 0;
                const opt = el('label', { className: 'multiselect-option' });
                opt.innerHTML = '<input type="checkbox" ' + (checked ? 'checked' : '') + ' value="' + esc(o) + '"> ' + esc(o);
                dropdown.appendChild(opt);
            });
        }

        renderTrigger();
        renderDropdown();

        trigger.addEventListener('click', function (e) {
            if (e.target.classList.contains('remove-tag')) {
                const val = e.target.dataset.val;
                selected = selected.filter(function (s) { return s !== val; });
                renderTrigger();
                renderDropdown();
                if (onChange) onChange(selected);
                return;
            }
            dropdown.classList.toggle('open');
        });

        dropdown.addEventListener('change', function (e) {
            const val = e.target.value;
            if (e.target.checked) {
                if (selected.indexOf(val) < 0) selected.push(val);
            } else {
                selected = selected.filter(function (s) { return s !== val; });
            }
            renderTrigger();
            if (onChange) onChange(selected);
        });

        document.addEventListener('click', function (e) {
            if (!wrap.contains(e.target)) dropdown.classList.remove('open');
        });

        wrap.appendChild(trigger);
        wrap.appendChild(dropdown);
        wrap.getSelected = function () { return selected.slice(); };
        wrap.setOptions = function (newOpts, newSel) {
            options = newOpts;
            selected = newSel || newOpts.slice();
            renderTrigger();
            renderDropdown();
        };
        return wrap;
    }

    // ── File download helper ──────────────────────────────────
    async function downloadFile(url, filename) {
        const resp = await api(url);
        if (!resp) return;
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
    }

    // ── Plotly axis defaults ──────────────────────────────────
    function applyAxisDefaults(figEl) {
        Plotly.relayout(figEl, {
            'xaxis.tickfont.color': '#1a1a2e',
            'xaxis.titlefont.color': '#1a1a2e',
            'xaxis.gridcolor': 'rgba(0,0,0,0.08)',
            'yaxis.tickfont.color': '#1a1a2e',
            'yaxis.titlefont.color': '#1a1a2e',
            'yaxis.gridcolor': 'rgba(0,0,0,0.08)',
        });
    }

    // ══════════════════════════════════════════════════════════
    //  RENDER ENGINE
    // ══════════════════════════════════════════════════════════

    function render() {
        const app = document.getElementById('app');
        if (!S.user) {
            // Slightly increase overall font size for the login screen for readability
            try { document.documentElement.classList.add('login-scale-115'); } catch (e) {}
            // Ensure animations are visible on the login hero regardless of OS reduced-motion
            try { document.documentElement.classList.add('login-force-anim'); } catch (e) {}
            renderLogin(app);
        } else {
            try { document.documentElement.classList.remove('login-scale-115'); } catch (e) {}
            try { document.documentElement.classList.remove('login-force-anim'); } catch (e) {}
            try { if (S.loginAnimStop) { S.loginAnimStop(); S.loginAnimStop = null; } } catch (e) {}
            renderApp(app);
        }
    }

    // ── Login Page ────────────────────────────────────────────
    function renderLogin(root) {
        root.innerHTML = '';
        const wrapper = el('div', { className: 'login-wrapper' });

        // ── LEFT PANEL (Branding) ──
        const leftPanel = el('div', { className: 'login-left' });
        leftPanel.innerHTML = `
            <div class="login-particles">
                <span class="particle" style="--x:15%;--y:20%;--dur:18s;--delay:0s;--size:3px"></span>
                <span class="particle" style="--x:75%;--y:15%;--dur:22s;--delay:2s;--size:2px"></span>
                <span class="particle" style="--x:45%;--y:70%;--dur:20s;--delay:4s;--size:4px"></span>
                <span class="particle" style="--x:85%;--y:55%;--dur:16s;--delay:1s;--size:2px"></span>
                <span class="particle" style="--x:25%;--y:85%;--dur:24s;--delay:3s;--size:3px"></span>
                <span class="particle" style="--x:60%;--y:40%;--dur:19s;--delay:5s;--size:2px"></span>
                <span class="particle" style="--x:10%;--y:50%;--dur:21s;--delay:7s;--size:3px"></span>
                <span class="particle" style="--x:90%;--y:80%;--dur:17s;--delay:2s;--size:4px"></span>
                <span class="particle" style="--x:35%;--y:10%;--dur:23s;--delay:6s;--size:2px"></span>
                <span class="particle" style="--x:55%;--y:90%;--dur:15s;--delay:4s;--size:3px"></span>
                <span class="particle" style="--x:70%;--y:30%;--dur:20s;--delay:8s;--size:2px"></span>
                <span class="particle" style="--x:20%;--y:60%;--dur:18s;--delay:1s;--size:3px"></span>
            </div>
            <img src="Protiviti-logo-1.png" alt="Protiviti" class="login-protiviti-logo">
                <div class="login-brand">
                    <div class="login-brand-logo">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E57200" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        <div>
                            <div class="brand-title">AIM</div>
                            <div class="brand-sub">ANALYTICS IN MOTION</div>
                        </div>
                    </div>
                    <div class="login-mini-trend" aria-hidden="true">
                        <span class="login-graph-hero">
                            <span class="bar"></span>
                            <span class="bar"></span>
                            <span class="bar"></span>
                            <span class="bar"></span>
                            <span class="bar"></span>
                        </span>
                        <svg class="login-sparkline" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true">
                            <path class="spark-bg" d="M0 15 L8 12 L16 14 L24 8 L32 10 L40 6 L48 9 L56 5 L64 7" />
                            <path class="spark-path" d="M0 15 L8 12 L16 14 L24 8 L32 10 L40 6 L48 9 L56 5 L64 7" />
                        </svg>
                        <div class="login-pie2" aria-hidden="true"></div>
                    </div>
                    <h2 class="login-headline">Continuous Controls Monitoring</h2>
                    <p class="login-desc">Enterprise-grade compliance monitoring across risk scenarios. Real-time breach detection, causality analysis, and workflow management for Risk, Compliance &amp; Internal Audit.</p>
                    <ul class="login-features">
                        <li>Automated breach detection across configurable rule&nbsp;thresholds</li>
                        <li>Interactive dashboards with executive-level KPIs and&nbsp;heatmaps</li>
                    <li>Scenario drill-down with granular record-level analysis</li>
                    <li>Causality and trend analysis for root-cause identification</li>
                    <li>Assignment workflow with role-based case management</li>
                </ul>
            </div>
        `;
        wrapper.appendChild(leftPanel);

        // ── RIGHT PANEL (Form) ──
        const rightPanel = el('div', { className: 'login-right' });
        const card = el('div', { className: 'login-card' });

        card.innerHTML = '<h2 class="login-form-title">Welcome back</h2><p class="login-form-sub">Sign in to your monitoring console</p>';

        const tabBar = el('div', { className: 'tab-bar', style: { marginBottom: '1.5rem' } });
        tabBar.innerHTML = '<div class="tab-item active" data-tab="login">Login</div><div class="tab-item" data-tab="signup">Reviewer Sign Up</div>';
        card.appendChild(tabBar);

        const loginForm = el('div', { className: 'tab-content active', id: 'tab-login' });
        loginForm.innerHTML =
            '<div class="form-group"><label>Username</label><input type="text" id="login-user" placeholder="Enter your username"></div>' +
            '<div class="form-group"><label>Password</label><input type="password" id="login-pass" placeholder="Enter your password"></div>' +
            '<div id="login-error" class="alert alert-error" style="display:none"></div>' +
            '<button class="btn btn-primary login-submit-btn" id="login-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> Sign In</button>';
        card.appendChild(loginForm);

        const signupForm = el('div', { className: 'tab-content', id: 'tab-signup' });
        signupForm.innerHTML =
            '<div class="form-group"><label>Full Name</label><input type="text" id="signup-name" placeholder="Full Name"></div>' +
            '<div class="form-group"><label>Username</label><input type="text" id="signup-user" placeholder="Username"></div>' +
            '<div class="form-group"><label>Password</label><input type="password" id="signup-pass" placeholder="Password"></div>' +
            '<div class="form-group"><label>Confirm Password</label><input type="password" id="signup-pass2" placeholder="Confirm Password"></div>' +
            '<div id="signup-msg" style="display:none;margin-bottom:0.5rem"></div>' +
            '<button class="btn btn-primary login-submit-btn" id="signup-btn">Sign Up</button>';
        card.appendChild(signupForm);

        // Tab switching
        $$('.tab-item', tabBar).forEach(function (ti) {
            ti.addEventListener('click', function () {
                $$('.tab-item', tabBar).forEach(function (x) { x.classList.remove('active'); });
                $$('.tab-content', card).forEach(function (x) { x.classList.remove('active'); });
                ti.classList.add('active');
                $('#tab-' + ti.dataset.tab, card).classList.add('active');
            });
        });

        rightPanel.appendChild(card);
        wrapper.appendChild(rightPanel);
        root.appendChild(wrapper);

        // Start left-hero sequential bar animation
        try { if (S.loginAnimStop) { S.loginAnimStop(); } } catch (e) {}
        S.loginAnimStop = startLoginHeroAnim(wrapper);

        // Login handler
        $('#login-btn', card).addEventListener('click', async function () {
            const user = $('#login-user', card).value.trim();
            const pass = $('#login-pass', card).value;
            if (!user || !pass) { showLoginErr('Please enter username and password'); return; }
            try {
                const resp = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: user, password: pass }),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(function () { return { detail: 'Login failed' }; });
                    showLoginErr(err.detail || 'Login failed');
                    return;
                }
                const data = await resp.json();
                sessionStorage.setItem('aim_token', data.token);
                S.token = data.token;
                S.user = data.user || { username: user };
                // Fetch full user info
                const me = await apiJSON('/api/auth/me');
                if (me) S.user = me;
                render();
            } catch (e) {
                showLoginErr('Connection error');
            }
        });

        // Enter key
        $$('#login-user, #login-pass', card).forEach(function (inp) {
            inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#login-btn', card).click(); });
        });

        function showLoginErr(msg) {
            const errDiv = $('#login-error', card);
            errDiv.textContent = msg;
            errDiv.style.display = 'block';
        }

        // Signup handler
        $('#signup-btn', card).addEventListener('click', async function () {
            const name = $('#signup-name', card).value.trim();
            const user = $('#signup-user', card).value.trim();
            const pass = $('#signup-pass', card).value;
            const pass2 = $('#signup-pass2', card).value;
            const msgDiv = $('#signup-msg', card);

            if (!name || !user || !pass) { showSignupMsg('All fields are required', 'error'); return; }
            if (pass !== pass2) { showSignupMsg('Passwords do not match', 'error'); return; }
            if (pass.length < 4) { showSignupMsg('Password must be at least 4 characters', 'error'); return; }

            try {
                const resp = await fetch('/api/auth/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ display_name: name, username: user, password: pass }),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(function () { return { detail: 'Signup failed' }; });
                    showSignupMsg(err.detail || 'Signup failed', 'error');
                    return;
                }
                showSignupMsg('Account created! You can now login.', 'success');
                $('#signup-name', card).value = '';
                $('#signup-user', card).value = '';
                $('#signup-pass', card).value = '';
                $('#signup-pass2', card).value = '';
            } catch (e) {
                showSignupMsg('Connection error', 'error');
            }
        });

        function showSignupMsg(msg, type) {
            const msgDiv = $('#signup-msg', card);
            msgDiv.className = 'alert alert-' + type;
            msgDiv.textContent = msg;
            msgDiv.style.display = 'block';
        }
    }

    // Small, looped animation: bars appear one-by-one, line up, then reset
    function startLoginHeroAnim(container) {
        const bars = container.querySelectorAll('.login-graph-hero .bar');
        if (!bars.length) return null;
        const targets = [0.45, 0.65, 0.9, 0.55, 0.8];
        const lineup = 0.85;
        bars.forEach(function (b) { b.style.transform = 'scaleY(0)'; });
        let cancelled = false;
        const tids = [];

        function loop() {
            if (cancelled) return;
            let i = 0;
            function growNext() {
                if (cancelled) return;
                if (i < bars.length) {
                    const h = targets[i] || 0.8;
                    bars[i].style.transform = 'scaleY(' + h + ')';
                    i += 1;
                    tids.push(setTimeout(growNext, 180));
                } else {
                    tids.push(setTimeout(function () {
                        bars.forEach(function (b) { b.style.transform = 'scaleY(' + lineup + ')'; });
                        tids.push(setTimeout(function () {
                            bars.forEach(function (b) { b.style.transform = 'scaleY(0)'; });
                            tids.push(setTimeout(loop, 600));
                        }, 650));
                    }, 500));
                }
            }
            growNext();
        }
        loop();
        // Sparkline animation (stroke-dashoffset draw/reset)
        (function () {
            const path = container.querySelector('.login-sparkline .spark-path');
            if (!path) return;
            const len = typeof path.getTotalLength === 'function' ? path.getTotalLength() : 200;
            path.style.strokeDasharray = String(len);
            function sparkLoop() {
                if (cancelled) return;
                // Reset instantly to hidden
                path.style.transition = 'none';
                path.style.strokeDashoffset = String(len);
                // Force reflow
                try { path.getBoundingClientRect(); } catch (e) {}
                // Animate to full draw
                path.style.transition = 'stroke-dashoffset 1200ms ease-in-out';
                path.style.strokeDashoffset = '0';
                tids.push(setTimeout(function () {
                    if (cancelled) return; sparkLoop();
                }, 1500));
            }
            sparkLoop();
        })();

        // Pie animation (solid pie filling with partitions using conic-gradient)
        (function () {
            const pie = container.querySelector('.login-pie2');
            if (!pie) return;
            const colors = ['#FFD2A6', '#9DD3FF', '#FFB4C2', '#A7F3D0'];
            const parts = [0.25, 0.30, 0.20, 0.25]; // fractions total 1.0
            function buildGradient(progressIndex, progressFrac) {
                let ang = 0;
                const segs = [];
                for (let i = 0; i < parts.length; i++) {
                    const size = parts[i] * 360;
                    if (i < progressIndex) {
                        segs.push(`${colors[i]} ${ang}deg ${ang + size}deg`);
                        ang += size;
                    } else if (i === progressIndex) {
                        const cur = size * progressFrac;
                        segs.push(`${colors[i]} ${ang}deg ${ang + cur}deg`);
                        ang += cur;
                        segs.push(`rgba(255,255,255,0.18) ${ang}deg 360deg`);
                        break;
                    } else {
                        // not started yet
                        segs.push(`rgba(255,255,255,0.18) ${ang}deg 360deg`);
                        break;
                    }
                }
                return 'conic-gradient(' + segs.join(',') + ')';
            }
            function pieLoop() {
                if (cancelled) return;
                let idx = 0;
                function animateSlice() {
                    if (cancelled) return;
                    if (idx >= parts.length) {
                        tids.push(setTimeout(function () {
                            // reset
                            pie.style.background = 'conic-gradient(rgba(255,255,255,0.18) 0 360deg)';
                            tids.push(setTimeout(pieLoop, 600));
                        }, 600));
                        return;
                    }
                    const steps = 14;
                    let s = 0;
                    function step() {
                        if (cancelled) return;
                        const frac = Math.min(1, s / steps);
                        pie.style.background = buildGradient(idx, frac);
                        s += 1;
                        if (s <= steps) {
                            tids.push(setTimeout(step, 40));
                        } else {
                            // lock slice as filled and move to next
                            idx += 1;
                            tids.push(setTimeout(animateSlice, 120));
                        }
                    }
                    step();
                }
                animateSlice();
            }
            pieLoop();
        })();

        return function stop() { cancelled = true; tids.forEach(function (id) { try { clearTimeout(id); } catch (e) {} }); };
    }

    // ── Main App Layout ───────────────────────────────────────
    function renderApp(root) {
        root.innerHTML = '';
        const layout = el('div', { className: 'app-layout' });

        // Sidebar
        const sidebar = el('aside', { className: 'sidebar' });
        sidebar.innerHTML = buildSidebar();
        layout.appendChild(sidebar);

        // Content Wrapper
        const contentWrap = el('div', { className: 'main-content-wrap' });

        // Topbar
        const topBar = el('div', { className: 'top-bar' });
        const leftHtml = '<div class="topbar-left"><img src="Protiviti-logo-1.png" alt="Protiviti" class="topbar-logo"></div>';
        const rightHtml = `
            <div class="topbar-right">
                <div class="user-dropdown" id="user-dropdown">
                    <div class="user-dropdown-toggle">
                        <span class="user-name">${esc(S.user.role || 'admin').toUpperCase()}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                    <div class="user-dropdown-menu" id="user-dropdown-menu">
                        <button class="btn-logout" id="btn-logout">Logout</button>
                    </div>
                </div>
            </div>`;
        topBar.innerHTML = leftHtml + rightHtml;
        contentWrap.appendChild(topBar);

        // Content
        const content = el('main', { className: 'main-content', id: 'content' });
        contentWrap.appendChild(content);

        layout.appendChild(contentWrap);
        root.appendChild(layout);

        // Wire up sidebar events
        wireSidebar(sidebar);

        // Logout Toggle
        const logoutBtn = layout.querySelector('#btn-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        // User Dropdown
        const dropdownToggle = layout.querySelector('.user-dropdown-toggle');
        const dropdownMenu = layout.querySelector('#user-dropdown-menu');
        if (dropdownToggle && dropdownMenu) {
            dropdownToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                dropdownMenu.classList.toggle('show');
            });
            document.addEventListener('click', function(e) {
                if (!dropdownToggle.contains(e.target) && !dropdownMenu.contains(e.target)) {
                    dropdownMenu.classList.remove('show');
                }
            });
        }


        // Initial page load
        if (S.user.role === 'reviewer') {
            S.currentPage = 'reviewer_dashboard';
        }

        loadRules().then(function () {
            navigateTo(S.currentPage);
        });
    }

    function buildSidebar() {
        const isReviewer = S.user.role === 'reviewer';
        let h = '';

        // Sidebar header with logo + branding
        h += '<div class="sidebar-header">';
        h += '<div class="logo-title">AIM</div>';
        h += '<div class="logo-subtitle">Analytics in Motion</div>';
        h += '</div>';

        if (isReviewer) {
            h += '<nav class="sidebar-nav">';
            h += '<a class="nav-link active" data-page="reviewer_dashboard">My Assignments</a>';
            h += '</nav>';
        } else {
            // File upload
            h += '<div class="sidebar-upload" style="margin-top: 1rem;">';
            h += '<label>Upload AIM Excel File</label>';
            h += '<input type="file" id="file-input" accept=".xlsx,.xls">';
            h += '<button class="btn-upload" id="btn-upload" disabled>Upload</button>';
            h += '</div>';
            h += '<div class="sidebar-file-info" id="file-info" style="display:none"></div>';
            h += '<hr class="sidebar-divider">';

            // Navigation
            h += '<nav class="sidebar-nav" id="sidebar-nav">';
            h += '<a class="nav-link active" data-page="welcome">Welcome</a>';
            // Data pages (hidden until file uploaded)
            h += '<a class="nav-link data-page" data-page="executive_summary" style="display:none">Executive Summary</a>';
            h += '<a class="nav-link data-page" data-page="category_deep_dive" style="display:none">Category Deep Dive</a>';
            h += '<a class="nav-link data-page" data-page="scenario_drilldown" style="display:none">Scenario Drill-Down</a>';
            h += '<a class="nav-link data-page" data-page="rules_library" style="display:none">Rules Library</a>';
            h += '<a class="nav-link data-page" data-page="exception_report" style="display:none">Exception Report</a>';
            h += '<a class="nav-link data-page" data-page="trend_analysis" style="display:none">Trend Analysis</a>';
            h += '<a class="nav-link data-page" data-page="causality_analysis" style="display:none">Causality Analysis</a>';
            h += '<a class="nav-link data-page" data-page="comparison_mode" style="display:none">Comparison Mode</a>';
            h += '<a class="nav-link" data-page="assignment_manager">Assignment Manager</a>';
            h += '<a class="nav-link" data-page="sql_gpt">SQL GPT</a>';
            h += '</nav>';

            // PDF buttons
            h += '<div class="sidebar-section" id="pdf-section" style="display:none">';
            h += '<button class="btn-pdf" id="btn-gen-pdf">Generate PDF Report</button>';
            h += '</div>';
        }



        return h;
    }

    function wireSidebar(sidebar) {
        // File input
        const fileInput = $('#file-input', sidebar);
        const uploadBtn = $('#btn-upload', sidebar);
        if (fileInput && uploadBtn) {
            fileInput.addEventListener('change', function () {
                uploadBtn.disabled = !fileInput.files.length;
            });
            uploadBtn.addEventListener('click', async function () {
                if (!fileInput.files.length) return;
                uploadBtn.disabled = true;
                uploadBtn.textContent = 'Uploading...';
                const fd = new FormData();
                fd.append('file', fileInput.files[0]);
                try {
                    const data = await apiJSON('/api/data/upload', { method: 'POST', body: fd });
                    if (data) {
                        S.fileUploaded = true;
                        S.masterData = data;
                        invalidatePageCache();
                        showToast('File uploaded successfully!', 'success');
                        showDataPages();
                        // Show file info
                        const info = $('#file-info', sidebar);
                        if (info) {
                            info.style.display = 'block';
                            info.textContent = 'File: ' + fileInput.files[0].name + ' | Scenarios: ' + (data.total_scenarios || '?') + ' | Records: ' + fmtNum(data.total_records || 0);
                        }
                        // Hide the upload section and file info
                        const uploadSection = sidebar.querySelector('.sidebar-upload');
                        if (uploadSection) uploadSection.style.display = 'none';
                        const fileInfo = $('#file-info', sidebar);
                        if (fileInfo) fileInfo.style.display = 'none';

                        // Show PDF section
                        const pdfSec = $('#pdf-section', sidebar);
                        if (pdfSec) pdfSec.style.display = 'block';

                        // Hide welcome tab
                        const topLevelLayout = document.querySelector('.app-layout');
                        const welcomeTab = topLevelLayout ? topLevelLayout.querySelector('.nav-link[data-page="welcome"]') : null;
                        if (welcomeTab) welcomeTab.style.display = 'none';
                        
                        navigateTo('executive_summary');
                    }
                } catch (e) {
                    showToast('Upload failed: ' + e.message, 'error');
                }
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Upload';
            });
        }

        // Navigation
        $$('.nav-link', sidebar).forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                navigateTo(link.dataset.page);
            });
        });

        // PDF buttons
        const genPdf = $('#btn-gen-pdf', sidebar);
        if (genPdf) {
            genPdf.addEventListener('click', async function () {
                genPdf.textContent = 'Generating...';
                genPdf.disabled = true;
                try {
                    await downloadFile('/api/reports/pdf', 'AIM_Report.pdf');
                    showToast('PDF report downloaded!', 'success');
                } catch (e) {
                    showToast('PDF generation failed', 'error');
                }
                genPdf.textContent = 'Generate PDF Report';
                genPdf.disabled = false;
            });
        }
    }

    function showDataPages() {
        $$('.data-page').forEach(function (el) { el.style.display = 'block'; });
    }

    // Page DOM cache — keeps rendered pages alive so charts don't re-render
    var _pageCache = {};
    // Pages with heavy charts that benefit from caching
    var _cacheable = { executive_summary: 1, category_deep_dive: 1, trend_analysis: 1, causality_analysis: 1, comparison_mode: 1 };

    function navigateTo(page) {
        S.currentPage = page;
        // Update active nav
        $$('.nav-link').forEach(function (l) {
            l.classList.toggle('active', l.dataset.page === page);
        });

        var content = document.getElementById('content');
        if (!content) return;

        // Hide cached children; remove non-cached ones to free memory
        Array.from(content.children).forEach(function (child) {
            var isCached = false;
            for (var k in _pageCache) {
                if (_pageCache[k] === child) { isCached = true; break; }
            }
            if (isCached) {
                child.style.display = 'none';
            } else {
                content.removeChild(child);
            }
        });

        var canCache = !!_cacheable[page];

        // If this page was already rendered and is cacheable, show the cached DOM
        if (canCache && _pageCache[page] && _pageCache[page].parentNode === content) {
            _pageCache[page].style.display = '';
            // Force Plotly to recalculate after the element is visible and laid out
            requestAnimationFrame(function () {
                var plots = _pageCache[page].querySelectorAll('.js-plotly-plot');
                plots.forEach(function (p) {
                    if (p.offsetWidth > 0 && p.offsetHeight > 0) {
                        try { Plotly.Plots.resize(p); } catch (e) { /* ignore */ }
                    }
                });
            });
            return;
        }

        // Remove old non-cached wrapper for this page if it exists
        if (_pageCache[page] && _pageCache[page].parentNode === content) {
            content.removeChild(_pageCache[page]);
            delete _pageCache[page];
        }

        // Render page into a wrapper div
        var wrapper = el('div', { className: 'page-cache-wrapper' });
        content.appendChild(wrapper);

        var pageFn = PAGES[page];
        if (pageFn) {
            try { pageFn(wrapper); } catch (e) { wrapper.innerHTML = '<div class="alert alert-error">Error rendering page: ' + esc(e.message) + '</div>'; console.error(e); }
        } else {
            wrapper.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-title">Page not found</div></div>';
        }

        if (canCache) {
            _pageCache[page] = wrapper;
        }
    }

    // Invalidate the page cache (e.g. after new data upload or param change)
    function invalidatePageCache(pages) {
        if (!pages) {
            // Invalidate all
            for (var key in _pageCache) {
                if (_pageCache[key] && _pageCache[key].parentNode) {
                    _pageCache[key].parentNode.removeChild(_pageCache[key]);
                }
            }
            _pageCache = {};
        } else {
            pages.forEach(function (p) {
                if (_pageCache[p] && _pageCache[p].parentNode) {
                    _pageCache[p].parentNode.removeChild(_pageCache[p]);
                }
                delete _pageCache[p];
            });
        }
    }

    // ── Rules Cache ───────────────────────────────────────────
    async function loadRules() {
        if (S.rules) return S.rules;
        try {
            const data = await apiJSON('/api/rules');
            if (data) S.rules = data;
        } catch (e) { /* ignore */ }
        return S.rules;
    }

    // ══════════════════════════════════════════════════════════
    //  PAGE IMPLEMENTATIONS
    // ══════════════════════════════════════════════════════════

    const PAGES = {};

    // ── Welcome Page ──────────────────────────────────────────
    PAGES.welcome = async function (c) {
        const rules = S.rules || {};
        const rulesArr = rules.rules || [];
        const categories = rules.categories || {};
        const stats = rules.stats || {};
        const totalScenarios = stats.total || rulesArr.length;
        const activeCount = stats.active || rulesArr.filter(function (r) { return r.status === 'Active'; }).length;
        const hardcodedCount = stats.hardcoded || rulesArr.filter(function (r) { return r.status === 'Hardcoded No'; }).length;
        const totalCategories = stats.total_categories || Object.keys(categories).length;

        // (rulesArr and categories are used directly below)

        let h = '<div class="page-header"><h1>Welcome to the AIM Dashboard</h1></div>';
        h += '<hr>';

        h += '<h3>Built-in Rule Engine</h3>';
        h += kpiRow([
            { label: 'Total Scenarios', value: totalScenarios },
            { label: 'Active Rules', value: activeCount },
            { label: 'Hardcoded (No Breach)', value: hardcodedCount },
            { label: 'Categories', value: totalCategories },
        ]);
        h += '<hr>';

        // Category filter
        h += '<div class="form-group" style="max-width:300px"><label>Filter by Category</label><select id="rule-cat-filter"><option value="All Categories">All Categories</option>';
        Object.keys(categories).sort().forEach(function (cat) {
            h += '<option value="' + esc(cat) + '">' + esc(cat) + '</option>';
        });
        h += '</select></div>';
        h += '<div id="rules-table-area"></div>';
        h += '<hr>';
        h += '<h3>Scenarios per Category</h3>';
        h += '<div id="cat-chart" class="chart-container" style="min-height:430px"></div>';
        h += '<div id="cat-summary-table"></div>';

        c.innerHTML = h;

        function renderRulesTable(filterCat) {
            const rows = [];
            rulesArr.forEach(function (r) {
                if (filterCat !== 'All Categories' && r.category !== filterCat) return;
                const threshStr = r.thresholds || '\u2014';
                rows.push({
                    Category: r.category,
                    Scenario: r.scenario,
                    Status: r.status,
                    Description: r.description,
                    Thresholds: threshStr || '\u2014',
                });
            });

            const area = $('#rules-table-area', c);
            area.innerHTML = '<h4>Rules (' + rows.length + ' scenarios)</h4>';
            area.appendChild(buildTable(
                [{ key: 'Category', label: 'Category' }, { key: 'Scenario', label: 'Scenario' },
                 { key: 'Status', label: 'Status', render: function (v) { return '<span class="badge ' + (v === 'Active' ? 'badge-active' : 'badge-hardcoded') + '">' + v + '</span>'; } },
                 { key: 'Description', label: 'Description' }, { key: 'Thresholds', label: 'Thresholds' }],
                rows, { noSort: true }
            ));
        }

        function renderCatChart(filterCat) {
            const catData = [];
            Object.keys(categories).sort().forEach(function (cat) {
                if (filterCat !== 'All Categories' && cat !== filterCat) return;
                const info = categories[cat] || {};
                catData.push({ Category: cat, 'Total Scenarios': info.total || 0, Active: info.active || 0, 'Hardcoded No': info.hardcoded || 0, 'Configurable Thresholds': info.thresholds || 0 });
            });

            const chartDiv = $('#cat-chart', c);
            if (catData.length > 0 && typeof Plotly !== 'undefined') {
                Plotly.newPlot(chartDiv, [{
                    type: 'bar', orientation: 'h',
                    y: catData.map(function (d) { return d.Category; }),
                    x: catData.map(function (d) { return d['Total Scenarios']; }),
                    text: catData.map(function (d) { return String(d['Total Scenarios']); }),
                    textposition: 'outside',
                    marker: { color: catData.map(function (d) { return d.Active > 5 ? PRIMARY : SECONDARY; }) },
                }], pLayout({ height: Math.max(400, catData.length * 45), showlegend: false, margin: { l: 200, r: 60, t: 30, b: 30 } }), PLOTLY_CFG);
            } else {
                chartDiv.innerHTML = '<p class="text-muted">No chart data available.</p>';
            }

            const summaryArea = $('#cat-summary-table', c);
            summaryArea.innerHTML = '';
            summaryArea.appendChild(buildTable(
                ['Category', 'Total Scenarios', 'Active', 'Hardcoded No', 'Configurable Thresholds'],
                catData, { noSort: true }
            ));
        }

        renderRulesTable('All Categories');
        renderCatChart('All Categories');

        $('#rule-cat-filter', c).addEventListener('change', function () {
            const v = this.value;
            renderRulesTable(v);
            renderCatChart(v);
        });
    };

    // ── Executive Summary ─────────────────────────────────────
    PAGES.executive_summary = async function (c) {
        c.innerHTML = spinner();
        let data;
        try { data = await apiJSON('/api/data/summary'); } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load summary</div>'; return; }
        if (!data) return;
        S.masterData = data;

        const master = data.master || [];
        const totalScenarios = master.length;
        const totalRecords = master.reduce(function (a, r) { return a + (r.Total_Records || 0); }, 0);
        const totalBreaches = master.reduce(function (a, r) { return a + (r.Breaches || 0); }, 0);
        const overallRate = totalRecords > 0 ? (totalBreaches / totalRecords * 100).toFixed(2) : '0.00';

        // Aggregate by category (compute first so we can size containers)
        const catMap = {};
        master.forEach(function (r) {
            if (!catMap[r.Category]) catMap[r.Category] = { records: 0, breaches: 0 };
            catMap[r.Category].records += r.Total_Records || 0;
            catMap[r.Category].breaches += r.Breaches || 0;
        });
        const catArr = Object.keys(catMap).map(function (cat) {
            const d = catMap[cat];
            return { Category: cat, Records: d.records, Breaches: d.breaches, Breach_Rate: d.records > 0 ? +(d.breaches / d.records * 100).toFixed(2) : 0 };
        }).sort(function (a, b) { return a.Breaches - b.Breaches; });

        var catChartH = Math.max(400, catArr.length * 40) + 30;
        var numCats = Object.keys(catMap).length;
        var heatH = Math.max(400, numCats * 45) + 30;
        var top10H = 450;
        var treemapH = 500;

        let h = '<div class="page-header"><h1>Executive Summary</h1><p class="page-desc">Comprehensive view of control breaches across all AIM scenarios.</p></div>';
        h += kpiRow([
            { label: 'Total Scenarios', value: totalScenarios },
            { label: 'Total Records', value: fmtNum(totalRecords) },
            { label: 'Total Breaches', value: fmtNum(totalBreaches) },
            { label: 'Overall Breach Rate', value: overallRate + '%' },
        ]);
        h += '<hr>';

        h += '<h3>Category Breach Summary</h3><div id="cat-breach-chart" class="chart-container" style="height:' + catChartH + 'px"></div>';
        h += '<h3>Breach Distribution by Category</h3><div id="cat-donut" class="chart-container" style="height:480px"></div>';
        h += '<h3>Risk Heatmap &mdash; Categories vs Severity Bands</h3><div id="risk-heatmap" class="chart-container" style="height:' + heatH + 'px"></div>';
        h += '<h3>Top 10 Breach Scenarios</h3><div id="top10-chart" class="chart-container" style="height:' + top10H + 'px"></div>';
        h += '<h3>Category Treemap</h3><div id="treemap" class="chart-container" style="height:' + treemapH + 'px"></div>';

        c.innerHTML = h;

        // Defer chart rendering to next frame so container layout is complete
        requestAnimationFrame(function () {

        // Chart 1: Category Breach Summary
        Plotly.newPlot($('#cat-breach-chart', c), [{
            type: 'bar', orientation: 'h',
            y: catArr.map(function (d) { return d.Category; }),
            x: catArr.map(function (d) { return d.Breaches; }),
            text: catArr.map(function (d) { return String(d.Breaches); }),
            textposition: 'outside',
            marker: { color: catArr.map(function (d) { return d.Breach_Rate; }), colorscale: [[0, GREEN], [0.5, AMBER], [1, RED]], showscale: true, colorbar: { title: 'Breach %' } },
        }], pLayout({ height: catChartH - 30, margin: { l: 220, r: 80 }, showlegend: false, yaxis: { automargin: true } }), PLOTLY_CFG);

        // Chart 2: Donut
        const catSorted = catArr.slice().sort(function (a, b) { return b.Breaches - a.Breaches; });
        Plotly.newPlot($('#cat-donut', c), [{
            type: 'pie', hole: 0.45,
            labels: catSorted.map(function (d) { return d.Category; }),
            values: catSorted.map(function (d) { return d.Breaches; }),
            textinfo: 'percent+label', textposition: 'inside',
            textfont: { size: 11, color: '#FFFFFF' },
            marker: { colors: [PRIMARY, SECONDARY, ACCENT, RED, GREEN, '#17A2B8', '#6C757D', AMBER, '#6610F2', '#E83E8C', '#20C997', '#FD7E14'] },
        }], pLayout({ height: 450, showlegend: false }), PLOTLY_CFG);

        // Chart 3: Risk Heatmap
        const bandOrder = ['Low (<5%)', 'Medium (5-20%)', 'High (20-40%)', 'Critical (>=40%)'];
        function band(rate) {
            if (rate >= 40) return 'Critical (>=40%)';
            if (rate >= 20) return 'High (20-40%)';
            if (rate >= 5) return 'Medium (5-20%)';
            return 'Low (<5%)';
        }
        const heatCats = {};
        master.forEach(function (r) {
            const cat = r.Category;
            const b = band(r.Breach_Rate || 0);
            if (!heatCats[cat]) heatCats[cat] = {};
            heatCats[cat][b] = (heatCats[cat][b] || 0) + 1;
        });
        const heatCatNames = Object.keys(heatCats).sort();
        const heatZ = heatCatNames.map(function (cat) {
            return bandOrder.map(function (b) { return heatCats[cat][b] || 0; });
        });
        Plotly.newPlot($('#risk-heatmap', c), [{
            type: 'heatmap',
            z: heatZ, x: bandOrder, y: heatCatNames,
            colorscale: [[0, '#FFFFFF'], [0.25, '#FFF3CD'], [0.5, AMBER], [0.75, '#E67E22'], [1, RED]],
            text: heatZ, texttemplate: '<b>%{text}</b>',
            hovertemplate: 'Category: %{y}<br>Severity: %{x}<br>Count: %{z}<extra></extra>',
        }], pLayout({ height: heatH - 30, margin: { l: 220 }, yaxis: { autorange: 'reversed', automargin: true } }), PLOTLY_CFG);

        // Chart 4: Top 10
        const top10 = master.slice().sort(function (a, b) { return b.Breach_Rate - a.Breach_Rate; }).slice(0, 10).reverse();
        Plotly.newPlot($('#top10-chart', c), [{
            type: 'bar', orientation: 'h',
            y: top10.map(function (d) { return d.Scenario; }),
            x: top10.map(function (d) { return d.Breach_Rate; }),
            text: top10.map(function (d) { return d.Breach_Rate + '%'; }),
            textposition: 'outside',
            marker: { color: top10.map(function (d) { return severityColor(d.Breach_Rate); }) },
        }], pLayout({ height: top10H - 30, margin: { l: 250, r: 60 }, xaxis: { title: 'Breach Rate (%)' }, yaxis: { automargin: true } }), PLOTLY_CFG);

        // Chart 5: Treemap
        const tmLabels = [], tmParents = [], tmValues = [], tmColors = [];
        const catNames = Object.keys(catMap);
        catNames.forEach(function (cat) { tmLabels.push(cat); tmParents.push(''); tmValues.push(0); tmColors.push(0); });
        master.forEach(function (r) {
            if (r.Total_Records > 0) {
                tmLabels.push(r.Scenario);
                tmParents.push(r.Category);
                tmValues.push(r.Total_Records);
                tmColors.push(r.Breach_Rate || 0);
            }
        });
        Plotly.newPlot($('#treemap', c), [{
            type: 'treemap',
            labels: tmLabels, parents: tmParents, values: tmValues,
            marker: { colors: tmColors, colorscale: [[0, GREEN], [0.5, AMBER], [1, RED]], showscale: true, colorbar: { title: 'Breach %' } },
            textfont: { color: '#FFFFFF' },
        }], pLayout({ height: treemapH - 30 }), PLOTLY_CFG);

        }); // end requestAnimationFrame
    };

    // ── Category Deep Dive ────────────────────────────────────
    PAGES.category_deep_dive = async function (c) {
        c.innerHTML = spinner();
        let data;
        try { data = await apiJSON('/api/data/summary'); } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load data</div>'; return; }
        if (!data) return;
        const master = data.master || [];
        const catSet = {};
        master.forEach(function (r) { catSet[r.Category] = true; });
        const cats = Object.keys(catSet).sort();

        let h = '<div class="page-header"><h1>Category Deep Dive</h1></div>';
        h += '<div class="form-group" style="max-width:350px"><label>Select Category</label><select id="dd-cat">';
        cats.forEach(function (cat) { h += '<option>' + esc(cat) + '</option>'; });
        h += '</select></div>';
        h += '<div id="dd-content"></div>';
        c.innerHTML = h;

        function renderCat(cat) {
            const catData = master.filter(function (r) { return r.Category === cat; });
            const records = catData.reduce(function (a, r) { return a + (r.Total_Records || 0); }, 0);
            const breaches = catData.reduce(function (a, r) { return a + (r.Breaches || 0); }, 0);
            const rate = records > 0 ? (breaches / records * 100).toFixed(2) : '0.00';
            const area = $('#dd-content', c);

            let ih = kpiRow([
                { label: 'Scenarios in Category', value: catData.length },
                { label: 'Total Records', value: fmtNum(records) },
                { label: 'Category Breach Rate', value: rate + '%' },
            ]);
            ih += '<hr><h3>Scenario Comparison</h3><div id="dd-table"></div>';
            var ddChartH = Math.max(330, catData.length * 40);
            ih += '<h3>Breach Rate Comparison</h3><div id="dd-chart" class="chart-container" style="height:' + ddChartH + 'px"></div>';
            area.innerHTML = ih;

            const sorted = catData.slice().sort(function (a, b) { return b.Breach_Rate - a.Breach_Rate; });
            $('#dd-table', c).appendChild(buildTable(
                ['Scenario', 'Total_Records', 'Breaches', { key: 'Breach_Rate', label: 'Breach Rate (%)' }],
                sorted
            ));

            const chartData = sorted.slice().reverse();
            Plotly.newPlot($('#dd-chart', c), [{
                type: 'bar', orientation: 'h',
                y: chartData.map(function (d) { return d.Scenario; }),
                x: chartData.map(function (d) { return d.Breach_Rate; }),
                text: chartData.map(function (d) { return d.Breach_Rate + '%'; }),
                textposition: 'outside',
                marker: { color: chartData.map(function (d) { return severityColor(d.Breach_Rate); }) },
            }], pLayout({ height: ddChartH - 30, margin: { l: 250, r: 60 }, xaxis: { title: 'Breach Rate (%)' }, yaxis: { automargin: true } }), PLOTLY_CFG);
        }

        renderCat(cats[0]);
        $('#dd-cat', c).addEventListener('change', function () { renderCat(this.value); });
    };

    // ── Scenario Drill-Down ───────────────────────────────────
    PAGES.scenario_drilldown = async function (c) {
        c.innerHTML = spinner();
        let data;
        try { data = await apiJSON('/api/data/summary'); } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load data</div>'; return; }
        if (!data) return;
        const master = data.master || [];
        const catMap = {};
        master.forEach(function (r) {
            if (!catMap[r.Category]) catMap[r.Category] = [];
            catMap[r.Category].push(r.Scenario);
        });
        const cats = Object.keys(catMap).sort();

        let h = '<div class="page-header"><h1>Scenario Drill-Down</h1></div>';
        h += '<div class="filter-row"><div class="form-group"><label>Category</label><select id="sd-cat">';
        cats.forEach(function (cat) { h += '<option>' + esc(cat) + '</option>'; });
        h += '</select></div><div class="form-group"><label>Scenario</label><select id="sd-scn"></select></div></div>';
        h += '<div id="sd-content"></div>';
        c.innerHTML = h;

        function populateScenarios(cat) {
            const sel = $('#sd-scn', c);
            sel.innerHTML = '';
            (catMap[cat] || []).sort().forEach(function (s) { sel.innerHTML += '<option>' + esc(s) + '</option>'; });
        }

        async function loadScenario(name) {
            const area = $('#sd-content', c);
            area.innerHTML = spinner();
            let scenData;
            try { scenData = await apiJSON('/api/data/scenario/' + encodeURIComponent(name) + '?page=1&page_size=100'); } catch (e) { area.innerHTML = '<div class="alert alert-error">Failed to load scenario</div>'; return; }
            if (!scenData) return;

            const stats = scenData.stats || {};
            const ruleInfo = scenData.rule_info || {};
            const pagination = scenData.pagination || {};
            const total = stats.total || 0;
            const breaches = stats.breaches || 0;
            const nonBreaches = stats.non_breaches || 0;
            const rate = stats.rate || 0;

            let ih = '';
            ih += '<div id="sd-rule-info"></div>';
            ih += kpiRow([
                { label: 'Total Records', value: fmtNum(total) },
                { label: 'Breaches', value: fmtNum(breaches) },
                { label: 'Non-Breaches', value: fmtNum(nonBreaches) },
                { label: 'Breach Rate', value: rate + '%' },
            ]);
            ih += '<hr><div class="grid-2" style="grid-template-columns:1fr 1.5fr"><div><h3>Breach vs Non-Breach</h3><div id="sd-donut" class="chart-container" style="height:380px"></div></div>';
            ih += '<div style="min-width:0"><h3>Breach Reason Breakdown</h3><div id="sd-reasons" class="chart-container" style="min-height:310px"></div></div></div>';
            ih += '<hr><h3>Detailed Data</h3>';
            // Pagination controls
            ih += '<div id="sd-table-controls" class="table-controls">';
            ih += '<div class="table-controls-left">';
            ih += '<div class="form-group form-group-inline"><label>Filter</label><select id="sd-breach-filter"><option value="">All Records</option><option value="Yes">Breaches Only</option><option value="No">Non-Breaches Only</option></select></div>';
            ih += '<div class="form-group form-group-inline"><label>Search</label><input type="text" id="sd-search" placeholder="Search records..." style="width:200px"></div>';
            ih += '</div>';
            ih += '<div class="table-controls-right"><div id="sd-page-info" class="page-info"></div></div>';
            ih += '</div>';
            ih += '<div id="sd-table"></div>';
            ih += '<div id="sd-pagination" class="pagination-bar"></div>';
            area.innerHTML = ih;

            // Rule info
            const ruleDiv = $('#sd-rule-info', c);
            ruleDiv.appendChild(accordion('Rule Information', function (body) {
                let ri = '<p><strong>Scenario:</strong> <code>' + esc(name) + '</code></p>';
                ri += '<p><strong>Category:</strong> ' + esc(ruleInfo.category || 'N/A') + '</p>';
                ri += '<p><strong>Description:</strong> ' + esc(ruleInfo.description || 'N/A') + '</p>';
                if (ruleInfo.status === 'hardcoded_no') {
                    ri += '<div class="alert alert-info">This scenario has a hardcoded breach flag of "No" (no active rule).</div>';
                }
                if (ruleInfo.thresholds && Object.keys(ruleInfo.thresholds).length > 0) {
                    ri += '<p><strong>Thresholds:</strong></p><ul>';
                    Object.entries(ruleInfo.thresholds).forEach(function (e) { ri += '<li><code>' + esc(e[0]) + '</code> = <strong>' + e[1] + '</strong></li>'; });
                    ri += '</ul>';
                }
                body.innerHTML = ri;
            }, true));

            // Donut
            Plotly.newPlot($('#sd-donut', c), [{
                type: 'pie', hole: 0.5,
                labels: ['Breach', 'Non-Breach'], values: [breaches, nonBreaches],
                textinfo: 'percent+value', textposition: 'inside',
                textfont: { color: '#FFFFFF', size: 13 },
                marker: { colors: [RED, GREEN] },
            }], pLayout({ height: 350, showlegend: true, legend: { font: { color: '#1a1a2e' } } }), PLOTLY_CFG);

            // Reasons — use server-aggregated breach_reasons (computed from full dataset)
            var breachReasons = scenData.breach_reasons || {};
            var reasonDiv = $('#sd-reasons', c);
            if (breaches > 0 && Object.keys(breachReasons).length > 0) {
                var reasons = Object.entries(breachReasons).sort(function (a, b) { return b[1] - a[1]; });
                var wrappedLabels = reasons.map(function (r) {
                    var lbl = r[0];
                    if (lbl.length <= 40) return lbl;
                    var mid = Math.floor(lbl.length / 2);
                    var best = lbl.lastIndexOf(' ', mid);
                    if (best < 10) best = lbl.indexOf(' ', mid);
                    if (best < 0) return lbl;
                    return lbl.slice(0, best) + '<br>' + lbl.slice(best + 1);
                });
                var reasonChartH = Math.max(280, reasons.length * 55);
                Plotly.newPlot(reasonDiv, [{
                    type: 'bar', orientation: 'h',
                    y: wrappedLabels,
                    x: reasons.map(function (r) { return r[1]; }),
                    text: reasons.map(function (r) { return String(r[1]); }),
                    textposition: 'outside',
                    marker: { color: RED },
                }], pLayout({ height: reasonChartH - 30, yaxis: { automargin: true, tickfont: { size: 11 } } }), PLOTLY_CFG);
            } else {
                reasonDiv.innerHTML = '<p class="text-muted">No breach reason data available</p>';
            }

            // ── Paginated table state ──
            var sdState = { page: 1, pageSize: 100, sortCol: null, sortDir: 'asc', breachFilter: '', search: '', scenarioName: name };

            async function fetchPage() {
                var tableDiv = $('#sd-table', c);
                var paginationDiv = $('#sd-pagination', c);
                var pageInfoDiv = $('#sd-page-info', c);
                tableDiv.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">Loading...</div>';

                var url = '/api/data/scenario/' + encodeURIComponent(sdState.scenarioName)
                    + '?page=' + sdState.page + '&page_size=' + sdState.pageSize;
                if (sdState.sortCol) url += '&sort_col=' + encodeURIComponent(sdState.sortCol) + '&sort_dir=' + sdState.sortDir;
                if (sdState.breachFilter) url += '&breach_filter=' + sdState.breachFilter;
                if (sdState.search) url += '&search=' + encodeURIComponent(sdState.search);

                var data;
                try { data = await apiJSON(url); } catch (e) { tableDiv.innerHTML = '<div class="alert alert-error">Failed to load page</div>'; return; }

                var rows = data.records || [];
                var pg = data.pagination || {};
                var cols = (data.columns || []).filter(function (k) { return k !== '_orig_idx'; });

                // Build table HTML
                var th = '<table class="data-table"><thead><tr>';
                cols.forEach(function (col) {
                    var sortIcon = '';
                    if (sdState.sortCol === col) sortIcon = sdState.sortDir;
                    th += '<th data-sort-col="' + esc(col) + '">' + esc(col) + '<span class="sort-icon ' + sortIcon + '"></span></th>';
                });
                th += '</tr></thead><tbody>';
                if (rows.length === 0) {
                    th += '<tr><td colspan="' + cols.length + '" class="text-center text-muted" style="padding:2rem">No records found</td></tr>';
                }
                rows.forEach(function (row) {
                    var rowClass = row.Breach_Flag === 'Yes' ? 'breach-row' : '';
                    th += '<tr class="' + rowClass + '">';
                    cols.forEach(function (col) {
                        var val = row[col];
                        if (val === undefined || val === null) val = '';
                        if (col === 'Breach_Flag') {
                            val = '<span class="badge ' + (val === 'Yes' ? 'badge-new' : 'badge-resolved') + '">' + esc(String(val)) + '</span>';
                        } else {
                            val = esc(String(val));
                        }
                        th += '<td>' + val + '</td>';
                    });
                    th += '</tr>';
                });
                th += '</tbody></table>';
                tableDiv.innerHTML = th;

                // Sort click handlers
                $$('th[data-sort-col]', tableDiv).forEach(function (header) {
                    header.style.cursor = 'pointer';
                    header.addEventListener('click', function () {
                        var col = header.dataset.sortCol;
                        if (sdState.sortCol === col) {
                            sdState.sortDir = sdState.sortDir === 'asc' ? 'desc' : 'asc';
                        } else {
                            sdState.sortCol = col;
                            sdState.sortDir = 'asc';
                        }
                        sdState.page = 1;
                        fetchPage();
                    });
                });

                // Page info
                var start = (pg.page - 1) * pg.page_size + 1;
                var end = Math.min(pg.page * pg.page_size, pg.total_records);
                if (pg.total_records === 0) { start = 0; end = 0; }
                pageInfoDiv.textContent = 'Showing ' + start + '–' + end + ' of ' + fmtNum(pg.total_records) + ' records';

                // Pagination buttons
                var ph = '';
                ph += '<button class="btn btn-sm pg-first" ' + (pg.page <= 1 ? 'disabled' : '') + '>&laquo;</button>';
                ph += '<button class="btn btn-sm pg-prev" ' + (pg.page <= 1 ? 'disabled' : '') + '>&lsaquo; Prev</button>';

                // Page number buttons
                var startPage = Math.max(1, pg.page - 2);
                var endPage = Math.min(pg.total_pages, pg.page + 2);
                for (var p = startPage; p <= endPage; p++) {
                    ph += '<button class="btn btn-sm pg-num' + (p === pg.page ? ' btn-primary' : '') + '" data-pg="' + p + '">' + p + '</button>';
                }

                ph += '<button class="btn btn-sm pg-next" ' + (pg.page >= pg.total_pages ? 'disabled' : '') + '>Next &rsaquo;</button>';
                ph += '<button class="btn btn-sm pg-last" ' + (pg.page >= pg.total_pages ? 'disabled' : '') + '>&raquo;</button>';
                paginationDiv.innerHTML = ph;

                // Pagination event handlers
                var firstBtn = $('.pg-first', paginationDiv);
                var prevBtn = $('.pg-prev', paginationDiv);
                var nextBtn = $('.pg-next', paginationDiv);
                var lastBtn = $('.pg-last', paginationDiv);
                if (firstBtn) firstBtn.addEventListener('click', function () { sdState.page = 1; fetchPage(); });
                if (prevBtn) prevBtn.addEventListener('click', function () { sdState.page = Math.max(1, sdState.page - 1); fetchPage(); });
                if (nextBtn) nextBtn.addEventListener('click', function () { sdState.page = Math.min(pg.total_pages, sdState.page + 1); fetchPage(); });
                if (lastBtn) lastBtn.addEventListener('click', function () { sdState.page = pg.total_pages; fetchPage(); });
                $$('.pg-num', paginationDiv).forEach(function (btn) {
                    btn.addEventListener('click', function () { sdState.page = parseInt(btn.dataset.pg); fetchPage(); });
                });
            }

            // Initial table render
            fetchPage();

            // Filter & search handlers
            var searchTimer;
            var searchInput = $('#sd-search', c);
            var breachSel = $('#sd-breach-filter', c);
            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    clearTimeout(searchTimer);
                    searchTimer = setTimeout(function () {
                        sdState.search = searchInput.value.trim();
                        sdState.page = 1;
                        fetchPage();
                    }, 350);
                });
            }
            if (breachSel) {
                breachSel.addEventListener('change', function () {
                    sdState.breachFilter = breachSel.value;
                    sdState.page = 1;
                    fetchPage();
                });
            }
        }

        populateScenarios(cats[0]);
        if (catMap[cats[0]] && catMap[cats[0]].length > 0) loadScenario(catMap[cats[0]].sort()[0]);

        $('#sd-cat', c).addEventListener('change', function () {
            populateScenarios(this.value);
            const scn = $('#sd-scn', c).value;
            if (scn) loadScenario(scn);
        });
        $('#sd-scn', c).addEventListener('change', function () {
            if (this.value) loadScenario(this.value);
        });
    };

    // ── Rules Library ─────────────────────────────────────────
    PAGES.rules_library = async function (c) {
        c.innerHTML = spinner();
        let paramsData;
        try { paramsData = await apiJSON('/api/data/params'); } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load parameters</div>'; return; }
        if (!paramsData) return;

        const params = paramsData.rules || [];
        const rulesData = S.rules || {};
        const rulesArr = rulesData.rules || [];
        const rulesStats = rulesData.stats || {};
        const activeCount = rulesStats.active || 0;
        const hardcodedCount = rulesStats.hardcoded || 0;
        const customActive = rulesStats.custom_active || 0;
        const isAdmin = (S.user && S.user.role === 'admin');

        let summaryData;
        try { summaryData = await apiJSON('/api/data/summary'); } catch (e) { /* ignore */ }
        const currentBreaches = summaryData ? (summaryData.master || []).reduce(function (a, r) { return a + (r.Breaches || 0); }, 0) : 0;

        let h = '<div class="page-header"><h1>Rules Library</h1><p class="page-desc">Edit thresholds below and apply changes to recalculate breaches in real time.</p></div>';
        h += kpiRow([
            { label: 'Active Rules', value: activeCount },
            { label: 'Hardcoded (No Breach)', value: hardcodedCount },
            { label: 'Current Breaches', value: fmtNum(currentBreaches) },
            { label: 'Configurable Thresholds', value: params.length },
            { label: 'Custom Rules (Active)', value: customActive },
        ]);
        h += '<hr><h3>Threshold Parameters</h3>';
        h += '<div id="params-table"></div>';
        h += '<div class="flex gap-2 mt-2"><button class="btn btn-primary" id="btn-apply">Apply Changes</button><button class="btn btn-secondary" id="btn-reset">Reset to Defaults</button></div>';
        h += '<p class="text-small text-muted mt-1">Edit the <strong>Value</strong> column, then click <strong>Apply Changes</strong> to recalculate breaches.</p>';
        if (isAdmin) {
            h += '<hr><div id="custom-rules-section"></div>';
        }
        h += '<hr><h3>Rule Descriptions</h3><div id="rules-desc-table"></div>';
        c.innerHTML = h;

        if (isAdmin) {
            renderCustomRulesSection($('#custom-rules-section', c));
        }

        // Editable params table
        const ptArea = $('#params-table', c);
        let tableHtml = '<div class="table-container"><table class="data-table"><thead><tr><th>Category</th><th>Scenario</th><th>Parameter</th><th>Default</th><th>Value</th></tr></thead><tbody>';
        params.forEach(function (p, i) {
            tableHtml += '<tr><td>' + esc(p.category || '') + '</td><td>' + esc(p.scenario || '') + '</td><td>' + esc(p.parameter || '') + '</td><td>' + esc(String(p.default_val != null ? p.default_val : '')) + '</td>';
            tableHtml += '<td><input class="cell-edit" type="number" step="any" data-idx="' + i + '" value="' + (p.value != null ? p.value : p.default_val) + '"></td></tr>';
        });
        tableHtml += '</tbody></table></div>';
        ptArea.innerHTML = tableHtml;

        // Apply
        $('#btn-apply', c).addEventListener('click', async function () {
            const newParams = {};
            $$('.cell-edit', ptArea).forEach(function (inp) {
                const i = parseInt(inp.dataset.idx);
                const p = params[i];
                newParams[p.scenario + '|' + p.parameter] = parseFloat(inp.value);
            });
            try {
                const result = await apiJSON('/api/data/params', { method: 'POST', body: { params: newParams } });
                if (result) {
                    invalidatePageCache();
                    showToast('Thresholds applied! Breaches: ' + fmtNum(result.old_breaches) + ' -> ' + fmtNum(result.new_breaches), 'success');
                    navigateTo('rules_library');
                }
            } catch (e) { showToast('Failed to apply changes', 'error'); }
        });

        // Reset
        $('#btn-reset', c).addEventListener('click', async function () {
            try {
                const result = await apiJSON('/api/data/params/reset', { method: 'POST' });
                if (result) {
                    invalidatePageCache();
                    showToast('Thresholds reset to defaults!', 'success');
                    navigateTo('rules_library');
                }
            } catch (e) { showToast('Failed to reset', 'error'); }
        });

        // Rule descriptions
        const descRows = rulesArr.slice().sort(function (a, b) { return a.scenario < b.scenario ? -1 : 1; }).map(function (r) {
            return {
                Scenario: r.scenario,
                Category: r.category,
                Status: r.status,
                Description: r.description,
            };
        });
        $('#rules-desc-table', c).appendChild(buildTable(
            ['Scenario', 'Category', { key: 'Status', label: 'Status', render: function (v) { return '<span class="badge ' + (v === 'Active' ? 'badge-active' : 'badge-hardcoded') + '">' + v + '</span>'; } }, 'Description'],
            descRows
        ));
    };

    // ── Custom Rules (admin-only, rendered inside Rules Library) ─────
    async function renderCustomRulesSection(container) {
        if (!container) return;

        const rulesData = S.rules || {};
        const rulesArr = rulesData.rules || [];
        const customArr = rulesData.custom_rules || [];

        // Group scenarios by category for the picker
        const catMap = {};
        rulesArr.forEach(function (r) {
            if (!catMap[r.category]) catMap[r.category] = [];
            catMap[r.category].push(r.scenario);
        });
        const categories = Object.keys(catMap).sort();

        let h = '';
        h += '<div class="custom-rules-section">';
        h += '  <div class="section-header flex-between">';
        h += '    <div><h3 style="margin:0">Custom Rules</h3><p class="text-muted text-small" style="margin:0.25rem 0 0 0">Add your own breach rules in plain English. The LLM will write the detection logic for you.</p></div>';
        h += '    <button class="btn btn-primary" id="btn-new-custom-rule">+ New Custom Rule</button>';
        h += '  </div>';

        h += '  <div class="cr-builder" id="cr-builder" style="display:none">';
        h += '    <div class="cr-builder-body">';
        h += '      <div class="form-grid">';
        h += '        <div class="form-group"><label>Category</label><select id="cr-category" class="form-control"><option value="">Select category...</option>' +
             categories.map(function (cat) { return '<option value="' + esc(cat) + '">' + esc(cat) + '</option>'; }).join('') + '</select></div>';
        h += '        <div class="form-group"><label>Scenario</label><select id="cr-scenario" class="form-control" disabled><option value="">Select scenario...</option></select></div>';
        h += '      </div>';
        h += '      <div class="form-group"><label>Rule Name</label><input type="text" id="cr-name" class="form-control" placeholder="e.g., UPI hourly spike" maxlength="80"></div>';
        h += '      <div class="form-group"><label>Describe the rule in plain English</label>';
        h += '        <textarea id="cr-nl" class="form-control" rows="3" placeholder="e.g., flag transactions where UPI count is above 10 in a single hour"></textarea>';
        h += '      </div>';
        h += '      <div class="cr-columns-hint" id="cr-columns-hint" style="display:none"></div>';
        h += '      <div class="flex gap-2"><button class="btn btn-secondary" id="cr-btn-generate">✨ Generate Logic</button><span class="text-small text-muted" id="cr-gen-status"></span></div>';
        h += '      <div id="cr-generated" style="display:none; margin-top:1rem">';
        h += '        <div class="form-group"><label>Generated SQL condition <span class="text-small text-muted">(editable)</span></label>';
        h += '          <textarea id="cr-sql" class="form-control mono" rows="3"></textarea></div>';
        h += '        <div class="form-group"><label>Breach reason text</label><input type="text" id="cr-reason" class="form-control" maxlength="200"></div>';
        h += '        <div class="flex gap-2"><button class="btn btn-secondary" id="cr-btn-preview">🔍 Preview Matches</button><button class="btn btn-primary" id="cr-btn-save">💾 Save Rule</button><button class="btn btn-secondary" id="cr-btn-cancel">Cancel</button></div>';
        h += '        <div id="cr-preview-result" style="margin-top:1rem"></div>';
        h += '      </div>';
        h += '    </div>';
        h += '  </div>';

        h += '  <div class="cr-list" id="cr-list" style="margin-top:1rem"></div>';
        h += '</div>';

        container.innerHTML = h;

        // State for the builder (also reused by edit flow)
        const state = {
            mode: 'create',          // 'create' | 'edit'
            editingId: null,
            scenarioColumns: [],
        };

        const elCategory = $('#cr-category', container);
        const elScenario = $('#cr-scenario', container);
        const elName = $('#cr-name', container);
        const elNl = $('#cr-nl', container);
        const elColHint = $('#cr-columns-hint', container);
        const elGenBtn = $('#cr-btn-generate', container);
        const elGenStatus = $('#cr-gen-status', container);
        const elGenerated = $('#cr-generated', container);
        const elSql = $('#cr-sql', container);
        const elReason = $('#cr-reason', container);
        const elPreviewBtn = $('#cr-btn-preview', container);
        const elSaveBtn = $('#cr-btn-save', container);
        const elCancelBtn = $('#cr-btn-cancel', container);
        const elPreviewResult = $('#cr-preview-result', container);
        const elBuilder = $('#cr-builder', container);
        const elNewBtn = $('#btn-new-custom-rule', container);

        function resetBuilder() {
            state.mode = 'create';
            state.editingId = null;
            state.scenarioColumns = [];
            elCategory.value = '';
            elScenario.innerHTML = '<option value="">Select scenario...</option>';
            elScenario.disabled = true;
            elName.value = '';
            elNl.value = '';
            elSql.value = '';
            elReason.value = '';
            elColHint.style.display = 'none';
            elColHint.innerHTML = '';
            elGenStatus.textContent = '';
            elGenerated.style.display = 'none';
            elPreviewResult.innerHTML = '';
            elSaveBtn.textContent = '💾 Save Rule';
        }

        function showBuilder() { elBuilder.style.display = 'block'; }
        function hideBuilder() { elBuilder.style.display = 'none'; resetBuilder(); }

        elNewBtn.addEventListener('click', function () {
            resetBuilder();
            showBuilder();
        });

        elCancelBtn.addEventListener('click', hideBuilder);

        elCategory.addEventListener('change', function () {
            const cat = elCategory.value;
            elScenario.innerHTML = '<option value="">Select scenario...</option>';
            if (!cat) { elScenario.disabled = true; return; }
            (catMap[cat] || []).slice().sort().forEach(function (s) {
                const opt = document.createElement('option');
                opt.value = s; opt.textContent = s;
                elScenario.appendChild(opt);
            });
            elScenario.disabled = false;
        });

        elScenario.addEventListener('change', async function () {
            const name = elScenario.value;
            elColHint.style.display = 'none';
            elColHint.innerHTML = '';
            state.scenarioColumns = [];
            if (!name) return;
            try {
                const data = await apiJSON('/api/custom-rules/scenarios/' + encodeURIComponent(name) + '/columns');
                if (data) {
                    state.scenarioColumns = data.columns || [];
                    const cols = state.scenarioColumns.map(function (c) {
                        return '<span class="col-chip"><strong>' + esc(c.name) + '</strong> <span class="text-muted">(' + esc(c.type) + ')</span></span>';
                    }).join(' ');
                    elColHint.innerHTML = '<div class="text-small text-muted" style="margin-bottom:0.25rem">Available columns (' + state.scenarioColumns.length + ') — ' + fmtNum(data.row_count) + ' rows:</div><div class="col-chips">' + cols + '</div>';
                    elColHint.style.display = 'block';
                }
            } catch (e) {
                showToast('Failed to load scenario columns. Upload data first.', 'error');
            }
        });

        elGenBtn.addEventListener('click', async function () {
            const scenario = elScenario.value;
            const nl = elNl.value.trim();
            if (!scenario) { showToast('Select a scenario first', 'error'); return; }
            if (!nl) { showToast('Describe the rule in plain English', 'error'); return; }

            elGenBtn.disabled = true;
            elGenStatus.textContent = 'Generating logic...';
            try {
                const result = await apiJSON('/api/custom-rules/generate', {
                    method: 'POST',
                    body: { scenario_name: scenario, nl_description: nl }
                });
                if (result) {
                    elSql.value = result.sql_where || '';
                    elReason.value = result.breach_reason || '';
                    elGenerated.style.display = 'block';
                    elGenStatus.textContent = '✓ Generated. Review, preview, then save.';
                    elPreviewResult.innerHTML = '';
                }
            } catch (e) {
                elGenStatus.textContent = '';
            } finally {
                elGenBtn.disabled = false;
            }
        });

        elPreviewBtn.addEventListener('click', async function () {
            const scenario = elScenario.value;
            const sql = elSql.value.trim();
            if (!scenario || !sql) { showToast('Scenario and SQL are required', 'error'); return; }
            elPreviewBtn.disabled = true;
            elPreviewResult.innerHTML = '<div class="text-muted">Running preview...</div>';
            try {
                const result = await apiJSON('/api/custom-rules/preview', {
                    method: 'POST',
                    body: { scenario_name: scenario, sql_where: sql }
                });
                if (result) {
                    let ph = '<div class="preview-summary">';
                    ph += '<strong>' + fmtNum(result.matched_rows) + '</strong> of ' + fmtNum(result.total_rows) + ' rows match (' + result.match_rate + '%)';
                    ph += '</div>';
                    if (result.sample_matches && result.sample_matches.length) {
                        const keys = Object.keys(result.sample_matches[0]).slice(0, 8);
                        ph += '<div class="table-container" style="margin-top:0.5rem"><table class="data-table"><thead><tr>';
                        keys.forEach(function (k) { ph += '<th>' + esc(k) + '</th>'; });
                        ph += '</tr></thead><tbody>';
                        result.sample_matches.forEach(function (row) {
                            ph += '<tr>';
                            keys.forEach(function (k) {
                                const v = row[k]; ph += '<td>' + esc(v == null ? '' : String(v)) + '</td>';
                            });
                            ph += '</tr>';
                        });
                        ph += '</tbody></table></div>';
                        ph += '<div class="text-small text-muted">Showing first ' + result.sample_matches.length + ' matched rows.</div>';
                    }
                    elPreviewResult.innerHTML = ph;
                }
            } catch (e) { /* toast shown by apiJSON helper */ }
            finally { elPreviewBtn.disabled = false; }
        });

        elSaveBtn.addEventListener('click', async function () {
            const scenario = elScenario.value;
            const payload = {
                scenario_name: scenario,
                rule_name: elName.value.trim(),
                nl_description: elNl.value.trim(),
                sql_where: elSql.value.trim(),
                breach_reason: elReason.value.trim(),
                is_active: true,
            };
            if (!payload.rule_name) { showToast('Rule name is required', 'error'); return; }
            if (!payload.scenario_name) { showToast('Scenario is required', 'error'); return; }
            if (!payload.sql_where) { showToast('Generate or enter the SQL logic first', 'error'); return; }
            if (!payload.breach_reason) payload.breach_reason = payload.rule_name;

            elSaveBtn.disabled = true;
            try {
                let result;
                if (state.mode === 'edit' && state.editingId) {
                    result = await apiJSON('/api/custom-rules/' + state.editingId, {
                        method: 'PUT',
                        body: {
                            rule_name: payload.rule_name,
                            nl_description: payload.nl_description,
                            sql_where: payload.sql_where,
                            breach_reason: payload.breach_reason,
                        }
                    });
                } else {
                    result = await apiJSON('/api/custom-rules', { method: 'POST', body: payload });
                }
                if (result) {
                    showToast(state.mode === 'edit' ? 'Rule updated' : 'Rule saved', 'success');
                    S.rules = null;            // force rules cache reload
                    invalidatePageCache();
                    hideBuilder();
                    await loadRules();
                    await refreshList();
                }
            } catch (e) { /* toast shown by apiJSON helper */ }
            finally { elSaveBtn.disabled = false; }
        });

        async function refreshList() {
            const latest = S.rules || {};
            renderList(latest.custom_rules || []);
        }

        function renderList(rules) {
            const listEl = $('#cr-list', container);
            if (!rules.length) {
                listEl.innerHTML = '<div class="empty-state text-muted" style="padding:1rem">No custom rules yet. Click <strong>+ New Custom Rule</strong> above to add one.</div>';
                return;
            }
            let lh = '<div class="table-container"><table class="data-table"><thead><tr>';
            lh += '<th>Rule</th><th>Scenario</th><th>Category</th><th>Description</th><th>Status</th><th>Actions</th>';
            lh += '</tr></thead><tbody>';
            rules.forEach(function (r) {
                lh += '<tr>';
                lh += '<td><div><strong>' + esc(r.rule_name) + '</strong></div><div class="text-small text-muted mono" style="max-width:320px; word-break:break-all">' + esc(r.sql_where) + '</div></td>';
                lh += '<td>' + esc(r.scenario_name) + '</td>';
                lh += '<td>' + esc(r.category) + '</td>';
                lh += '<td><div class="text-small" style="max-width:260px">' + esc(r.nl_description) + '</div></td>';
                const badge = r.is_active ? 'badge-active' : 'badge-hardcoded';
                const label = r.is_active ? 'Active' : 'Disabled';
                lh += '<td><span class="badge ' + badge + '">' + label + '</span></td>';
                lh += '<td class="actions"><button class="btn btn-sm" data-action="toggle" data-id="' + r.id + '">' + (r.is_active ? 'Disable' : 'Enable') + '</button>';
                lh += ' <button class="btn btn-sm btn-secondary" data-action="edit" data-id="' + r.id + '">Edit</button>';
                lh += ' <button class="btn btn-sm btn-danger" data-action="delete" data-id="' + r.id + '">Delete</button></td>';
                lh += '</tr>';
            });
            lh += '</tbody></table></div>';
            listEl.innerHTML = lh;

            $$('.btn[data-action]', listEl).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const id = parseInt(btn.dataset.id, 10);
                    const action = btn.dataset.action;
                    const rule = rules.find(function (x) { return x.id === id; });
                    if (!rule) return;
                    if (action === 'delete') handleDelete(id);
                    else if (action === 'toggle') handleToggle(rule);
                    else if (action === 'edit') handleEdit(rule);
                });
            });
        }

        async function handleDelete(id) {
            if (!confirm('Delete this custom rule?')) return;
            try {
                const r = await apiJSON('/api/custom-rules/' + id, { method: 'DELETE' });
                if (r) {
                    showToast('Rule deleted', 'success');
                    S.rules = null;
                    invalidatePageCache();
                    await loadRules();
                    refreshList();
                }
            } catch (e) { /* toast shown */ }
        }

        async function handleToggle(rule) {
            try {
                const r = await apiJSON('/api/custom-rules/' + rule.id, {
                    method: 'PUT', body: { is_active: !rule.is_active }
                });
                if (r) {
                    showToast('Rule ' + (rule.is_active ? 'disabled' : 'enabled'), 'success');
                    S.rules = null;
                    invalidatePageCache();
                    await loadRules();
                    refreshList();
                }
            } catch (e) { /* toast shown */ }
        }

        async function handleEdit(rule) {
            resetBuilder();
            state.mode = 'edit';
            state.editingId = rule.id;
            elCategory.value = rule.category;
            elCategory.dispatchEvent(new Event('change'));
            elScenario.value = rule.scenario_name;
            elScenario.dispatchEvent(new Event('change'));
            elName.value = rule.rule_name;
            elNl.value = rule.nl_description;
            elSql.value = rule.sql_where;
            elReason.value = rule.breach_reason;
            elGenerated.style.display = 'block';
            elGenStatus.textContent = 'Editing existing rule.';
            elSaveBtn.textContent = '💾 Update Rule';
            showBuilder();
        }

        renderList(customArr);
    }

    // ── Exception Report ──────────────────────────────────────
    PAGES.exception_report = async function (c) {
        c.innerHTML = spinner();
        let data;
        try { data = await apiJSON('/api/data/summary'); } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load data</div>'; return; }
        if (!data) return;

        const master = data.master || [];
        const catSet = {}, scenSet = {};
        master.forEach(function (r) {
            catSet[r.Category] = true;
            scenSet[r.Scenario] = r.Category;
        });
        const allCats = Object.keys(catSet).sort();
        const allScens = Object.keys(scenSet).sort();

        let h = '<div class="page-header"><h1>Exception Report</h1><p class="page-desc">Filter and export breach records across all scenarios.</p></div>';
        h += '<div class="filter-row" id="er-filters"></div>';
        h += '<div id="er-results"></div>';
        h += '<div class="flex gap-2 mt-2" id="er-buttons" style="display:none"><button class="btn btn-primary" id="btn-dl-csv">Download CSV</button><button class="btn btn-secondary" id="btn-dl-excel">Download Excel</button></div>';
        c.innerHTML = h;

        const filterRow = $('#er-filters', c);
        // Scenario multiselect (created first so catMs onChange can reference it)
        const scnDiv = el('div', { className: 'form-group' });
        scnDiv.innerHTML = '<label>Scenario</label>';
        const scnMs = buildMultiselect('er-scn', allScens, allScens.slice());
        scnDiv.appendChild(scnMs);

        // Category multiselect — updates scenario list on change
        const catDiv = el('div', { className: 'form-group' });
        catDiv.innerHTML = '<label>Category</label>';
        const catMs = buildMultiselect('er-cat', allCats, allCats.slice(), function (selCats) {
            var filteredScens = allScens.filter(function (s) { return selCats.indexOf(scenSet[s]) >= 0; });
            scnMs.setOptions(filteredScens, filteredScens.slice());
        });
        catDiv.appendChild(catMs);
        filterRow.appendChild(catDiv);
        filterRow.appendChild(scnDiv);

        // Breach status multiselect
        const bsDiv = el('div', { className: 'form-group' });
        bsDiv.innerHTML = '<label>Breach Status</label>';
        const bsMs = buildMultiselect('er-bs', ['Yes', 'No'], ['Yes']);
        bsDiv.appendChild(bsMs);
        filterRow.appendChild(bsDiv);

        // Apply button
        const applyBtn = el('div', { className: 'form-group', style: { alignSelf: 'flex-end' } });
        applyBtn.innerHTML = '<label>&nbsp;</label>';
        const btn = el('button', { className: 'btn btn-primary' }, 'Apply Filters');
        applyBtn.appendChild(btn);
        filterRow.appendChild(applyBtn);

        async function applyFilters() {
            const resultsDiv = $('#er-results', c);
            resultsDiv.innerHTML = spinner();
            const filterBody = {
                categories: catMs.getSelected(),
                scenarios: scnMs.getSelected(),
                breach_status: bsMs.getSelected(),
            };
            try {
                const resp = await apiJSON('/api/reports/exception', { method: 'POST', body: filterBody });
                if (!resp) return;
                const records = resp.records || [];
                resultsDiv.innerHTML = '<h3>Filtered Results: ' + fmtNum(records.length) + ' records</h3>';
                if (records.length > 0) {
                    const cols = Object.keys(records[0]);
                    resultsDiv.appendChild(buildTable(cols.map(function (col) { return { key: col, label: col }; }), records));
                    $('#er-buttons', c).style.display = 'flex';
                } else {
                    resultsDiv.innerHTML += '<div class="empty-state"><div class="empty-title">No matching records</div></div>';
                    $('#er-buttons', c).style.display = 'none';
                }
            } catch (e) {
                resultsDiv.innerHTML = '<div class="alert alert-error">Failed to load exception data</div>';
            }
        }

        btn.addEventListener('click', applyFilters);

        $('#btn-dl-csv', c).addEventListener('click', function () {
            downloadFile('/api/reports/exception/csv', 'aim_exception_report.csv');
        });
        $('#btn-dl-excel', c).addEventListener('click', function () {
            downloadFile('/api/reports/exception/excel', 'aim_exception_report.xlsx');
        });

        applyFilters();
    };

    // ── Trend Analysis ────────────────────────────────────────
    PAGES.trend_analysis = async function (c) {
        c.innerHTML = spinner();
        let data;
        try { data = await apiJSON('/api/data/trend'); } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load trend data</div>'; return; }
        if (!data || !data.trend || data.trend.length === 0) {
            c.innerHTML = '<div class="page-header"><h1>Trend Analysis</h1></div><div class="alert alert-warning">No date columns found in any scenario sheet. Trend analysis requires date-based data.</div>';
            return;
        }

        const trend = data.trend;
        const cov = data.coverage || {};
        const coveredCount = cov.covered || 0;
        const totalScenarios = cov.total || 0;
        const dateMin = cov.date_range_min || '';
        const dateMax = cov.date_range_max || '';
        const numPeriods = cov.periods || 0;
        const totalBreachRecords = trend.reduce(function (a, r) { return a + (r.Breaches || 0); }, 0);

        let h = '<div class="page-header"><h1>Trend Analysis</h1><p class="page-desc">Time-based breach distribution derived from date columns.</p></div>';
        h += kpiRow([
            { label: 'Scenarios with Dates', value: coveredCount + ' / ' + totalScenarios },
            { label: 'Date Range', value: dateMin + ' - ' + dateMax },
            { label: 'Time Periods', value: numPeriods + ' months' },
            { label: 'Total Breach Records', value: fmtNum(totalBreachRecords) },
        ]);
        h += '<hr>';

        h += '<h3>Overall Breach Rate Over Time</h3><div id="trend-c1" class="chart-container" style="height:430px"></div>';
        h += '<h3>Breach Volume &amp; Records Over Time</h3><div id="trend-c2" class="chart-container" style="height:450px"></div>';
        h += '<h3>Category Breach Rate Heatmap Over Time</h3><div id="trend-c3" class="chart-container" style="min-height:430px"></div>';
        h += '<h3>Top Movers &mdash; Scenarios with Biggest Rate Shift</h3><div id="trend-c4" class="chart-container" style="min-height:380px"></div>';
        h += '<hr><h3>Scenario Trend Lines</h3><div class="form-group" style="max-width:600px"><label>Select scenarios to compare</label><div id="trend-scn-select"></div></div><div id="trend-c5" class="chart-container" style="height:480px"></div>';
        h += '<hr><h3>Period-over-Period Category Breakdown</h3><div id="trend-c6" class="chart-container" style="height:480px"></div>';
        h += '<hr><div id="trend-raw"></div>';
        c.innerHTML = h;

        // Defer chart rendering to next frame so container layout is complete
        requestAnimationFrame(function () {

        // Aggregate overall by period
        const overallMap = {};
        trend.forEach(function (r) {
            const p = r.Period;
            if (!overallMap[p]) overallMap[p] = { period: p, period_dt: r.Period_dt, records: 0, breaches: 0 };
            overallMap[p].records += r.Records || 0;
            overallMap[p].breaches += r.Breaches || 0;
        });
        const overall = Object.values(overallMap).sort(function (a, b) { return a.period_dt < b.period_dt ? -1 : 1; });
        overall.forEach(function (o) { o.rate = o.records > 0 ? +(o.breaches / o.records * 100).toFixed(2) : 0; });
        const periodLabels = overall.map(function (o) { return o.period; });

        // Chart 1: Overall Breach Rate
        const traces1 = [{
            type: 'scatter', mode: 'lines+markers+text',
            x: periodLabels, y: overall.map(function (o) { return o.rate; }),
            text: overall.map(function (o) { return o.rate + '%'; }),
            textposition: 'top center', textfont: { size: 11, color: PRIMARY },
            line: { color: PRIMARY, width: 3 }, marker: { size: 10, color: PRIMARY }, name: 'Breach Rate',
        }];
        if (overall.length >= 3) {
            const xNum = overall.map(function (_, i) { return i; });
            const yVals = overall.map(function (o) { return o.rate; });
            const n = xNum.length;
            const sumX = xNum.reduce(function (a, b) { return a + b; }, 0);
            const sumY = yVals.reduce(function (a, b) { return a + b; }, 0);
            const sumXY = xNum.reduce(function (a, x, i) { return a + x * yVals[i]; }, 0);
            const sumX2 = xNum.reduce(function (a, x) { return a + x * x; }, 0);
            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
            const intercept = (sumY - slope * sumX) / n;
            const trendLine = xNum.map(function (x) { return +(slope * x + intercept).toFixed(2); });
            const dir = slope > 0.5 ? 'upward' : slope < -0.5 ? 'downward' : 'stable';
            traces1.push({
                type: 'scatter', mode: 'lines',
                x: periodLabels, y: trendLine,
                line: { color: slope > 0 ? RED : GREEN, width: 2, dash: 'dash' },
                name: 'Trend (' + dir + ')',
            });
        }
        Plotly.newPlot($('#trend-c1', c), traces1, pLayout({ height: 400, margin: { l: 60, r: 20, t: 30, b: 40 }, yaxis: { title: 'Breach Rate (%)' }, showlegend: true, legend: { font: { color: '#1a1a2e' } } }), PLOTLY_CFG);

        // Chart 2: Volume bars + rate line
        Plotly.newPlot($('#trend-c2', c), [
            { type: 'bar', x: periodLabels, y: overall.map(function (o) { return o.records; }), name: 'Total Records', marker: { color: SECONDARY, opacity: 0.4 } },
            { type: 'bar', x: periodLabels, y: overall.map(function (o) { return o.breaches; }), name: 'Breaches', marker: { color: RED } },
            { type: 'scatter', x: periodLabels, y: overall.map(function (o) { return o.rate; }), name: 'Breach Rate %', mode: 'lines+markers', line: { color: ACCENT, width: 3 }, marker: { size: 8 }, yaxis: 'y2' },
        ], pLayout({ height: 420, margin: { l: 60, r: 60, t: 30, b: 40 }, yaxis: { title: 'Count' }, yaxis2: { title: 'Breach Rate (%)', overlaying: 'y', side: 'right', showgrid: false }, barmode: 'group', showlegend: true, legend: { font: { color: '#1a1a2e' } } }), PLOTLY_CFG);

        // Chart 3: Category heatmap over time
        const catTimeMap = {};
        trend.forEach(function (r) {
            const key = r.Category + '||' + r.Period;
            if (!catTimeMap[key]) catTimeMap[key] = { cat: r.Category, period: r.Period, records: 0, breaches: 0 };
            catTimeMap[key].records += r.Records || 0;
            catTimeMap[key].breaches += r.Breaches || 0;
        });
        const heatCats = {};
        Object.values(catTimeMap).forEach(function (d) {
            if (!heatCats[d.cat]) heatCats[d.cat] = {};
            heatCats[d.cat][d.period] = d.records > 0 ? +(d.breaches / d.records * 100).toFixed(1) : 0;
        });
        const heatCatNames = Object.keys(heatCats).sort();
        const heatZ = heatCatNames.map(function (cat) { return periodLabels.map(function (p) { return heatCats[cat][p] || 0; }); });
        Plotly.newPlot($('#trend-c3', c), [{
            type: 'heatmap', z: heatZ, x: periodLabels, y: heatCatNames,
            colorscale: [[0, '#FFFFFF'], [0.25, '#FFF3CD'], [0.5, AMBER], [0.75, '#E67E22'], [1, RED]],
            text: heatZ.map(function (row) { return row.map(function (v) { return v.toFixed(1); }); }),
            texttemplate: '<b>%{text}%</b>', textfont: { color: '#1a1a2e', size: 10 },
            hovertemplate: 'Category: %{y}<br>Period: %{x}<br>Breach Rate: %{z:.1f}%<extra></extra>',
            colorbar: { title: 'Breach %' },
        }], pLayout({ height: Math.max(400, heatCatNames.length * 45), margin: { l: 200, r: 80, t: 30, b: 40 }, yaxis: { autorange: 'reversed' } }), PLOTLY_CFG);

        // Chart 4: Top Movers
        const scenPeriods = {};
        trend.forEach(function (r) {
            if (!scenPeriods[r.Scenario]) scenPeriods[r.Scenario] = [];
            scenPeriods[r.Scenario].push(r);
        });
        const movers = [];
        Object.keys(scenPeriods).forEach(function (scn) {
            const arr = scenPeriods[scn].sort(function (a, b) { return a.Period_dt < b.Period_dt ? -1 : 1; });
            if (arr.length < 2) return;
            const first = arr[0], last = arr[arr.length - 1];
            const fr = first.Records > 0 ? first.Breaches / first.Records * 100 : 0;
            const lr = last.Records > 0 ? last.Breaches / last.Records * 100 : 0;
            movers.push({ Scenario: scn, delta: +(lr - fr).toFixed(2) });
        });
        movers.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
        const topMovers = movers.slice(0, 15).sort(function (a, b) { return a.delta - b.delta; });
        if (topMovers.length > 0) {
            Plotly.newPlot($('#trend-c4', c), [{
                type: 'bar', orientation: 'h',
                y: topMovers.map(function (m) { return m.Scenario; }),
                x: topMovers.map(function (m) { return m.delta; }),
                text: topMovers.map(function (m) { return (m.delta >= 0 ? '+' : '') + m.delta + '%'; }),
                textposition: 'outside',
                marker: { color: topMovers.map(function (m) { return m.delta > 0 ? RED : GREEN; }) },
            }], pLayout({ height: Math.max(350, topMovers.length * 35), margin: { l: 250 }, xaxis: { title: 'Breach Rate Change (pp)' } }), PLOTLY_CFG);
        } else {
            $('#trend-c4', c).innerHTML = '<p class="text-muted">Not enough multi-period data.</p>';
        }

        // Chart 5: Scenario Trend Lines
        const multiPeriodScens = Object.keys(scenPeriods).filter(function (s) { return scenPeriods[s].length >= 2; }).sort();
        const scnSelectDiv = $('#trend-scn-select', c);
        if (multiPeriodScens.length > 0) {
            const scnMs = buildMultiselect('trend-scn-ms', multiPeriodScens, multiPeriodScens.slice(0, 5), renderChart5);
            scnSelectDiv.appendChild(scnMs);
            renderChart5(multiPeriodScens.slice(0, 5));
        } else {
            scnSelectDiv.innerHTML = '<p class="text-muted">No scenarios with multiple periods.</p>';
        }

        function renderChart5(selected) {
            const chartDiv = $('#trend-c5', c);
            if (!selected || selected.length === 0) { chartDiv.innerHTML = '<p class="text-muted">Select scenarios above.</p>'; return; }
            const traces = [];
            selected.forEach(function (scn, idx) {
                const arr = (scenPeriods[scn] || []).sort(function (a, b) { return a.Period_dt < b.Period_dt ? -1 : 1; });
                const aggMap = {};
                arr.forEach(function (r) {
                    if (!aggMap[r.Period]) aggMap[r.Period] = { records: 0, breaches: 0 };
                    aggMap[r.Period].records += r.Records;
                    aggMap[r.Period].breaches += r.Breaches;
                });
                const points = Object.entries(aggMap).map(function (e) { return { p: e[0], rate: e[1].records > 0 ? +(e[1].breaches / e[1].records * 100).toFixed(2) : 0 }; });
                traces.push({
                    type: 'scatter', mode: 'lines+markers',
                    x: points.map(function (p) { return p.p; }),
                    y: points.map(function (p) { return p.rate; }),
                    name: scn.length > 30 ? scn.slice(0, 30) : scn,
                    line: { width: 2.5, color: COLORWAY[idx % COLORWAY.length] },
                    marker: { size: 7 },
                });
            });
            Plotly.newPlot(chartDiv, traces, pLayout({ height: 450, yaxis: { title: 'Breach Rate (%)' }, showlegend: true, legend: { font: { color: '#1a1a2e', size: 10 } } }), PLOTLY_CFG);
        }

        // Chart 6: Stacked bar
        const catPeriodMap = {};
        trend.forEach(function (r) {
            const key = r.Period + '||' + r.Category;
            if (!catPeriodMap[key]) catPeriodMap[key] = { period: r.Period, category: r.Category, breaches: 0 };
            catPeriodMap[key].breaches += r.Breaches || 0;
        });
        const stackCats = {};
        Object.values(catPeriodMap).forEach(function (d) {
            if (!stackCats[d.category]) stackCats[d.category] = {};
            stackCats[d.category][d.period] = d.breaches;
        });
        const stackTraces = [];
        const stackCatNames = Object.keys(stackCats).sort();
        stackCatNames.forEach(function (cat, idx) {
            stackTraces.push({
                type: 'bar', name: cat,
                x: periodLabels, y: periodLabels.map(function (p) { return stackCats[cat][p] || 0; }),
                marker: { color: [PRIMARY, SECONDARY, ACCENT, RED, GREEN, '#17A2B8', '#6C757D', AMBER, '#6610F2', '#E83E8C', '#20C997', '#FD7E14'][idx % 12] },
            });
        });
        Plotly.newPlot($('#trend-c6', c), stackTraces, pLayout({ height: 450, barmode: 'stack', yaxis: { title: 'Breaches' }, showlegend: true, legend: { font: { color: '#1a1a2e', size: 10 } } }), PLOTLY_CFG);

        // Raw data accordion
        const rawDiv = $('#trend-raw', c);
        rawDiv.appendChild(accordion('View Raw Trend Data', function (body) {
            body.appendChild(buildTable(
                ['Scenario', 'Category', 'Period', 'Records', 'Breaches', { key: 'Breach_Rate', label: 'Breach Rate (%)' }],
                trend.map(function (r) { return Object.assign({}, r, { Breach_Rate: r.Records > 0 ? +(r.Breaches / r.Records * 100).toFixed(2) : 0 }); })
            ));
        }, false));

        }); // end requestAnimationFrame
    };

    // ── Causality Analysis ────────────────────────────────────
    PAGES.causality_analysis = async function (c) {
        c.innerHTML = spinner();

        // First get available ID columns
        let data;
        try { data = await apiJSON('/api/data/causality'); } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load causality data</div>'; return; }
        if (!data) { c.innerHTML = '<div class="alert alert-warning">No shared identifier columns found across scenarios with breaches.</div>'; return; }

        const idColumns = data.linkable_cols || [];
        const caStats = data.stats || {};
        if (idColumns.length === 0) {
            c.innerHTML = '<div class="page-header"><h1>Causality Analysis</h1></div><div class="alert alert-warning">No shared identifier columns found across scenarios with breaches.</div>';
            return;
        }

        let h = '<div class="page-header"><h1>Causality Analysis</h1><p class="page-desc">Discover which breaches co-occur on the same entities, revealing linked control failures.</p></div>';

        h += kpiRow([
            { label: 'Linkable ID Columns', value: caStats.total_linkable || idColumns.length },
            { label: 'Linked Scenarios', value: caStats.total_linked || '?' },
            { label: 'Unique Breached Entities', value: fmtNum(caStats.total_entities || 0) },
        ]);
        h += '<hr>';
        h += '<div class="form-group" style="max-width:400px"><label>Analyze by Identifier</label><select id="ca-id-col">';
        idColumns.forEach(function (col) {
            const label = col.col + ' (' + col.scenario_count + ' scenarios)';
            const val = col.col;
            h += '<option value="' + esc(val) + '">' + esc(label) + '</option>';
        });
        h += '</select></div>';
        h += '<div id="ca-content"></div>';
        c.innerHTML = h;

        async function loadCausality(idCol) {
            const area = $('#ca-content', c);
            area.innerHTML = spinner();
            let caData;
            try { caData = await apiJSON('/api/data/causality?id_col=' + encodeURIComponent(idCol)); } catch (e) { area.innerHTML = '<div class="alert alert-error">Failed to load analysis</div>'; return; }
            if (!caData) return;

            let ih = '';

            // Section 1: Co-occurrence Matrix
            const cooccur = caData.matrix || {};
            const coScenarios = cooccur.index || cooccur.columns || [];
            const coMatrix = cooccur.data || [];
            if (coScenarios.length > 0) {
                ih += '<h3>Co-occurrence Matrix &mdash; <code>' + esc(idCol) + '</code></h3>';
                ih += '<p class="text-muted text-small">How often breached entities in one scenario also breach in another.</p>';
                ih += '<div id="ca-heatmap" class="chart-container" style="min-height:480px"></div>';
            }

            // Section 2: Strongest Associations
            const pairs = caData.pairs || [];
            if (pairs.length > 0) {
                ih += '<h3>Strongest Associations &mdash; Top Co-occurring Pairs</h3>';
                ih += '<div id="ca-pairs-table"></div>';
                ih += '<div id="ca-pairs-chart" class="chart-container" style="min-height:380px"></div>';
            }

            // Section 3: Repeat Offenders
            const offenders = caData.offenders || [];
            ih += '<hr><h3>Repeat Offenders &mdash; <code>' + esc(idCol) + '</code></h3>';
            ih += '<p class="text-muted text-small">Entities that breach across the most scenarios.</p>';
            ih += '<div id="ca-offenders"></div>';

            // Section 4: Category Chain
            const catPairs = caData.cat_pairs || [];
            ih += '<hr><h3>Category Chain Analysis</h3>';
            ih += '<p class="text-muted text-small">Cross-category breach overlap.</p>';
            ih += '<div id="ca-cat-chain" class="chart-container" style="min-height:430px"></div>';
            ih += '<div id="ca-cat-chain-table"></div>';

            // Section 5: Root Cause
            const rootCauses = caData.influence || [];
            ih += '<hr><h3>Root Cause Candidates</h3>';
            ih += '<p class="text-muted text-small">Scenarios whose breaches most frequently predict breaches elsewhere.</p>';
            ih += '<div id="ca-roots-chart" class="chart-container" style="min-height:380px"></div>';
            ih += '<div id="ca-roots-table"></div>';

            area.innerHTML = ih;

            // Defer chart rendering to next frame so container layout is complete
            requestAnimationFrame(function () {

            // Render heatmap
            if (coScenarios.length > 0 && coMatrix.length > 0) {
                const shortNames = coScenarios.map(function (s) { return s.length > 22 ? s.slice(0, 22) : s; });
                Plotly.newPlot($('#ca-heatmap', c), [{
                    type: 'heatmap', z: coMatrix, x: shortNames, y: shortNames,
                    colorscale: [[0, '#F7F9FC'], [0.3, AMBER], [0.6, '#E67E22'], [1, RED]],
                    text: coMatrix, texttemplate: '%{text:.0f}', textfont: { size: 9, color: '#1a1a2e' },
                    hovertemplate: '%{y} & %{x}: %{z:.0f} shared<extra></extra>', zmin: 0,
                    colorbar: { title: 'Shared' },
                }], pLayout({ height: Math.max(450, coScenarios.length * 35), margin: { l: 200 }, yaxis: { autorange: 'reversed' } }), PLOTLY_CFG);
            }

            // Render pairs
            if (pairs.length > 0) {
                const pairCols = Object.keys(pairs[0]);
                $('#ca-pairs-table', c).appendChild(buildTable(pairCols.map(function (k) { return { key: k, label: k }; }), pairs.slice(0, 20)));

                const topPairs = pairs.slice(0, 10).reverse();
                const pairLabels = topPairs.map(function (p) {
                    const a = (p['Scenario A'] || p.scenario_a || '').slice(0, 18);
                    const b = (p['Scenario B'] || p.scenario_b || '').slice(0, 18);
                    return a + ' & ' + b;
                });
                const pairVals = topPairs.map(function (p) { return p['Shared Breaches'] || p.shared_breaches || 0; });
                Plotly.newPlot($('#ca-pairs-chart', c), [{
                    type: 'bar', orientation: 'h',
                    y: pairLabels, x: pairVals,
                    text: pairVals.map(String), textposition: 'outside',
                    marker: { color: RED },
                }], pLayout({ height: Math.max(350, topPairs.length * 38), margin: { l: 250 }, xaxis: { title: 'Shared Breached Entities' } }), PLOTLY_CFG);
            }

            // Render offenders
            const offDiv = $('#ca-offenders', c);
            if (offenders.length > 0) {
                const maxHit = Math.max.apply(null, offenders.map(function (o) { return o.breached_scenarios || o['Breached Scenarios'] || 0; }));
                const avgHit = (offenders.reduce(function (a, o) { return a + (o.breached_scenarios || o['Breached Scenarios'] || 0); }, 0) / offenders.length).toFixed(1);
                offDiv.innerHTML = kpiRow([
                    { label: 'Repeat Offenders', value: fmtNum(offenders.length) },
                    { label: 'Max Scenarios Hit', value: maxHit },
                    { label: 'Avg Scenarios Hit', value: avgHit },
                ]);
                const oCols = Object.keys(offenders[0]);
                const oTable = buildTable(oCols.map(function (k) { return { key: k, label: k }; }), offenders.slice(0, 25));
                offDiv.appendChild(oTable);
            } else {
                offDiv.innerHTML = '<p class="text-muted">No repeat offenders found.</p>';
            }

            // Category chain — build heatmap from flat cat_pairs array
            if (catPairs.length > 0) {
                // Build category set and matrix from pairs
                var catSet = {};
                catPairs.forEach(function (p) { catSet[p['Category A']] = true; catSet[p['Category B']] = true; });
                var catChainNames = Object.keys(catSet).sort();
                var catIdx = {};
                catChainNames.forEach(function (n, i) { catIdx[n] = i; });
                var catChainData = catChainNames.map(function () { return catChainNames.map(function () { return 0; }); });
                catPairs.forEach(function (p) {
                    var i = catIdx[p['Category A']], j = catIdx[p['Category B']];
                    catChainData[i][j] = p['Shared Entities'];
                    catChainData[j][i] = p['Shared Entities'];
                });
                Plotly.newPlot($('#ca-cat-chain', c), [{
                    type: 'heatmap', z: catChainData, x: catChainNames, y: catChainNames,
                    colorscale: [[0, '#F7F9FC'], [0.3, AMBER], [0.6, '#E67E22'], [1, RED]],
                    text: catChainData, texttemplate: '%{text:.0f}', textfont: { size: 11, color: '#1a1a2e' },
                    zmin: 0, colorbar: { title: 'Shared' },
                }], pLayout({ height: Math.max(400, catChainNames.length * 40), margin: { l: 200 }, yaxis: { autorange: 'reversed' } }), PLOTLY_CFG);
                var ccCols = Object.keys(catPairs[0]);
                $('#ca-cat-chain-table', c).appendChild(buildTable(ccCols.map(function (k) { return { key: k, label: k }; }), catPairs));
            }

            // Root causes
            if (rootCauses.length > 0) {
                const topRoots = rootCauses.slice(0, 12).reverse();
                const scoreKey = topRoots[0]['Influence Score'] !== undefined ? 'Influence Score' : 'influence_score';
                Plotly.newPlot($('#ca-roots-chart', c), [{
                    type: 'bar', orientation: 'h',
                    y: topRoots.map(function (r) { return r.Scenario || r.scenario; }),
                    x: topRoots.map(function (r) { return r[scoreKey] || 0; }),
                    text: topRoots.map(function (r) { return String(Math.round(r[scoreKey] || 0)); }),
                    textposition: 'outside',
                    marker: { color: topRoots.map(function (r, i) { return i >= topRoots.length - 3 ? ACCENT : SECONDARY; }) },
                }], pLayout({ height: Math.max(350, topRoots.length * 35), margin: { l: 250 }, xaxis: { title: 'Influence Score' } }), PLOTLY_CFG);

                const rcCols = Object.keys(rootCauses[0]);
                $('#ca-roots-table', c).appendChild(buildTable(rcCols.map(function (k) { return { key: k, label: k }; }), rootCauses));
            }

            }); // end requestAnimationFrame
        }

        const defaultCol = idColumns.length > 0 ? idColumns[0].col : '';
        if (defaultCol) loadCausality(defaultCol);

        const sel = $('#ca-id-col', c);
        if (sel) sel.addEventListener('change', function () { loadCausality(this.value); });
    };

    // ── Comparison Mode ───────────────────────────────────────
    PAGES.comparison_mode = async function (c) {
        let h = '<div class="page-header"><h1>Comparison Mode</h1><p class="page-desc">Upload a second file (e.g. previous month) to compare against the current data.</p></div>';
        h += '<div class="dropzone" id="compare-dropzone"><div class="dropzone-icon">&#128196;</div><div class="dropzone-text">Click or drag to upload comparison file</div><div class="dropzone-hint">.xlsx, .xls files</div><input type="file" id="compare-file" accept=".xlsx,.xls"></div>';
        h += '<div id="compare-content"></div>';
        c.innerHTML = h;

        const dropzone = $('#compare-dropzone', c);
        const fileInput = $('#compare-file', c);

        dropzone.addEventListener('click', function () { fileInput.click(); });
        dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('drag-over'); });
        dropzone.addEventListener('drop', function (e) {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; fileInput.dispatchEvent(new Event('change')); }
        });

        fileInput.addEventListener('change', async function () {
            if (!fileInput.files.length) return;
            const area = $('#compare-content', c);
            area.innerHTML = spinner();
            const fd = new FormData();
            fd.append('file', fileInput.files[0]);
            try {
                await apiJSON('/api/data/comparison/upload', { method: 'POST', body: fd });
                const data = await apiJSON('/api/data/comparison');
                if (!data) { area.innerHTML = '<div class="alert alert-error">Failed to load comparison</div>'; return; }
                renderComparison(area, data);
            } catch (e) {
                area.innerHTML = '<div class="alert alert-error">Upload failed: ' + esc(e.message) + '</div>';
            }
        });

        // Check if comparison already exists (silently — no error toast)
        try {
            const token = sessionStorage.getItem('aim_token');
            const chkResp = await fetch('/api/data/comparison', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
            if (chkResp.ok) {
                const data = await chkResp.json();
                if (data && data.merged) {
                    renderComparison($('#compare-content', c), data);
                }
            }
        } catch (e) { /* no comparison yet */ }

        function renderComparison(area, data) {
            const scenarios = data.merged || [];
            const summary = data.summary || {};

            let ih = '<hr><h3>Overall Comparison</h3>';
            ih += kpiRow([
                { label: 'Current Records', value: fmtNum(summary.curr_records || 0), delta: (summary.d_records >= 0 ? '+' : '') + fmtNum(summary.d_records || 0) + ' vs comparison' },
                { label: 'Current Breaches', value: fmtNum(summary.curr_breaches || 0), delta: (summary.d_breaches >= 0 ? '+' : '') + fmtNum(summary.d_breaches || 0) + ' vs comparison' },
                { label: 'Current Rate', value: (summary.curr_rate || 0) + '%', delta: (summary.d_rate >= 0 ? '+' : '') + (summary.d_rate || 0) + '% vs comparison' },
                { label: 'Scenarios Compared', value: scenarios.length },
            ]);
            ih += '<hr><h3>Scenario-Level Changes</h3><div id="cmp-table"></div>';
            ih += '<hr><div class="grid-2"><div><h3>Change Summary</h3><div id="cmp-summary"></div></div>';
            ih += '<div><h3>Top Changes by Breach Delta</h3><div id="cmp-chart" class="chart-container" style="min-height:330px"></div></div></div>';
            ih += '<hr><h3>Category-Level Comparison</h3><div id="cmp-cat-table"></div>';
            area.innerHTML = ih;

            // Scenario table
            const tableCols = [
                { key: 'Scenario', label: 'Scenario' },
                { key: 'Category', label: 'Category' },
                { key: 'Status', label: 'Status', render: function (v) { const cls = v === 'Worsened' ? 'badge-worsened' : v === 'Improved' ? 'badge-improved' : 'badge-hardcoded'; return '<span class="badge ' + cls + '">' + v + '</span>'; } },
                { key: 'Breaches_Comparison', label: 'Breaches (Old)' },
                { key: 'Breaches_Current', label: 'Breaches (New)' },
                { key: 'Breaches_Delta', label: 'Breaches (+/-)', render: function (v) { const cls = v > 0 ? 'text-red' : v < 0 ? 'text-green' : ''; return '<span class="' + cls + ' text-bold">' + (v > 0 ? '+' : '') + v + '</span>'; } },
                { key: 'Rate_Comparison', label: 'Rate (Old)' },
                { key: 'Rate_Current', label: 'Rate (New)' },
                { key: 'Rate_Delta', label: 'Rate (+/-)', render: function (v) { const cls = v > 0 ? 'text-red' : v < 0 ? 'text-green' : ''; return '<span class="' + cls + ' text-bold">' + (v > 0 ? '+' : '') + Number(v).toFixed(2) + '</span>'; } },
            ];
            $('#cmp-table', c).appendChild(buildTable(tableCols, scenarios));

            // Summary counts
            const statusCounts = {};
            scenarios.forEach(function (s) { statusCounts[s.Status] = (statusCounts[s.Status] || 0) + 1; });
            let summaryH = '<ul>';
            ['Worsened', 'Improved', 'No Change', 'New Scenario', 'Removed Scenario'].forEach(function (st) {
                if (statusCounts[st]) summaryH += '<li><strong>' + st + '</strong>: ' + statusCounts[st] + ' scenarios</li>';
            });
            summaryH += '</ul>';
            $('#cmp-summary', c).innerHTML = summaryH;

            // Top movers chart
            const movers = scenarios.filter(function (s) { return s.Status === 'Worsened' || s.Status === 'Improved'; })
                .sort(function (a, b) { return Math.abs(b.Breaches_Delta) - Math.abs(a.Breaches_Delta); }).slice(0, 10)
                .sort(function (a, b) { return a.Breaches_Delta - b.Breaches_Delta; });
            if (movers.length > 0) {
                Plotly.newPlot($('#cmp-chart', c), [{
                    type: 'bar', orientation: 'h',
                    y: movers.map(function (m) { return m.Scenario; }),
                    x: movers.map(function (m) { return m.Breaches_Delta; }),
                    text: movers.map(function (m) { return (m.Breaches_Delta > 0 ? '+' : '') + m.Breaches_Delta; }),
                    textposition: 'outside',
                    marker: { color: movers.map(function (m) { return m.Breaches_Delta > 0 ? RED : GREEN; }) },
                }], pLayout({ height: Math.max(300, movers.length * 40), margin: { l: 250 }, xaxis: { title: 'Breach Count Change' } }), PLOTLY_CFG);
            }

            // Category table
            const catData = data.cat_comparison || [];
            if (catData.length > 0) {
                const catCols = Object.keys(catData[0]).map(function (k) {
                    if (k.includes('+/-') || k.includes('Delta')) {
                        return { key: k, label: k, render: function (v) { const cls = v > 0 ? 'text-red' : v < 0 ? 'text-green' : ''; return '<span class="' + cls + ' text-bold">' + (v > 0 ? '+' : '') + v + '</span>'; } };
                    }
                    return { key: k, label: k };
                });
                $('#cmp-cat-table', c).appendChild(buildTable(catCols, catData));
            }
        }
    };

    // ── Assignment Manager ────────────────────────────────────
    PAGES.assignment_manager = async function (c) {
        c.innerHTML = '<div class="page-header"><h1>Assignment Manager</h1><p class="page-desc">Assign individual breach records to reviewers for resolution.</p></div><hr><div id="am-tabs"></div>';

        buildTabs([
            { label: 'Create Assignment', id: 'create', render: renderCreateAssignment },
            { label: 'All Assignments', id: 'all', render: renderAllAssignments },
            { label: 'User Management', id: 'users', render: renderUserManagement },
        ], $('#am-tabs', c));
    };

    async function renderCreateAssignment(container) {
        container.innerHTML = spinner();
        let breachedData;
        try { breachedData = await apiJSON('/api/data/breached-scenarios'); } catch (e) { /* ignore */ }
        if (!breachedData || !breachedData.scenarios || breachedData.scenarios.length === 0) {
            container.innerHTML = '<div class="alert alert-warning">No breach data available. Upload an AIM Excel file from the sidebar first &mdash; only scenarios with <strong>Breach Flag = Yes</strong> can be assigned.</div>';
            return;
        }

        let reviewers;
        try { const resp = await apiJSON('/api/users'); const users = resp && resp.users ? resp.users : []; reviewers = users.filter(function (u) { return u.role === 'reviewer' && u.is_active; }); } catch (e) { reviewers = []; }
        if (reviewers.length === 0) {
            container.innerHTML = '<div class="alert alert-warning">No reviewers found. Reviewers must sign up from the login page first.</div>';
            return;
        }

        const scenarios = breachedData.scenarios;
        const catMap = {};
        scenarios.forEach(function (s) { if (!catMap[s.category]) catMap[s.category] = []; catMap[s.category].push(s); });
        const cats = ['All Categories'].concat(Object.keys(catMap).sort());

        let h = '<h3>Assign Breach Records to a Reviewer</h3>';
        h += '<h4>Step 1: Select Scenario</h4>';
        h += '<div class="filter-row"><div class="form-group"><label>Filter by Category</label><select id="ca-cat">';
        cats.forEach(function (cat) { h += '<option>' + esc(cat) + '</option>'; });
        h += '</select></div><div class="form-group"><label>Scenario</label><select id="ca-scn"></select></div></div>';
        h += '<p id="ca-scn-info" class="text-muted text-small"></p>';
        h += '<hr><h4>Step 2: Select Breach Records</h4><p class="text-muted text-small">Select the rows you want to assign, then pick a reviewer below.</p>';
        h += '<div id="ca-records"></div>';
        h += '<p id="ca-selected-count" class="text-bold"></p>';
        h += '<div id="ca-dup-warning"></div>';
        h += '<hr><h4>Step 3: Assign to Reviewer</h4>';
        h += '<div class="form-group" style="max-width:350px"><label>Assign to Reviewer</label><select id="ca-reviewer">';
        reviewers.forEach(function (r) { h += '<option value="' + r.id + '">' + esc((r.display_name || '').trim()) + ' (@' + esc(r.username) + ')</option>'; });
        h += '</select></div>';
        h += '<div class="form-group" style="max-width:500px"><label>Notes (optional)</label><textarea id="ca-notes" placeholder="Add context for the reviewer..."></textarea></div>';
        h += '<button class="btn btn-primary" id="ca-submit">Create Assignment</button>';
        container.innerHTML = h;

        let selectedIndices = [];
        let currentScenario = null;

        function populateScenarios(filterCat) {
            const sel = $('#ca-scn', container);
            sel.innerHTML = '';
            const filtered = filterCat === 'All Categories' ? scenarios : scenarios.filter(function (s) { return s.category === filterCat; });
            filtered.sort(function (a, b) { return a.scenario < b.scenario ? -1 : 1; }).forEach(function (s) {
                sel.innerHTML += '<option value="' + esc(s.scenario) + '">' + esc(s.scenario) + '</option>';
            });
            if (filtered.length > 0) loadBreachRecords(filtered[0].scenario);
        }

        async function loadBreachRecords(scenarioName) {
            currentScenario = scenarioName;
            selectedIndices = [];
            const info = scenarios.find(function (s) { return s.scenario === scenarioName; });
            const infoP = $('#ca-scn-info', container);
            if (info) infoP.textContent = 'Category: ' + info.category + ' | Breaches: ' + info.breaches + ' / ' + info.total_records + ' records (' + info.rate + '%)';

            const area = $('#ca-records', container);
            area.innerHTML = spinner();
            try {
                const data = await apiJSON('/api/data/breach-records/' + encodeURIComponent(scenarioName));
                if (!data || !data.records || data.records.length === 0) {
                    area.innerHTML = '<div class="alert alert-info">No breach records found for this scenario.</div>';
                    return;
                }
                const records = data.records;
                const cols = Object.keys(records[0]).filter(function (k) { return k !== '_selected'; });
                area.innerHTML = '';
                area.appendChild(buildTable(
                    cols.map(function (k) { return { key: k, label: k }; }),
                    records,
                    {
                        checkbox: true,
                        onSelectionChange: function (sel) {
                            selectedIndices = sel;
                            $('#ca-selected-count', container).textContent = sel.length + ' of ' + records.length + ' breach records selected.';
                            checkDuplicates(scenarioName, sel);
                        },
                    }
                ));
                $('#ca-selected-count', container).textContent = '0 of ' + records.length + ' breach records selected.';
            } catch (e) {
                area.innerHTML = '<div class="alert alert-error">Failed to load breach records</div>';
            }
        }

        async function checkDuplicates(scenario, indices) {
            const warnDiv = $('#ca-dup-warning', container);
            if (indices.length === 0) { warnDiv.innerHTML = ''; return; }
            try {
                const data = await apiJSON('/api/assignments/check-duplicates?scenario=' + encodeURIComponent(scenario) + '&indices=' + encodeURIComponent(JSON.stringify(indices)));
                if (data && data.overlaps && data.overlaps.length > 0) {
                    let wh = '<div class="alert alert-warning"><strong>Some selected records are already assigned:</strong><ul>';
                    data.overlaps.forEach(function (ov) {
                        wh += '<li>' + (ov.overlapping_count || ov.count) + ' record(s) overlap with Assignment #' + ov.assignment_id + ' &rarr; ' + esc(ov.assignee_name || '') + ' [' + ov.status + ']</li>';
                    });
                    wh += '</ul><p class="text-small">You can still assign them, but this may cause duplicate work.</p></div>';
                    warnDiv.innerHTML = wh;
                } else {
                    warnDiv.innerHTML = '';
                }
            } catch (e) { /* ignore */ }
        }

        populateScenarios('All Categories');
        $('#ca-cat', container).addEventListener('change', function () { populateScenarios(this.value); });
        $('#ca-scn', container).addEventListener('change', function () { if (this.value) loadBreachRecords(this.value); });

        $('#ca-submit', container).addEventListener('click', async function () {
            if (selectedIndices.length === 0) { showToast('Please select at least one breach record.', 'error'); return; }
            const reviewerId = $('#ca-reviewer', container).value;
            const notes = $('#ca-notes', container).value;
            const scenInfo = scenarios.find(function (s) { return s.scenario === currentScenario; });
            try {
                const result = await apiJSON('/api/assignments', {
                    method: 'POST',
                    body: {
                        scenario_name: currentScenario,
                        category: scenInfo ? scenInfo.category : '',
                        assigned_to: parseInt(reviewerId),
                        breach_count: selectedIndices.length,
                        record_indices: selectedIndices,
                        notes: notes,
                    },
                });
                if (result) {
                    showToast('Assignment #' + result.id + ' created: ' + selectedIndices.length + ' records assigned!', 'success');
                    loadBreachRecords(currentScenario);
                }
            } catch (e) {
                showToast('Failed to create assignment', 'error');
            }
        });
    }

    async function renderAllAssignments(container) {
        container.innerHTML = spinner();
        let assignments;
        try { const resp = await apiJSON('/api/assignments'); assignments = resp && resp.assignments ? resp.assignments : []; } catch (e) { container.innerHTML = '<div class="alert alert-error">Failed to load assignments</div>'; return; }
        if (!assignments || assignments.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-title">No assignments found</div></div>';
            return;
        }

        const rules = S.rules || {};
        const cats = ['All'].concat(Object.keys((rules.categories || {})).sort());
        let h = '<div class="filter-row"><div class="form-group"><label>Filter by Status</label><select id="aa-status"><option>All</option><option>Pending</option><option>In Review</option><option>Resolved</option></select></div>';
        h += '<div class="form-group"><label>Filter by Category</label><select id="aa-cat">';
        cats.forEach(function (cat) { h += '<option>' + esc(cat) + '</option>'; });
        h += '</select></div></div>';
        h += '<div id="aa-kpis"></div><div id="aa-list"></div>';
        container.innerHTML = h;

        function renderList() {
            const statusF = $('#aa-status', container).value;
            const catF = $('#aa-cat', container).value;
            let filtered = assignments;
            if (statusF !== 'All') filtered = filtered.filter(function (a) { return a.status === statusF; });
            if (catF !== 'All') filtered = filtered.filter(function (a) { return a.category === catF; });

            const total = filtered.length;
            const pending = filtered.filter(function (a) { return a.status === 'Pending'; }).length;
            const inReview = filtered.filter(function (a) { return a.status === 'In Review'; }).length;
            const resolved = filtered.filter(function (a) { return a.status === 'Resolved'; }).length;

            $('#aa-kpis', container).innerHTML = kpiRow([
                { label: 'Total', value: total },
                { label: 'Pending', value: pending },
                { label: 'In Review', value: inReview },
                { label: 'Resolved', value: resolved },
            ]);

            const list = $('#aa-list', container);
            list.innerHTML = '';
            if (filtered.length === 0) {
                list.innerHTML = '<div class="empty-state"><div class="empty-title">No assignments match filters</div></div>';
                return;
            }

            filtered.forEach(function (asgn) {
                const card = el('div', { className: 'assignment-card' });
                const badgeCls = asgn.status === 'Pending' ? 'badge-pending' : asgn.status === 'In Review' ? 'badge-in-review' : 'badge-resolved';
                const newTag = !asgn.is_read ? ' <span class="badge badge-new">NEW</span>' : '';
                const header = el('div', { className: 'assignment-card-header' });
                header.innerHTML = '<span class="card-title">#' + asgn.id + ' &mdash; ' + esc(asgn.scenario_name) + ' (' + asgn.breach_count + ' records) &rarr; ' + esc((asgn.assignee_name || '').trim()) + '</span><span class="badge ' + badgeCls + '">' + asgn.status + '</span>' + newTag;

                const body = el('div', { className: 'assignment-card-body' });
                header.addEventListener('click', function () {
                    body.classList.toggle('open');
                    if (body.classList.contains('open') && body.children.length === 0) renderAssignmentBody(body, asgn);
                });

                card.appendChild(header);
                card.appendChild(body);
                list.appendChild(card);
            });
        }

        async function renderAssignmentBody(body, asgn) {
            let bh = '<div class="detail-grid">';
            bh += '<div><span class="detail-label">Category:</span> ' + esc(asgn.category || '') + '</div>';
            bh += '<div><span class="detail-label">Assigned to:</span> ' + esc((asgn.assignee_name || '').trim()) + ' (@' + esc(asgn.assignee_username || '') + ')</div>';
            bh += '<div><span class="detail-label">Assigned by:</span> ' + esc((asgn.assigner_name || '').trim()) + '</div>';
            bh += '<div><span class="detail-label">Records:</span> ' + (asgn.breach_count || 0) + '</div>';
            bh += '<div><span class="detail-label">Created:</span> ' + esc(asgn.created_at || '') + '</div>';
            bh += '<div><span class="detail-label">Updated:</span> ' + esc(asgn.updated_at || '') + '</div>';
            if (asgn.notes) bh += '<div style="grid-column:1/-1"><span class="detail-label">Notes:</span> ' + esc(asgn.notes) + '</div>';
            bh += '</div>';

            // Status override
            bh += '<div class="flex gap-2 items-center mt-2"><select id="aa-st-' + asgn.id + '" style="width:auto"><option ' + (asgn.status === 'Pending' ? 'selected' : '') + '>Pending</option><option ' + (asgn.status === 'In Review' ? 'selected' : '') + '>In Review</option><option ' + (asgn.status === 'Resolved' ? 'selected' : '') + '>Resolved</option></select>';
            bh += '<button class="btn btn-sm btn-primary" id="aa-upd-' + asgn.id + '">Update Status</button>';
            bh += '<button class="btn btn-sm btn-danger" id="aa-del-' + asgn.id + '">Delete</button></div>';

            bh += '<hr><div id="aa-docs-' + asgn.id + '"><strong>Documents:</strong> Loading...</div>';
            bh += '<hr><div id="aa-comments-' + asgn.id + '"><strong>Comments:</strong> Loading...</div>';
            body.innerHTML = bh;

            // Wire status update
            $('#aa-upd-' + asgn.id, body).addEventListener('click', async function () {
                const newStatus = $('#aa-st-' + asgn.id, body).value;
                try {
                    await apiJSON('/api/assignments/' + asgn.id + '/status', { method: 'PUT', body: { status: newStatus } });
                    showToast('Status updated to ' + newStatus, 'success');
                    asgn.status = newStatus;
                } catch (e) { showToast('Failed to update status', 'error'); }
            });

            // Wire delete
            $('#aa-del-' + asgn.id, body).addEventListener('click', function () {
                if (confirm('Are you sure you want to delete Assignment #' + asgn.id + '?')) {
                    apiJSON('/api/assignments/' + asgn.id, { method: 'DELETE' }).then(function () {
                        showToast('Assignment deleted', 'success');
                        renderAllAssignments(container);
                    }).catch(function () { showToast('Failed to delete', 'error'); });
                }
            });

            // Load docs
            loadDocs(asgn.id, body);
            // Load comments
            loadComments(asgn.id, body);
        }

        async function loadDocs(asgnId, body) {
            const docsDiv = $('#aa-docs-' + asgnId, body);
            try {
                const docsResp = await apiJSON('/api/assignments/' + asgnId + '/documents');
                const docs = docsResp && docsResp.documents ? docsResp.documents : [];
                let dh = '<strong>Documents:</strong>';
                if (docs.length > 0) {
                    docs.forEach(function (doc) {
                        dh += '<div class="doc-item"><div><span class="doc-info">' + esc(doc.filename) + '</span><span class="doc-meta"> (' + fmtNum(doc.file_size) + ' bytes) &mdash; ' + esc(doc.display_name || '') + ' on ' + esc(doc.created_at || '') + '</span></div>';
                        dh += '<button class="btn btn-sm btn-secondary dl-doc-btn" data-doc-id="' + doc.id + '" data-filename="' + esc(doc.filename) + '">Download</button></div>';
                    });
                } else {
                    dh += '<p class="text-muted text-small">No documents</p>';
                }
                docsDiv.innerHTML = dh;
                $$('.dl-doc-btn', docsDiv).forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        downloadFile('/api/documents/' + btn.dataset.docId + '/download', btn.dataset.filename);
                    });
                });
            } catch (e) { docsDiv.innerHTML = '<strong>Documents:</strong> <span class="text-muted">Failed to load</span>'; }
        }

        async function loadComments(asgnId, body) {
            const commDiv = $('#aa-comments-' + asgnId, body);
            try {
                const commResp = await apiJSON('/api/assignments/' + asgnId + '/comments');
                const comments = commResp && commResp.comments ? commResp.comments : [];
                let ch = '<strong>Comments:</strong><div class="comment-thread">';
                if (comments.length > 0) {
                    comments.forEach(function (cmt) {
                        ch += '<div class="comment-item"><span class="comment-author">' + esc((cmt.display_name || '').trim()) + '</span><span class="comment-date">' + esc(cmt.created_at || '') + '</span><div class="comment-text">' + esc(cmt.comment_text || '') + '</div></div>';
                    });
                } else {
                    ch += '<p class="text-muted text-small">No comments yet.</p>';
                }
                ch += '</div><div class="comment-input-row"><input type="text" id="aa-cmt-inp-' + asgnId + '" placeholder="Add a comment..."><button class="btn btn-sm btn-primary" id="aa-cmt-btn-' + asgnId + '">Post</button></div>';
                commDiv.innerHTML = ch;

                $('#aa-cmt-btn-' + asgnId, body).addEventListener('click', async function () {
                    const input = $('#aa-cmt-inp-' + asgnId, body);
                    const text = input.value.trim();
                    if (!text) return;
                    try {
                        await apiJSON('/api/assignments/' + asgnId + '/comments', { method: 'POST', body: { text: text } });
                        input.value = '';
                        showToast('Comment posted', 'success');
                        loadComments(asgnId, body);
                    } catch (e) { showToast('Failed to post comment', 'error'); }
                });
            } catch (e) { commDiv.innerHTML = '<strong>Comments:</strong> <span class="text-muted">Failed to load</span>'; }
        }

        renderList();
        $('#aa-status', container).addEventListener('change', renderList);
        $('#aa-cat', container).addEventListener('change', renderList);
    }

    async function renderUserManagement(container) {
        container.innerHTML = spinner();
        let users;
        try { const resp = await apiJSON('/api/users'); users = resp && resp.users ? resp.users : []; } catch (e) { container.innerHTML = '<div class="alert alert-error">Failed to load users</div>'; return; }
        if (!users || users.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-title">No users found</div></div>';
            return;
        }

        let h = '<h3>Registered Users</h3><p class="text-muted text-small">Reviewers sign up from the login page. They appear here once registered.</p>';
        h += '<div id="um-table"></div>';
        h += '<hr><h4>Enable / Disable User</h4>';
        h += '<div class="flex gap-2 items-center"><select id="um-user" style="width:auto">';
        users.filter(function (u) { return u.username !== 'admin'; }).forEach(function (u) {
            h += '<option value="' + u.id + '">' + esc((u.display_name || '').trim()) + ' (@' + esc(u.username) + ')</option>';
        });
        h += '</select><button class="btn btn-sm btn-primary" id="um-toggle">Toggle Active</button></div>';
        container.innerHTML = h;

        const tableRows = users.map(function (u) {
            return {
                id: u.id,
                username: u.username,
                display_name: (u.display_name || '').trim(),
                role: u.role,
                is_active: u.is_active ? 'Active' : 'Disabled',
                created_at: u.created_at || '',
            };
        });
        $('#um-table', container).appendChild(buildTable(
            [{ key: 'id', label: 'ID' }, 'username', 'display_name', 'role',
             { key: 'is_active', label: 'Status', render: function (v) { return '<span class="badge ' + (v === 'Active' ? 'badge-active' : 'badge-hardcoded') + '">' + v + '</span>'; } },
             'created_at'],
            tableRows
        ));

        $('#um-toggle', container).addEventListener('click', async function () {
            const userId = $('#um-user', container).value;
            try {
                await apiJSON('/api/users/' + userId + '/toggle', { method: 'PUT' });
                showToast('User status toggled', 'success');
                renderUserManagement(container);
            } catch (e) { showToast('Failed to toggle user', 'error'); }
        });
    }

    // ── SQL GPT Page ─────────────────────────────────────────
    PAGES.sql_gpt = function (c) {
        var SQLGPT_API = '/sql-gpt-api';
        var _tables = [];
        var _currentTable = null;
        var _messages = [];
        var DISPLAY_LIMIT = 100;

        function escHtml(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
        function fmtVal(v) {
            if (v === null || v === undefined) return '<span style="color:#94A3B8">NULL</span>';
            if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
            var s = String(v); return s.length > 100 ? escHtml(s.substring(0, 100)) + '...' : escHtml(s);
        }

        // Build the page layout
        c.innerHTML = '<div class="sqlgpt-layout">' +
            '<div class="sqlgpt-sidebar">' +
                '<div class="sqlgpt-section">' +
                    '<h3 class="sqlgpt-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Data</h3>' +
                    '<div class="sqlgpt-upload-area" id="sqlgpt-upload-area">' +
                        '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>' +
                        '<p style="font-weight:500;margin-top:0.5rem">Click to upload</p>' +
                        '<p style="font-size:0.75rem;color:#94A3B8">CSV, Excel (.xlsx, .xls)</p>' +
                        '<input type="file" id="sqlgpt-file-input" accept=".csv,.xlsx,.xls" style="display:none">' +
                    '</div>' +
                    '<div class="sqlgpt-upload-progress" id="sqlgpt-upload-progress" style="display:none">' +
                        '<div class="sqlgpt-progress-bar"><div class="sqlgpt-progress-fill" id="sqlgpt-progress-fill"></div></div>' +
                        '<p style="font-size:0.8rem;color:#94A3B8;margin-top:0.3rem">Uploading...</p>' +
                    '</div>' +
                '</div>' +
                '<div class="sqlgpt-section">' +
                    '<h3 class="sqlgpt-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg> Tables <span id="sqlgpt-tables-count" style="color:#94A3B8;font-weight:400;font-size:0.75rem;margin-left:auto"></span></h3>' +
                    '<input type="text" id="sqlgpt-table-search" class="sqlgpt-table-search" placeholder="Filter tables...">' +
                    '<div class="sqlgpt-tables-list" id="sqlgpt-tables-list"><p style="color:#94A3B8;font-size:0.8rem;text-align:center;padding:1rem">No tables uploaded yet</p></div>' +
                '</div>' +
                '<div class="sqlgpt-section">' +
                    '<h3 class="sqlgpt-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Current Table</h3>' +
                    '<div id="sqlgpt-current-table"><p style="color:#94A3B8;font-size:0.8rem;text-align:center;padding:1rem">Upload a file to get started</p></div>' +
                '</div>' +
            '</div>' +
            '<div class="sqlgpt-chat-area">' +
                '<div class="sqlgpt-chat-header">' +
                    '<div><h2 style="font-size:1.1rem;font-weight:600;color:var(--text-dark)">Query Interface</h2><span style="font-size:0.8rem;color:#94A3B8">Ask questions in natural language</span></div>' +
                    '<button class="sqlgpt-btn-clear" id="sqlgpt-clear-chat"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Clear</button>' +
                '</div>' +
                '<div class="sqlgpt-messages" id="sqlgpt-messages">' +
                    '<div class="sqlgpt-welcome">' +
                        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" stroke-width="1.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
                        '<h2 style="margin-top:0.75rem;font-size:1.2rem;font-weight:600;color:var(--text-dark)">Analytics GPT</h2>' +
                        '<p style="color:#64748B;margin-top:0.3rem">Upload a data file and ask questions in plain English.</p>' +
                        '<div class="sqlgpt-steps">' +
                            '<div class="sqlgpt-step"><span class="sqlgpt-step-num">1</span><div><strong>Upload</strong><br><span style="color:#94A3B8">CSV or Excel</span></div></div>' +
                            '<div class="sqlgpt-step"><span class="sqlgpt-step-num">2</span><div><strong>Ask</strong><br><span style="color:#94A3B8">Questions in English</span></div></div>' +
                            '<div class="sqlgpt-step"><span class="sqlgpt-step-num">3</span><div><strong>Analyze</strong><br><span style="color:#94A3B8">Results & download</span></div></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="sqlgpt-input-area">' +
                    '<textarea id="sqlgpt-input" class="sqlgpt-input" placeholder="Ask a question about your data..." rows="1" disabled></textarea>' +
                    '<button id="sqlgpt-send" class="sqlgpt-send-btn" disabled><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
                '</div>' +
            '</div>' +
        '</div>';

        // --- DOM refs ---
        var uploadArea = c.querySelector('#sqlgpt-upload-area');
        var fileInput = c.querySelector('#sqlgpt-file-input');
        var uploadProgress = c.querySelector('#sqlgpt-upload-progress');
        var progressFill = c.querySelector('#sqlgpt-progress-fill');
        var tableSearch = c.querySelector('#sqlgpt-table-search');
        var tablesList = c.querySelector('#sqlgpt-tables-list');
        var tablesCount = c.querySelector('#sqlgpt-tables-count');
        var currentTableInfo = c.querySelector('#sqlgpt-current-table');
        var messagesDiv = c.querySelector('#sqlgpt-messages');
        var chatInput = c.querySelector('#sqlgpt-input');
        var sendBtn = c.querySelector('#sqlgpt-send');
        var clearBtn = c.querySelector('#sqlgpt-clear-chat');

        // --- Toast (reuse existing app toast) ---
        function sgToast(msg, type) {
            if (typeof showToast === 'function') showToast(msg, type || 'info');
        }

        // --- Tables rendering ---
        function renderTables() {
            var q = (tableSearch.value || '').toLowerCase().trim();
            var filtered = q ? _tables.filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; }) : _tables;
            tablesCount.textContent = filtered.length + '/' + _tables.length;
            if (!_tables.length) { tablesList.innerHTML = '<p style="color:#94A3B8;font-size:0.8rem;text-align:center;padding:1rem">No tables uploaded yet</p>'; return; }
            if (!filtered.length) { tablesList.innerHTML = '<p style="color:#94A3B8;font-size:0.8rem;text-align:center;padding:1rem">No matching tables</p>'; return; }
            tablesList.innerHTML = filtered.map(function (t) {
                return '<div class="sqlgpt-table-item' + (t.name === _currentTable ? ' active' : '') + '" data-name="' + escHtml(t.name) + '">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center">' +
                        '<span class="sqlgpt-table-name">' + escHtml(t.name) + '</span>' +
                        '<button class="sqlgpt-del-btn" data-del="' + escHtml(t.name) + '" title="Delete">&times;</button>' +
                    '</div>' +
                    '<div style="font-size:0.75rem;color:#94A3B8;margin-top:2px">' + t.row_count + ' rows &middot; ' + t.columns.length + ' cols</div>' +
                '</div>';
            }).join('');
            tablesList.querySelectorAll('.sqlgpt-table-item').forEach(function (item) {
                item.addEventListener('click', function (e) {
                    if (e.target.closest('.sqlgpt-del-btn')) return;
                    selectTable(item.dataset.name);
                });
            });
            tablesList.querySelectorAll('.sqlgpt-del-btn').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (confirm('Delete table "' + btn.dataset.del + '"?')) deleteTable(btn.dataset.del);
                });
            });
        }

        // --- Load tables ---
        async function loadTables() {
            try {
                var resp = await fetch(SQLGPT_API + '/tables');
                if (!resp.ok) throw new Error('Failed');
                var data = await resp.json();
                _tables = data.tables || [];
                renderTables();
                if (_tables.length > 0 && !_currentTable) selectTable(_tables[0].name);
            } catch (e) { console.error('SQL GPT: load tables error', e); }
        }

        // --- Select table ---
        async function selectTable(name) {
            try {
                var resp = await fetch(SQLGPT_API + '/schema/' + encodeURIComponent(name));
                if (!resp.ok) throw new Error('Failed');
                var data = await resp.json();
                _currentTable = name;
                currentTableInfo.innerHTML =
                    '<div class="sqlgpt-info-row"><span class="sqlgpt-info-label">Table</span><span class="sqlgpt-info-val">' + escHtml(data.table_name) + '</span></div>' +
                    '<div class="sqlgpt-info-row"><span class="sqlgpt-info-label">Columns</span><span class="sqlgpt-info-val">' + data.columns.length + '</span></div>' +
                    '<div class="sqlgpt-info-row"><span class="sqlgpt-info-label">Names</span><span class="sqlgpt-info-val" style="font-size:0.8rem">' + data.columns.map(function (col) { return escHtml(col.name); }).join(', ') + '</span></div>';
                renderTables();
                chatInput.disabled = false;
                sendBtn.disabled = false;
                sgToast('Switched to: ' + name, 'success');
            } catch (e) { sgToast('Failed to load table', 'error'); }
        }

        // --- Delete table ---
        async function deleteTable(name) {
            try {
                var resp = await fetch(SQLGPT_API + '/table/' + encodeURIComponent(name), { method: 'DELETE' });
                if (!resp.ok) throw new Error('Failed');
                sgToast('Deleted: ' + name, 'success');
                if (_currentTable === name) {
                    _currentTable = null;
                    currentTableInfo.innerHTML = '<p style="color:#94A3B8;font-size:0.8rem;text-align:center;padding:1rem">Select a table</p>';
                    chatInput.disabled = true;
                    sendBtn.disabled = true;
                }
                await loadTables();
            } catch (e) { sgToast('Delete failed', 'error'); }
        }

        // --- File upload ---
        async function handleUpload(file) {
            var ext = '.' + file.name.split('.').pop().toLowerCase();
            if (['.csv', '.xlsx', '.xls'].indexOf(ext) === -1) { sgToast('Invalid file type', 'error'); return; }
            if (file.size > 50 * 1024 * 1024) { sgToast('File too large (max 50MB)', 'error'); return; }
            uploadArea.style.display = 'none';
            uploadProgress.style.display = 'block';
            var prog = 0;
            var iv = setInterval(function () { prog += Math.random() * 15; if (prog > 90) prog = 90; progressFill.style.width = prog + '%'; }, 200);
            try {
                var fd = new FormData();
                fd.append('file', file);
                var resp = await fetch(SQLGPT_API + '/upload', { method: 'POST', body: fd });
                if (!resp.ok) { var err = await resp.json(); throw new Error(err.detail || 'Upload failed'); }
                var data = await resp.json();
                clearInterval(iv);
                progressFill.style.width = '100%';
                setTimeout(function () { uploadArea.style.display = ''; uploadProgress.style.display = 'none'; }, 400);
                await loadTables();
                selectTable(data.table_name);
                // Hide welcome message
                var wel = messagesDiv.querySelector('.sqlgpt-welcome');
                if (wel) wel.style.display = 'none';
                sgToast('Uploaded: ' + data.table_name, 'success');
            } catch (e) {
                clearInterval(iv);
                uploadArea.style.display = '';
                uploadProgress.style.display = 'none';
                sgToast(e.message, 'error');
            }
        }

        uploadArea.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', function () { if (fileInput.files[0]) { handleUpload(fileInput.files[0]); fileInput.value = ''; } });
        uploadArea.addEventListener('dragover', function (e) { e.preventDefault(); uploadArea.classList.add('dragover'); });
        uploadArea.addEventListener('dragleave', function (e) { e.preventDefault(); uploadArea.classList.remove('dragover'); });
        uploadArea.addEventListener('drop', function (e) { e.preventDefault(); uploadArea.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); });
        tableSearch.addEventListener('input', renderTables);

        // --- Chat ---
        function scrollChat() { setTimeout(function () { messagesDiv.scrollTop = messagesDiv.scrollHeight; }, 80); }

        function addUserMsg(text) {
            var wel = messagesDiv.querySelector('.sqlgpt-welcome');
            if (wel) wel.style.display = 'none';
            var d = document.createElement('div');
            d.className = 'sqlgpt-msg sqlgpt-msg-user';
            d.innerHTML = '<div class="sqlgpt-msg-avatar">U</div><div class="sqlgpt-msg-content">' + escHtml(text) + '</div>';
            messagesDiv.appendChild(d);
            scrollChat();
        }

        function addThinking() {
            var id = 'sqlgpt-think-' + Date.now();
            var d = document.createElement('div');
            d.id = id;
            d.className = 'sqlgpt-msg sqlgpt-msg-assistant';
            d.innerHTML = '<div class="sqlgpt-msg-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="sqlgpt-msg-content"><div class="sqlgpt-thinking"><span></span><span></span><span></span></div></div>';
            messagesDiv.appendChild(d);
            scrollChat();
            return id;
        }

        function removeThinking(id) { var el = document.getElementById(id); if (el) el.remove(); }

        function addResultMsg(result) {
            var d = document.createElement('div');
            d.className = 'sqlgpt-msg sqlgpt-msg-assistant';
            var sqlHtml = '<div class="sqlgpt-sql-label">Generated SQL:</div><pre class="sqlgpt-sql">' + escHtml(result.sql_query) + '</pre>';
            var tblHtml = '';
            if (result.row_count > 0) {
                var cols = Object.keys(result.results[0]);
                var display = result.results.slice(0, DISPLAY_LIMIT);
                var hasMore = result.results.length > DISPLAY_LIMIT;
                tblHtml += '<div class="sqlgpt-results-header"><span>Found ' + result.row_count.toLocaleString() + ' result' + (result.row_count !== 1 ? 's' : '') + (hasMore ? ' (showing ' + DISPLAY_LIMIT + ')' : '') + '</span>';
                tblHtml += '<div style="display:flex;gap:0.4rem"><button class="sqlgpt-dl-btn" data-fmt="csv">CSV</button><button class="sqlgpt-dl-btn" data-fmt="excel">Excel</button></div></div>';
                if (hasMore) tblHtml += '<div style="font-size:0.75rem;color:var(--secondary);margin-bottom:0.5rem">Download the full dataset to view all results.</div>';
                tblHtml += '<div class="sqlgpt-table-wrap"><table class="sqlgpt-result-table"><thead><tr>' + cols.map(function (c) { return '<th>' + escHtml(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
                display.forEach(function (row) {
                    tblHtml += '<tr>' + cols.map(function (c) { return '<td>' + fmtVal(row[c]) + '</td>'; }).join('') + '</tr>';
                });
                tblHtml += '</tbody></table></div>';
            } else {
                tblHtml = '<p style="color:#94A3B8;margin-top:0.5rem">No results found.</p>';
            }
            d.innerHTML = '<div class="sqlgpt-msg-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="sqlgpt-msg-content">' + sqlHtml + tblHtml + '</div>';
            messagesDiv.appendChild(d);
            scrollChat();
            // Download handlers
            d.querySelectorAll('.sqlgpt-dl-btn').forEach(function (btn) {
                btn.addEventListener('click', function () { downloadResults(result.results, btn.dataset.fmt, result.sql_query); });
            });
        }

        function addErrorMsg(text) {
            var d = document.createElement('div');
            d.className = 'sqlgpt-msg sqlgpt-msg-assistant';
            d.innerHTML = '<div class="sqlgpt-msg-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="sqlgpt-msg-content" style="color:#EF4444">' + escHtml(text) + '</div>';
            messagesDiv.appendChild(d);
            scrollChat();
        }

        async function sendQuery() {
            var q = chatInput.value.trim();
            if (!q || !_currentTable) return;
            chatInput.value = '';
            chatInput.style.height = 'auto';
            addUserMsg(q);
            var tid = addThinking();
            try {
                var resp = await fetch(SQLGPT_API + '/query', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: q, table_name: _currentTable })
                });
                removeThinking(tid);
                if (!resp.ok) { var err = await resp.json(); throw new Error(err.detail || 'Query failed'); }
                var data = await resp.json();
                addResultMsg(data);
            } catch (e) {
                removeThinking(tid);
                addErrorMsg('Error: ' + e.message);
            }
        }

        // --- Download ---
        function downloadResults(data, fmt, sqlQuery) {
            if (fmt === 'csv') {
                var cols = Object.keys(data[0]);
                var csv = [cols.join(',')].concat(data.map(function (row) {
                    return cols.map(function (c) { var v = row[c]; if (v == null) v = ''; v = String(v); if (v.indexOf(',') !== -1 || v.indexOf('"') !== -1 || v.indexOf('\n') !== -1) v = '"' + v.replace(/"/g, '""') + '"'; return v; }).join(',');
                })).join('\n');
                var blob = new Blob([csv], { type: 'text/csv' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'query_results_' + Date.now() + '.csv';
                a.click();
                URL.revokeObjectURL(a.href);
                sgToast('Downloaded CSV', 'success');
            } else {
                fetch(SQLGPT_API + '/download/excel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: data.length > 100 && sqlQuery ? undefined : data, sql_query: data.length > 100 && sqlQuery ? sqlQuery : undefined, table_name: data.length > 100 ? _currentTable : undefined, filename: 'query_results_' + Date.now() })
                }).then(function (r) { return r.blob(); }).then(function (blob) {
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'query_results_' + Date.now() + '.xlsx';
                    a.click();
                    URL.revokeObjectURL(a.href);
                    sgToast('Downloaded Excel', 'success');
                }).catch(function () { sgToast('Download failed', 'error'); });
            }
        }

        // --- Input events ---
        sendBtn.addEventListener('click', sendQuery);
        chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); }
        });
        chatInput.addEventListener('input', function () {
            chatInput.style.height = 'auto';
            chatInput.style.height = chatInput.scrollHeight + 'px';
        });
        clearBtn.addEventListener('click', function () {
            messagesDiv.innerHTML = '<div class="sqlgpt-welcome"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" stroke-width="1.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><h2 style="margin-top:0.75rem;font-size:1.2rem;font-weight:600;color:var(--text-dark)">Analytics GPT</h2><p style="color:#64748B;margin-top:0.3rem">Upload a data file and ask questions in plain English.</p></div>';
            _messages = [];
            sgToast('Chat cleared', 'success');
        });

        // --- Init ---
        loadTables();
    };

    // ── Reviewer Dashboard ────────────────────────────────────
    PAGES.reviewer_dashboard = async function (c) {
        c.innerHTML = spinner();
        let assignments;
        try { const resp = await apiJSON('/api/assignments?assigned_to=' + S.user.id); assignments = resp && resp.assignments ? resp.assignments : []; } catch (e) { c.innerHTML = '<div class="alert alert-error">Failed to load assignments</div>'; return; }
        if (!assignments) assignments = [];

        const total = assignments.length;
        const pending = assignments.filter(function (a) { return a.status === 'Pending'; }).length;
        const inReview = assignments.filter(function (a) { return a.status === 'In Review'; }).length;
        const resolved = assignments.filter(function (a) { return a.status === 'Resolved'; }).length;
        const unread = assignments.filter(function (a) { return !a.is_read; }).length;

        let h = '<div class="page-header"><h1>Reviewer Dashboard</h1><p class="page-desc">Welcome, <strong>' + esc((S.user.display_name || '').trim()) + '</strong>. Your breach scenario assignments are below.</p></div>';
        h += kpiRow([
            { label: 'Total Assigned', value: total },
            { label: 'New', value: unread },
            { label: 'Pending', value: pending },
            { label: 'In Review', value: inReview },
            { label: 'Resolved', value: resolved },
        ]);
        h += '<hr>';

        if (total === 0) {
            h += '<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-title">No assignments yet</div><div class="empty-desc">Your admin will assign breach scenarios to you.</div></div>';
            c.innerHTML = h;
            return;
        }

        h += '<div class="form-group" style="max-width:250px"><label>Filter by Status</label><select id="rv-status"><option>All</option><option>Pending</option><option>In Review</option><option>Resolved</option></select></div>';
        h += '<div id="rv-list"></div>';
        c.innerHTML = h;

        function renderList() {
            const statusF = $('#rv-status', c).value;
            let filtered = assignments;
            if (statusF !== 'All') filtered = filtered.filter(function (a) { return a.status === statusF; });

            const list = $('#rv-list', c);
            list.innerHTML = '';
            if (filtered.length === 0) {
                list.innerHTML = '<div class="alert alert-info">No assignments with status "' + statusF + '".</div>';
                return;
            }

            filtered.forEach(function (asgn) {
                const card = el('div', { className: 'assignment-card' });
                const badgeCls = asgn.status === 'Pending' ? 'badge-pending' : asgn.status === 'In Review' ? 'badge-in-review' : 'badge-resolved';
                const newTag = !asgn.is_read ? ' <span class="badge badge-new">NEW</span>' : '';
                const isExpanded = asgn.status !== 'Resolved';

                const header = el('div', { className: 'assignment-card-header' });
                header.innerHTML = '<span class="card-title">#' + asgn.id + ' &mdash; ' + esc(asgn.scenario_name) + '</span><span class="badge ' + badgeCls + '">' + asgn.status + '</span>' + newTag;

                const body = el('div', { className: 'assignment-card-body' + (isExpanded ? ' open' : '') });
                header.addEventListener('click', function () {
                    body.classList.toggle('open');
                    if (body.classList.contains('open') && body.children.length === 0) renderReviewerCard(body, asgn);
                });

                card.appendChild(header);
                card.appendChild(body);
                list.appendChild(card);

                if (isExpanded) renderReviewerCard(body, asgn);

                // Mark as read
                if (!asgn.is_read) {
                    api('/api/assignments/' + asgn.id + '/read', { method: 'PUT' }).catch(function () {});
                    asgn.is_read = true;
                }
            });
        }

        async function renderReviewerCard(body, asgn) {
            const rulesData = S.rules || {};
            const rulesArr2 = rulesData.rules || [];
            const ruleInfo = rulesArr2.find(function (r) { return r.scenario === asgn.scenario_name; }) || {};

            let bh = '';
            // Rule info
            if (ruleInfo.description) {
                bh += '<div class="alert alert-info"><strong>Rule:</strong> ' + esc(ruleInfo.description) + ' | <strong>Status:</strong> ' + esc(ruleInfo.status || 'N/A');
                if (ruleInfo.thresholds) {
                    bh += ' | <strong>Thresholds:</strong> ' + esc(ruleInfo.thresholds);
                }
                bh += '</div>';
            }

            bh += '<div class="detail-grid">';
            bh += '<div><span class="detail-label">Scenario:</span> ' + esc(asgn.scenario_name || '') + '</div>';
            bh += '<div><span class="detail-label">Category:</span> ' + esc(asgn.category || '') + '</div>';
            bh += '<div><span class="detail-label">Records:</span> ' + (asgn.breach_count || 0) + '</div>';
            bh += '<div><span class="detail-label">Assigned by:</span> ' + esc((asgn.assigner_name || '').trim()) + '</div>';
            bh += '<div><span class="detail-label">Created:</span> ' + esc(asgn.created_at || '') + '</div>';
            bh += '<div><span class="detail-label">Updated:</span> ' + esc(asgn.updated_at || '') + '</div>';
            if (asgn.notes) bh += '<div style="grid-column:1/-1"><span class="detail-label">Notes:</span> ' + esc(asgn.notes) + '</div>';
            bh += '</div>';

            // Status update
            bh += '<hr><div class="flex gap-2 items-center"><strong>Update Status:</strong><select id="rv-st-' + asgn.id + '" style="width:auto"><option ' + (asgn.status === 'Pending' ? 'selected' : '') + '>Pending</option><option ' + (asgn.status === 'In Review' ? 'selected' : '') + '>In Review</option><option ' + (asgn.status === 'Resolved' ? 'selected' : '') + '>Resolved</option></select>';
            bh += '<button class="btn btn-sm btn-primary" id="rv-upd-' + asgn.id + '">Update</button></div>';

            // Docs
            bh += '<hr><div id="rv-docs-' + asgn.id + '"><strong>Documents:</strong> Loading...</div>';
            bh += '<div class="mt-1"><label class="text-small text-bold">Upload document:</label><input type="file" id="rv-file-' + asgn.id + '" style="font-size:0.8rem" accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.docx"><button class="btn btn-sm btn-secondary mt-1" id="rv-upload-' + asgn.id + '">Save Document</button></div>';

            // Comments
            bh += '<hr><div id="rv-comments-' + asgn.id + '"><strong>Comments:</strong> Loading...</div>';
            body.innerHTML = bh;

            // Wire status update
            $('#rv-upd-' + asgn.id, body).addEventListener('click', async function () {
                const newStatus = $('#rv-st-' + asgn.id, body).value;
                try {
                    await apiJSON('/api/assignments/' + asgn.id + '/status', { method: 'PUT', body: { status: newStatus } });
                    showToast('Status updated to ' + newStatus, 'success');
                    asgn.status = newStatus;
                } catch (e) { showToast('Failed to update', 'error'); }
            });

            // Wire doc upload
            $('#rv-upload-' + asgn.id, body).addEventListener('click', async function () {
                const fileInput = $('#rv-file-' + asgn.id, body);
                if (!fileInput.files.length) { showToast('Select a file first', 'error'); return; }
                const fd = new FormData();
                fd.append('file', fileInput.files[0]);
                try {
                    await apiJSON('/api/assignments/' + asgn.id + '/documents', { method: 'POST', body: fd });
                    showToast('Document saved!', 'success');
                    loadRevDocs(asgn.id, body);
                } catch (e) { showToast('Failed to upload document', 'error'); }
            });

            // Load docs & comments
            loadRevDocs(asgn.id, body);
            loadRevComments(asgn.id, body);
        }

        async function loadRevDocs(asgnId, body) {
            const docsDiv = $('#rv-docs-' + asgnId, body);
            try {
                const docsResp = await apiJSON('/api/assignments/' + asgnId + '/documents');
                const docs = docsResp && docsResp.documents ? docsResp.documents : [];
                let dh = '<strong>Documents:</strong>';
                if (docs.length > 0) {
                    docs.forEach(function (doc) {
                        dh += '<div class="doc-item"><div><span class="doc-info">' + esc(doc.filename) + '</span><span class="doc-meta"> (' + fmtNum(doc.file_size) + ' bytes) &mdash; ' + esc(doc.display_name || '') + ' on ' + esc(doc.created_at || '') + '</span></div>';
                        dh += '<button class="btn btn-sm btn-secondary rv-dl-doc" data-doc-id="' + doc.id + '" data-filename="' + esc(doc.filename) + '">Download</button></div>';
                    });
                } else {
                    dh += '<p class="text-muted text-small">No documents yet.</p>';
                }
                docsDiv.innerHTML = dh;
                $$('.rv-dl-doc', docsDiv).forEach(function (btn) {
                    btn.addEventListener('click', function () { downloadFile('/api/documents/' + btn.dataset.docId + '/download', btn.dataset.filename); });
                });
            } catch (e) { docsDiv.innerHTML = '<strong>Documents:</strong> <span class="text-muted">Failed to load</span>'; }
        }

        async function loadRevComments(asgnId, body) {
            const commDiv = $('#rv-comments-' + asgnId, body);
            try {
                const commResp = await apiJSON('/api/assignments/' + asgnId + '/comments');
                const comments = commResp && commResp.comments ? commResp.comments : [];
                let ch = '<strong>Comments:</strong><div class="comment-thread">';
                if (comments.length > 0) {
                    comments.forEach(function (cmt) {
                        ch += '<div class="comment-item"><span class="comment-author">' + esc((cmt.display_name || '').trim()) + '</span><span class="comment-date">' + esc(cmt.created_at || '') + '</span><div class="comment-text">' + esc(cmt.comment_text || '') + '</div></div>';
                    });
                } else {
                    ch += '<p class="text-muted text-small">No comments yet.</p>';
                }
                ch += '</div><div class="comment-input-row"><input type="text" id="rv-cmt-inp-' + asgnId + '" placeholder="Add a comment..."><button class="btn btn-sm btn-primary" id="rv-cmt-btn-' + asgnId + '">Post</button></div>';
                commDiv.innerHTML = ch;

                $('#rv-cmt-btn-' + asgnId, body).addEventListener('click', async function () {
                    const input = $('#rv-cmt-inp-' + asgnId, body);
                    const text = input.value.trim();
                    if (!text) return;
                    try {
                        await apiJSON('/api/assignments/' + asgnId + '/comments', { method: 'POST', body: { text: text } });
                        input.value = '';
                        showToast('Comment posted', 'success');
                        loadRevComments(asgnId, body);
                    } catch (e) { showToast('Failed to post', 'error'); }
                });
            } catch (e) { commDiv.innerHTML = '<strong>Comments:</strong> <span class="text-muted">Failed to load</span>'; }
        }

        renderList();
        $('#rv-status', c).addEventListener('change', renderList);
    };

    // ══════════════════════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════════════════════
    async function init() {
        // Ensure any previously persisted tokens are cleared so sessions never persist across launches
        try { localStorage.removeItem('aim_token'); } catch (e) { /* ignore */ }
        const authed = await checkAuth();
        render();
    }

    // Start the app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
