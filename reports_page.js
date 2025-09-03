const API_BASE_URL = 'http://127.0.0.1:8000';
async function fetchWithAuth(endpoint, options = {}) {
    const token = localStorage.getItem('accessToken');

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

    if (!response.ok) {
        if (response.status === 401) { // Unauthorized
            window.location.href = './index.html'; // Redirect to login
        }
        const error = new Error(`API request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return response.json();
}
// State
const state = {
    selectedReportType: '',
    selectedWeek: null, // { start: Date, end: Date }
    isLoading: false,
    isReportGenerated: false,
    reportData: null,
    chart: null,
    table: {
        columns: [],
        rows: [],
        filteredRows: [],
        sortKey: '',
        sortDir: 'asc',
        page: 1,
        rowsPerPage: 10
    }
};

// Elements
const el = {
    reportType: document.getElementById('reportType'),
    weekPicker: document.getElementById('weekPicker'),
    btnGenerate: document.getElementById('btnGenerate'),
    btnReset: document.getElementById('btnReset'),
    genSpinner: document.getElementById('genSpinner'),
    emptyState: document.getElementById('emptyState'),
    loadingState: document.getElementById('loadingState'),
    reportContent: document.getElementById('reportContent'),
    reportTitle: document.getElementById('reportTitle'),
    reportSubtitle: document.getElementById('reportSubtitle'),
    badgeWeek: document.getElementById('badgeWeek'),
    badgeType: document.getElementById('badgeType'),
    btnExport: document.getElementById('btnExport'),
    btnHeaderExport: document.getElementById('btnHeaderExport'),
    chartTitle: document.getElementById('chartTitle'),
    chartSubtitle: document.getElementById('chartSubtitle'),
    metricsRow: document.getElementById('metricsRow'),
    reportChart: document.getElementById('reportChart'),
    tableHead: document.getElementById('tableHead'),
    tableBody: document.getElementById('tableBody'),
    tableSearch: document.getElementById('tableSearch'),
    rowsPerPage: document.getElementById('rowsPerPage'),
    paginationInfo: document.getElementById('paginationInfo'),
    pagination: document.getElementById('pagination'),
    toastArea: document.getElementById('toastArea')
};

// Flatpickr week picker configuration (past weeks only)
const fp = flatpickr(el.weekPicker, {
    altInput: true,
    altFormat: 'M j, Y',
    dateFormat: 'Y-m-d',
    maxDate: new Date(),
    plugins: [new weekSelect({})],
    onChange: (selectedDates) => {
        if (selectedDates && selectedDates.length) {
            const dt = selectedDates[0];
            const range = getWeekRange(dt);
            state.selectedWeek = range;
        } else {
            state.selectedWeek = null;
        }
        validateFilters();
    }
});

// Quick-week from header dropdown
document.querySelectorAll('.js-quick-week').forEach(item => {
    item.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-range');
        const today = new Date();
        let ref = new Date(today);
        if (val === 'last') {
            ref.setDate(ref.getDate() - 7);
        }
        const range = getWeekRange(ref);
        // Set flatpickr to date inside the desired week
        fp.setDate(range.start, true);
    });
});

// Filter event handlers
el.reportType.addEventListener('change', () => {
    state.selectedReportType = el.reportType.value;
    validateFilters();
});

el.btnReset.addEventListener('click', () => {
    el.reportType.value = '';
    state.selectedReportType = '';
    fp.clear();
    state.selectedWeek = null;
    validateFilters();
});

el.btnGenerate.addEventListener('click', async () => {
    if (!state.selectedReportType || !state.selectedWeek) {
        Swal.fire({
            icon: 'warning',
            title: 'Incomplete filters',
            text: 'Please select both report type and week.'
        });
        return;
    }
    try {
        setLoading(true);
        const data = await fetchReportData(state.selectedReportType, state.selectedWeek);
        state.reportData = data;
        renderReport();
        setLoading(false);
        state.isReportGenerated = true;
        el.btnExport.disabled = false;
        showToast('Report generated successfully');
    } catch (err) {
        setLoading(false);
        console.error(err);

        // Check if the error status is 401 (Unauthorized) or 403 (Forbidden)
        if (err.status === 401 || err.status === 403) {
            Swal.fire({
                icon: 'error',
                title: 'Unauthorised Access',
                text: 'Login with an admin ID to generate this report.'
            });
        } else {
            // For all other errors (like server down), show the generic message
            Swal.fire({
                icon: 'error',
                title: 'Failed to generate',
                text: 'An error occurred while generating the report. Please try again.'
            });
        }
    }
});

// Export handlers (header, in-card, footer)
[el.btnExport, el.btnHeaderExport].forEach(btn => {
    btn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!state.isReportGenerated) {
            Swal.fire({
                icon: 'info',
                title: 'No report yet',
                text: 'Generate a report first to export.'
            });
            return;
        }
        exportPDF();
    });
});

// Table interactions
el.tableSearch.addEventListener('input', () => {
    applyTableFilter(el.tableSearch.value.trim());
});
el.rowsPerPage.addEventListener('change', () => {
    state.table.rowsPerPage = parseInt(el.rowsPerPage.value, 10);
    state.table.page = 1;
    renderTable();
});

// Utilities
function validateFilters() {
    const ok = !!state.selectedReportType && !!state.selectedWeek;
    el.btnGenerate.disabled = !ok;
}

function setLoading(flag) {
    state.isLoading = flag;
    el.btnGenerate.disabled = flag || !state.selectedReportType || !state.selectedWeek;
    el.genSpinner.classList.toggle('d-none', !flag);
    el.loadingState.classList.toggle('d-none', !flag);

    // Only hide content when loading starts. Let renderReport show it.
    if (flag) {
        el.reportContent.classList.add('d-none');
        el.emptyState.classList.add('d-none');
    }
}

function getWeekRange(date) {
    // Calculate Monday-Sunday range for the given date
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
    const diffToMonday = (day === 0 ? -6 : 1) - day; // shift to Monday
    const start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return {
        start,
        end
    };
}

function formatDate(d) {
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatCurrency(num) {
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'INR'
    }).format(num);
}

function formatPercent(num) {
    return `${(num).toFixed(0)}%`;
}

function showToast(message) {
    el.toastArea.querySelector('.toast-body').textContent = message;
    const t = new bootstrap.Toast(el.toastArea, {
        delay: 2500
    });
    t.show();
}

async function fetchReportData(type, { start, end }) {
    const params = new URLSearchParams({
        start_date: start.toISOString(),
        end_date: end.toISOString()
    });

    if (type === 'Weekly Revenue') {
        // Call the revenue report endpoint
        const apiData = await fetchWithAuth(`/admin/reports/revenue?${params.toString()}`);
        return transformRevenueData(apiData);
    }

    if (type === 'Weekly Occupancy') {
        // Call the occupancy report endpoint
        const apiData = await fetchWithAuth(`/admin/reports/occupancy?${params.toString()}`);
        return transformOccupancyData(apiData);
    }

    // Fallback for unknown report types
    throw new Error(`Unknown report type: ${type}`);
}

function transformRevenueData(apiData) {
    // This function converts the API response into the format the frontend needs
    return {
        type: 'Weekly Revenue',
        start: new Date(apiData.report_period.start_date),
        end: new Date(apiData.report_period.end_date),
        revenueFromPenalties: apiData.revenue_from_penalties,
        summary: {
            totalRevenue: apiData.total_revenue,
            totalTransactions: apiData.total_transactions, // Get data from API
            averageTicket: apiData.average_ticket,         // Get data from API
            lotsCount: Object.keys(apiData.revenue_by_lot).length
        },
        chart: {
            labels: Object.keys(apiData.revenue_by_lot),
            datasets: [{
                label: 'Revenue by Lot (₹)',
                data: Object.values(apiData.revenue_by_lot),
                backgroundColor: 'rgba(0,153,210,0.35)',
                borderColor: 'rgba(0,153,210,1)',
                borderWidth: 2
            }]
        },
        table: {
            columns: [
                { key: 'method', label: 'Payment Method', type: 'text' },
                { key: 'revenue', label: 'Revenue', type: 'currency' }
            ],
            rows: Object.entries(apiData.revenue_by_payment_method).map(([method, revenue]) => ({ method, revenue }))
        }
    };
}


function transformOccupancyData(apiData) {
    // This function converts the API response into the format the frontend needs
    return {
        type: 'Weekly Occupancy',
        start: new Date(apiData.report_period.start_date),
        end: new Date(apiData.report_period.end_date),
        summary: {
            avgOccupancy: 0, // Placeholder, as this requires more complex calculation
            peakOccupancy: Math.max(...Object.values(apiData.peak_hours_data)), // Peak is the max count in any hour
            lotsCount: Object.keys(apiData.occupancy_by_lot).length,
            daysCount: 7 // Assuming weekly
        },
        chart: {
            labels: Object.keys(apiData.peak_hours_data).map(hour => `${hour}:00`),
            datasets: [{
                label: 'Peak Hour Vehicle Count',
                data: Object.values(apiData.peak_hours_data),
                backgroundColor: 'rgba(0,119,78,0.25)',
                borderColor: 'rgba(0,119,78,1)',
                borderWidth: 2,
                tension: 0.25,
                fill: true
            }]
        },
        table: {
            columns: [
                { key: 'type', label: 'Vehicle Type', type: 'text' },
                { key: 'duration', label: 'Avg. Duration (mins)', type: 'number' }
            ],
            rows: Object.entries(apiData.average_duration_by_vehicle_type).map(([type, duration]) => ({ type, duration }))
        }
    };
}

function renderReport() {
    const d = state.reportData;
    // Titles and badges
    const title = `${d.type} Report: ${formatDate(d.start)} - ${formatDate(d.end)}`;
    el.reportTitle.textContent = title;
    el.reportSubtitle.textContent = 'Generated for selected period and criteria';
    el.badgeWeek.textContent = `${formatDate(d.start)} – ${formatDate(d.end)}`;
    el.badgeType.innerHTML = `<i class="fa-solid fa-layer-group me-1"></i>${d.type}`;

    // Metrics
    renderMetrics(d);

    // Chart
    renderChart(d);

    // Table
    state.table.columns = d.table.columns;
    state.table.rows = d.table.rows;
    state.table.filteredRows = [...state.table.rows];
    state.table.page = 1;
    el.tableSearch.value = '';
    el.rowsPerPage.value = '10';
    state.table.rowsPerPage = 10;
    renderTable();

    // Toggle sections
    el.loadingState.classList.add('d-none');
    el.emptyState.classList.add('d-none');
    el.reportContent.classList.remove('d-none');

    // Chart header details
    el.chartTitle.textContent = d.type === 'Weekly Revenue' ? 'Revenue by Day' : 'Average Occupancy by Day';
    el.chartSubtitle.textContent = 'Double-click to reset.';
    if (d.type === 'Weekly Revenue') {
        const penaltiesSection = document.getElementById('penalties');
        const penaltiesTotalEl = penaltiesSection.querySelector('#penaltiesTotalAmount');
        penaltiesTotalEl.textContent = formatCurrency(d.revenueFromPenalties);
        penaltiesSection.classList.remove('d-none');
    }
}

function renderMetrics(d) {
    const m = d.summary;
    const cards = [];
    if (d.type === 'Weekly Revenue') {
        cards.push(metricCard('Total Revenue', formatCurrency(m.totalRevenue), 'fa-sack-dollar', 'info'));
        cards.push(metricCard('Total Transactions', m.totalTransactions.toLocaleString(), 'fa-receipt', 'success'));
        cards.push(metricCard('Average Ticket', formatCurrency(m.averageTicket), 'fa-ticket', 'secondary'));
        cards.push(metricCard('Lots Covered', m.lotsCount, 'fa-square-parking', 'primary'));
    } else {
        cards.push(metricCard('Avg Occupancy', formatPercent(m.avgOccupancy), 'fa-chart-area', 'success'));
        cards.push(metricCard('Peak Occupancy', formatPercent(m.peakOccupancy), 'fa-chart-line', 'warning'));
        cards.push(metricCard('Lots Covered', m.lotsCount, 'fa-square-parking', 'info'));
        cards.push(metricCard('Days in Range', m.daysCount, 'fa-calendar-day', 'secondary'));
    }
    el.metricsRow.innerHTML = cards.join('');
}

function metricCard(title, value, icon, tone) {
    return `
        <div class="metric-card">
          <div class="metric-title">${title}</div>
          <div class="d-flex align-items-center justify-content-between">
            <div class="metric-value">${value}</div>
            <div class="badge-soft ${tone}"><i class="fa-solid ${icon}"></i></div>
          </div>
        </div>`;
}

function renderChart(d) {
    if (state.chart) {
        state.chart.destroy();
    }
    const ctx = el.reportChart.getContext('2d');
    const config = {
        type: d.type === 'Weekly Revenue' ? 'bar' : 'line',
        data: {
            labels: d.chart.labels,
            datasets: d.chart.datasets
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: true
                },
                tooltip: {
                    enabled: true
                },
                zoom: {
                    zoom: {
                        wheel: {
                            enabled: true
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x'
                    },
                    pan: {
                        enabled: true,
                        mode: 'x'
                    },
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (val) => d.type === 'Weekly Revenue' ? formatCurrency(val) : `${val}%`
                    }
                }
            },
            onDblClick: (e, item) => {
                state.chart.resetZoom();
            }
        }
    };
    state.chart = new Chart(ctx, config);
    // Reset zoom on double-click (fallback handler)
    el.reportChart.addEventListener('dblclick', () => state.chart.resetZoom());
}

function applyTableFilter(term) {
    const t = term.toLowerCase();
    if (!t) {
        state.table.filteredRows = [...state.table.rows];
    } else {
        state.table.filteredRows = state.table.rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(t)));
    }
    state.table.page = 1;
    renderTable();
}

function renderTable() {
    // Head with sort controls
    el.tableHead.innerHTML = `<tr>${state.table.columns.map(c => `
        <th role="button" class="sortable" data-key="${c.key}">
          <span>${c.label}</span>
          <i class="sort-indicator fa-solid fa-arrow-down-short-wide ms-2 text-muted"></i>
        </th>`).join('')}</tr>`;

    el.tableHead.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-key');
            if (state.table.sortKey === key) {
                state.table.sortDir = state.table.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                state.table.sortKey = key;
                state.table.sortDir = 'asc';
            }
            sortTable();
            renderTable();
        });
    });

    // Sort indicator update
    el.tableHead.querySelectorAll('th.sortable').forEach(th => {
        const key = th.getAttribute('data-key');
        const icon = th.querySelector('.sort-indicator');
        if (key === state.table.sortKey) {
            icon.classList.remove('fa-arrow-down-short-wide', 'fa-arrow-up-short-wide');
            icon.classList.add(state.table.sortDir === 'asc' ? 'fa-arrow-down-short-wide' : 'fa-arrow-up-short-wide');
            icon.classList.remove('text-muted');
        } else {
            icon.classList.add('text-muted');
        }
    });

    // Pagination and rows
    const total = state.table.filteredRows.length;
    const per = state.table.rowsPerPage;
    const pages = Math.max(1, Math.ceil(total / per));
    if (state.table.page > pages) state.table.page = pages;
    const startIdx = (state.table.page - 1) * per;
    const endIdx = Math.min(startIdx + per, total);
    const pageRows = state.table.filteredRows.slice(startIdx, endIdx);

    // Rows
    el.tableBody.innerHTML = pageRows.map(r => `<tr>
        ${state.table.columns.map(c => `<td>${formatCell(r[c.key], c.type)}</td>`).join('')}
      </tr>`).join('');

    el.paginationInfo.textContent = total === 0 ? 'Showing 0 to 0 of 0 entries' : `Showing ${startIdx + 1} to ${endIdx} of ${total} entries`;

    // Pagination controls
    el.pagination.innerHTML = '';
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${state.table.page === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `<a class="page-link" href="#" aria-label="Previous"><span aria-hidden="true">&laquo;</span></a>`;
    prevLi.addEventListener('click', (e) => {
        e.preventDefault();
        if (state.table.page > 1) {
            state.table.page--;
            renderTable();
        }
    });
    el.pagination.appendChild(prevLi);

    for (let p = 1; p <= pages; p++) {
        const li = document.createElement('li');
        li.className = `page-item ${p === state.table.page ? 'active' : ''}`;
        li.innerHTML = `<a class="page-link" href="#">${p}</a>`;
        li.addEventListener('click', (e) => {
            e.preventDefault();
            state.table.page = p;
            renderTable();
        });
        el.pagination.appendChild(li);
    }

    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${state.table.page === pages ? 'disabled' : ''}`;
    nextLi.innerHTML = `<a class="page-link" href="#" aria-label="Next"><span aria-hidden="true">&raquo;</span></a>`;
    nextLi.addEventListener('click', (e) => {
        e.preventDefault();
        if (state.table.page < pages) {
            state.table.page++;
            renderTable();
        }
    });
    el.pagination.appendChild(nextLi);
}

function formatCell(val, type) {
    switch (type) {
        case 'currency':
            return formatCurrency(val);
        case 'number':
            return Number(val).toLocaleString();
        case 'percent':
            return formatPercent(Number(val));
        case 'date':
            return val;
        default:
            return val;
    }
}

function sortTable() {
    const {
        sortKey,
        sortDir
    } = state.table;
    if (!sortKey) return;
    const colType = (state.table.columns.find(c => c.key === sortKey) || {}).type || 'text';
    state.table.filteredRows.sort((a, b) => {
        let va = a[sortKey],
            vb = b[sortKey];
        if (colType === 'currency' || colType === 'number' || colType === 'percent') {
            va = Number(String(va).toString().replace(/[^0-9.-]/g, ''));
            vb = Number(String(vb).toString().replace(/[^0-9.-]/g, ''));
        } else if (colType === 'date') {
            va = new Date(va);
            vb = new Date(vb);
        } else {
            va = String(va).toLowerCase();
            vb = String(vb).toLowerCase();
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });
}

async function exportPDF() {
    Swal.fire({
        title: 'Assembling Report...',
        text: 'This may take a moment.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const header = document.querySelector('.manager-navbar');
    const sidebar = document.getElementById('sidebarManager');
    const sectionIds = [
        'reportHeaderCard',
        'metricsRow',
        'revenue',
        'penalties',
        'reportTableCard'
    ];

    try {
        if (header) header.style.display = 'none';
        if (sidebar) sidebar.style.display = 'none';
        const canvases = await Promise.all(sectionIds.map(async id => {
            const element = document.getElementById(id);
            if (!element || element.classList.contains('d-none')) {
                return null;
            }
            return await html2canvas(element, { useCORS: true });
        }));

        // 2. Manually create a new PDF document
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfMargin = 10;
        let currentHeight = pdfMargin;

        // 3. Add each canvas image to the PDF
        canvases.forEach((canvas) => {
            if (!canvas) return; // Skip null canvases

            const imgData = canvas.toDataURL('image/jpeg', 0.98);
            const imgWidth = pdfWidth - (pdfMargin * 2);
            const imgHeight = canvas.height * imgWidth / canvas.width;

            // Check if the image fits on the current page, if not, add a new page
            if (currentHeight + imgHeight > pdf.internal.pageSize.getHeight() - pdfMargin) {
                pdf.addPage();
                currentHeight = pdfMargin;
            }

            pdf.addImage(imgData, 'JPEG', pdfMargin, currentHeight, imgWidth, imgHeight);
            currentHeight += imgHeight + 5; // Add a 5mm gap between sections
        });

        // 4. Save the assembled PDF
        const fileName = `${state.reportData.type.toLowerCase().replace(/\s+/g, '_')}_report.pdf`;
        pdf.save(fileName);

    } catch (error) {
        console.error("PDF Generation Failed:", error);
        Swal.fire('Error', 'An unexpected error occurred during PDF assembly.', 'error');
    } finally {
        // --- CLEANUP: Restore all hidden elements ---
        if (header) header.style.display = '';
        if (sidebar) sidebar.style.display = '';
        Swal.close();
    }
}
document.addEventListener('DOMContentLoaded', function () {

    // Find the logout button by the ID we just added
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', function (event) {
            event.preventDefault();

            console.log('Logout button clicked. Clearing session...');
            localStorage.removeItem('accessToken');
            alert('You have been successfully logged out.');
            window.location.href = './index.html';
        });
    }
});
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

            // Close the modal
            const contactModal = document.getElementById('contactModal');
            const modal = bootstrap.Modal.getInstance(contactModal);
            if (modal) {
                modal.hide();
            }
        });
    }
});