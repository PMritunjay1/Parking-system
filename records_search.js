const API_BASE_URL = 'http://127.0.0.1:8000';
dayjs.extend(window.dayjs_plugin_utc);
dayjs.extend(window.dayjs_plugin_timezone);
async function fetchWithAuth(endpoint, options = {}) {
    const token = localStorage.getItem('accessToken');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
    if (!response.ok) {
        if (response.status === 401) window.location.href = './index.html';
        const error = await response.json();
        throw new Error(error.detail || `API request failed with status ${response.status}`);
    }
    return response.json();
}
document.documentElement.style.setProperty('--font-sans', "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'");
const state = {
    raw: [],
    filtered: [],
    query: '',
    searchBy: 'vehicle',
    status: 'ALL',
    page: 1,
    perPage: 6,
    sortKey: 'entry',
    sortDir: 'desc',
    isSearching: false
};

const resultsBody = document.getElementById('resultsBody');
const totalCountBadge = document.getElementById('totalCountBadge');
const loadingOverlay = document.getElementById('loadingOverlay');
const paginationInfo = document.getElementById('paginationInfo');
const pagination = document.getElementById('pagination');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');

const fmtDate = (iso) => {
    if (!iso) return '—';
    return dayjs.utc(iso).tz('Asia/Kolkata').format('MMM D, YYYY, h:mm A');
};
const fmtDur = (h) => `${h.toFixed(1)}h`;
const fmtAmt = (n) => (n ? `₹${n.toFixed(2)}` : '₹0.00');

const badgeFor = (status) => {
    const map = {
        ACTIVE: 'warning',
        EXPIRED: 'error',
        CLOSED: 'success'
    };
    const label = status.charAt(0) + status.slice(1).toLowerCase();
    return `<span class="badge-soft ${map[status] || 'primary'}"><span class="status-dot ${status === 'ACTIVE' ? 'warning' : status === 'EXPIRED' ? 'error' : status === 'CLOSED' ? 'success' : 'info'}"></span> ${label}</span>`;
};
// Renderers
function renderRows(rows) {
    if (!rows.length) {
        resultsBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">No records found. Please refine your search criteria.</td></tr>`;
        return;
    }
    resultsBody.innerHTML = rows.map(r => {
        const actionBtn = r.status === 'ACTIVE' ?
            `<button class="btn btn-sm btn-success assist-btn" data-ticket="${r.ticket}"><i class="fa-solid fa-life-ring me-1"></i> Assist Exit</button>` :
            `<button class="btn btn-sm btn-light view-btn" data-ticket="${r.ticket}"><i class="fa-regular fa-eye me-1"></i> View Details</button>`;
        return `
          <tr>
            <td><code>${r.ticket}</code></td>
            <td>${r.vehicle}</td>
            <td>${r.spot}</td>
            <td>${fmtDate(r.entry)}</td>
            <td>${fmtDate(r.exit)}</td>
            <td>${fmtDur(r.durationH)}</td>
            <td>${fmtAmt(r.amount)}</td>
            <td>${badgeFor(r.status)}</td>
            <td class="text-end">
              <div class="btn-group">
                ${actionBtn}
                <button class="btn btn-sm btn-outline-secondary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false">
                  <span class="visually-hidden">Toggle actions</span>
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li><a class="dropdown-item copy-id" href="#" data-ticket="${r.ticket}"><i class="fa-regular fa-copy me-2"></i>Copy Ticket ID</a></li>
                  <li><a class="dropdown-item" href="#" data-ticket="${r.ticket}"><i class="fa-solid fa-receipt me-2"></i>Print Receipt</a></li>
                </ul>
              </div>
            </td>
          </tr>`;
    }).join('');
}

function render() {
    const start = (state.page - 1) * state.perPage;
    const end = start + state.perPage;
    const pageRows = state.filtered.slice(start, end);
    renderRows(pageRows);
    totalCountBadge.textContent = state.filtered.length;
    const from = state.filtered.length ? start + 1 : 0;
    const to = Math.min(end, state.filtered.length);
    paginationInfo.textContent = `Showing ${from} to ${to} of ${state.filtered.length}`;
    renderPagination();
}

function renderPagination() {
    [...pagination.querySelectorAll('li.page-number')].forEach(el => el.remove());
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.perPage));
    prevPageBtn.disabled = state.page <= 1;
    nextPageBtn.disabled = state.page >= totalPages;
    prevPageBtn.onclick = () => {
        if (state.page > 1) {
            state.page--;
            render();
        }
    };
    nextPageBtn.onclick = () => {
        if (state.page < totalPages) {
            state.page++;
            render();
        }
    };
    // Insert number buttons
    const insertBefore = nextPageBtn.parentElement;
    for (let i = 1; i <= totalPages; i++) {
        const li = document.createElement('li');
        li.className = 'page-item page-number' + (i === state.page ? ' active' : '');
        const btn = document.createElement('button');
        btn.className = 'page-link';
        btn.textContent = i;
        btn.onclick = () => {
            state.page = i;
            render();
        };
        li.appendChild(btn);
        pagination.insertBefore(li, insertBefore);
    }
}

function sortData() {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    state.filtered.sort((a, b) => {
        const va = (a[key] ?? '').toString();
        const vb = (b[key] ?? '').toString();
        if (key === 'amount' || key === 'durationH') return (a[key] - b[key]) * dir;
        if (key === 'entry' || key === 'exit') return ((a[key] ? new Date(a[key]).getTime() : 0) - (b[key] ? new Date(b[key]).getTime() : 0)) * dir;
        return va.localeCompare(vb) * dir;
    });
}

async function performSearch() {
    state.isSearching = true;
    loadingOverlay.classList.remove('d-none');
    document.getElementById('searchBtn').disabled = true;

    const params = new URLSearchParams();
    if (state.status !== 'ALL') {
        params.set('status', state.status.toLowerCase());
    }
    const searchByMap = { 'vehicle': 'vehicle_number', 'ticket': 'ticket_id', 'spot': 'spot_id' };
    if (state.query) {
        params.set(searchByMap[state.searchBy], state.query);
    }

    try {
        const results = await fetchWithAuth(`/admin/tickets?${params.toString()}`);

        state.raw = results.map(t => {
            const entryUtc = dayjs.utc(t.entry_time);
            const endUtc = t.exit_time ? dayjs.utc(t.exit_time) : dayjs.utc();
            const durationMs = endUtc.diff(entryUtc);
            return {
                ticket: t.ticket_id,
                vehicle: t.vehicle_number,
                spot: t.spot_number,
                entry: t.entry_time,
                exit: t.exit_time,
                durationH: durationMs / 3600000,
                amount: t.total_amount || 0,
                status: t.status.toUpperCase()
            };
        });

        state.filtered = state.raw;
        sortData();
        state.page = 1;
        render();

    } catch (error) {
        console.error("Search failed:", error);
        Swal.fire({ icon: 'error', title: 'Search Failed', text: error.message });
        resultsBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-danger">Error loading data.</td></tr>`;
    } finally {
        state.isSearching = false;
        loadingOverlay.classList.add('d-none');
        document.getElementById('searchBtn').disabled = false;
    }
}
document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.query = document.getElementById('queryInput').value;
    state.searchBy = document.getElementById('searchBy').value;
    state.status = document.getElementById('statusFilter').value;
    performSearch();
});

document.getElementById('itemsPerPage').addEventListener('change', (e) => {
    state.perPage = parseInt(e.target.value, 10) || 6;
    state.page = 1;
    render();
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    simulateSearch(render);
});

document.querySelectorAll('#resultsTable thead th.sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
        const keyMap = {
            ticket: 'ticket',
            vehicle: 'vehicle',
            spot: 'spot',
            entry: 'entry',
            exit: 'exit',
            duration: 'durationH',
            amount: 'amount'
        };
        const key = keyMap[th.dataset.sort];
        if (state.sortKey === key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortKey = key;
            state.sortDir = 'asc';
        }

        sortData();
        render();

        document.querySelectorAll('#resultsTable thead th.sortable i').forEach(i => i.className = 'fa-solid fa-sort ms-1 text-muted');
        const icon = th.querySelector('i');
        icon.className = 'fa-solid ' + (state.sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') + ' ms-1 text-primary';
    });
});
document.getElementById('resultsTable').addEventListener('click', (e) => {
    const assistBtn = e.target.closest('.assist-btn');
    const viewBtn = e.target.closest('.view-btn');
    const copyId = e.target.closest('.copy-id');

    if (assistBtn) {
        const ticketId = assistBtn.dataset.ticket;
        const rec = state.raw.find(r => r.ticket == ticketId);
        if (!rec) return;
        Swal.fire({
            title: `Assist Exit — ${rec.vehicle}`,
            html: `<div class="text-start">
                            <p>Confirm assisted exit for ticket <strong>#${rec.ticket}</strong>. This is for lost tickets or system errors.</p>
                            <div class="mb-2"><strong>Select Payment Method</strong></div>
                            <div class="d-grid gap-2 text-start" id="payMethods">
                                <label class="d-flex align-items-center gap-2"><input type="radio" name="pay" value="Cash" checked> Cash</label>
                                <label class="d-flex align-items-center gap-2"><input type="radio" name="pay" value="Card"> Card</label>
                                <label class="d-flex align-items-center gap-2"><input type="radio" name="pay" value="UPI"> UPI</label>
                            </div>
                            </div>`,
            showCancelButton: true,
            confirmButtonText: 'Confirm Payment & Exit',
            confirmButtonColor: '#194542',
            preConfirm: () => document.querySelector('input[name="pay"]:checked').value
        }).then(async (result) => {
            if (result.isConfirmed) {
                Swal.fire({ title: 'Processing...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

                try {
                    const requestBody = {
                        vehicle_number: rec.vehicle,
                        exit_reason: "LOST_TICKET",
                        payment_method: result.value,
                        amount_paid: 50.00,
                        processed_by_user_id: 1
                    };
                    const exitResult = await fetchWithAuth('/admin/exit/assisted', {
                        method: 'POST',
                        body: JSON.stringify(requestBody)
                    });
                    Swal.fire({ icon: 'success', title: 'Exit Processed', text: exitResult.message });
                    performSearch();
                } catch (error) {
                    Swal.fire({ icon: 'error', title: 'Action Failed', text: error.message });
                }
            }
        });
    }
    if (viewBtn) {
        const id = viewBtn.dataset.ticket;
        const rec = state.raw.find(r => r.ticket === id);
        if (!rec) return;
        Swal.fire({
            title: `Ticket ${rec.ticket}`,
            html: `<div class="text-start">
                            <div><strong>Vehicle:</strong> ${rec.vehicle}</div>
                            <div><strong>Spot:</strong> ${rec.spot}</div>
                            <div><strong>Entry:</strong> ${fmtDate(rec.entry)}</div>
                            <div><strong>Exit:</strong> ${fmtDate(rec.exit)}</div>
                            <div><strong>Duration:</strong> ${fmtDur(rec.durationH)}</div>
                            <div><strong>Status:</strong> ${rec.status}</div>
                            <div><strong>Amount:</strong> ${fmtAmt(rec.amount)}</div>
                            </div>`,
            confirmButtonText: 'Close'
        });
    }
    if (copyId) {
        e.preventDefault();
        const id = copyId.dataset.ticket;
        navigator.clipboard.writeText(id).then(() => {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'Ticket ID copied',
                showConfirmButton: false,
                timer: 1500
            });
        });
    }
});

const barrierHandler = () => {
    Swal.fire({
        title: 'Open Barrier',
        text: 'Confirm remote barrier open? Ensure lane is clear.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Open',
        confirmButtonColor: '#194542'
    }).then(res => {
        if (res.isConfirmed) {
            Swal.showLoading();
            setTimeout(() => {
                Swal.fire({
                    icon: 'success',
                    title: 'Barrier opened',
                    timer: 1500,
                    showConfirmButton: false
                });
            }, 800);
        }
    });
};
document.getElementById('openBarrierBtn').addEventListener('click', barrierHandler);

document.getElementById('quickAssistBtn').addEventListener('click', (e) => {
    e.preventDefault();
    Swal.fire({
        icon: 'info',
        title: 'Assisted Exit',
        text: 'Search and select an ACTIVE ticket, then click "Assist Exit" to proceed.'
    });
});
// Initial load
render();
document.addEventListener('DOMContentLoaded', function () {
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', function () {

            Swal.fire({
                icon: 'success',
                title: 'Message Sent!',
                text: 'Thank you for contacting us. We will get back to you shortly.',
                timer: 2500,
                showConfirmButton: false
            });

            const contactModal = document.getElementById('contactModal');
            const modal = bootstrap.Modal.getInstance(contactModal);
            if (modal) {
                modal.hide();
            }
        });
    }
});
document.addEventListener('DOMContentLoaded', () => {
    const getAuthToken = () => {
        return localStorage.getItem('accessToken');
    };
    const fetchAndRenderCharts = async () => {
        try {
            const data = await fetchWithAuth('/admin/dashboard/trends');
            renderTrendCharts(data.labels, data.entries_data, data.exits_data);

        } catch (error) {
            console.error('Failed to fetch dashboard trends:', error);
            const errorMsg = '<p class="text-center text-danger">Could not load chart data (Authorization Failed).</p>';
            document.getElementById('entriesChart').parentElement.innerHTML = errorMsg;
            document.getElementById('exitsChart').parentElement.innerHTML = errorMsg;
        }
    };
    const renderTrendCharts = (labels, entriesData, exitsData) => {
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            elements: {
                line: {
                    tension: 0.3
                }
            }
        };

        // Render Entries Chart
        const entriesCtx = document.getElementById('entriesChart').getContext('2d');
        new Chart(entriesCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Entries',
                    data: entriesData,
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    fill: true,
                    borderWidth: 2
                }]
            },
            options: chartOptions
        });

        // Render Exits Chart
        const exitsCtx = document.getElementById('exitsChart').getContext('2d');
        new Chart(exitsCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Exits',
                    data: exitsData,
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    fill: true,
                    borderWidth: 2
                }]
            },
            options: chartOptions
        });
    };
    fetchAndRenderCharts();
});
document.addEventListener('DOMContentLoaded', function () {
    const logoutButton = document.getElementById('logoutButton');

    if (logoutButton) {
        logoutButton.addEventListener('click', function (event) {
            event.preventDefault();
            localStorage.removeItem('accessToken');
            alert('You have been successfully logged out.');
            window.location.href = './index.html';
        });
    }
});