const API_BASE_URL = 'http://127.0.0.1:8000';
let allTickets = [];
/**
 * Helper function to make authenticated API calls.
 */
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
        throw new Error(error.detail || `API request failed: ${response.status}`);
    }
    return response.json();
}

// --- STATE MANAGEMENT ---
let tableState = {
    currentPage: 1,
    pageSize: 8,
    sortCol: 'entry_time', // Corresponds to API sort key
    sortDir: 'desc',
    filterLot: '',
    filterType: '',
    search: ''
};
let selectedLotId = 1; // Default to Lot 1 (Lot A)
let activityFeedInterval;

// --- UI HELPER FUNCTIONS ---
dayjs.extend(window.dayjs_plugin_utc);
dayjs.extend(window.dayjs_plugin_timezone);

const fmtTime = (iso) => {
    if (!iso) return '—';
    // Parse the UTC time and display it in the Asia/Kolkata timezone
    return dayjs.utc(iso).tz('Asia/Kolkata').format('DD/MM/YYYY h:mm A');
};

const durationFrom = (iso) => {
    if (!iso) return '—';
    // Use day.js to handle both times in UTC for an accurate difference
    const nowUtc = dayjs.utc();
    const thenUtc = dayjs.utc(iso);
    const mins = nowUtc.diff(thenUtc, 'minute');

    if (mins < 0) return '—'; // Avoid negative durations

    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
};
const showToast = (message, iconClass = 'fa-plug-circle-check') => {
    console.log(`Toast: ${message}`);
};
const initTooltips = () => {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(el => new bootstrap.Tooltip(el));
};

// --- API-DRIVEN RENDER FUNCTIONS ---
async function updateKPIs() {
    // Update occupancy, available spots, etc.
    try {
        const summaryData = await fetchWithAuth('/admin/dashboard/summary');
        const total = summaryData.total_spots || 0;
        const occupied = summaryData.occupied_spots || 0;
        document.getElementById('kpiOccupancy').textContent = `${occupied}/${total}`;
        document.getElementById('kpiAvailable').textContent = String(summaryData.available_spots || 0);
        if (total > 0) {
            document.getElementById('kpiAvailablePct').textContent = `${Math.round((summaryData.available_spots / total) * 100)}% free`;
        }
        document.getElementById('kpiLots').textContent = String(Object.keys(summaryData.breakdown_by_lot).length);
    } catch (error) {
        console.error("Error updating summary KPIs:", error);
    }

    // Fetch and update Today's Revenue
    try {
        const startDate = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const endDate = new Date().toISOString();
        const revenueData = await fetchWithAuth(`/admin/reports/revenue?start_date=${startDate}&end_date=${endDate}`);
        document.getElementById('kpiRevenue').textContent = `₹${(revenueData.total_revenue || 0).toFixed(2)}`;
        document.getElementById('kpiRevenueUpdated').textContent = new Date().toLocaleTimeString();
    } catch (error) {
        console.error("Error updating revenue KPI:", error);
        document.getElementById('kpiRevenue').textContent = 'Error';
    }
}

async function renderMap() {
    const mapEl = document.getElementById('parkingMap');
    mapEl.innerHTML = `<div class="spinner-border text-info m-auto" role="status"></div>`;
    try {
        const data = await fetchWithAuth(`/admin/parking-lots/${selectedLotId}/map`);
        mapEl.innerHTML = data.spots_array.map(s => `
                    <button class="spot ${s.status === 'occupied' ? 'bg-danger' : 'bg-success'}" 
                            data-id="${s.spot_number}" 
                            data-status="${s.status}" 
                            data-bs-toggle="tooltip" 
                            data-bs-title="${s.spot_number} • ${s.status}">
                    </button>
                `).join('');
        initTooltips();
        document.getElementById('lotContext').textContent = data.lot_name;
        const occupied = data.spots_array.filter(s => s.status === 'occupied').length;
        document.getElementById('mapSummary').textContent = `${occupied} occupied • ${data.spots_array.length - occupied} available`;
    } catch (error) {
        console.error("Error rendering map:", error);
        mapEl.innerHTML = '<div class="text-danger m-auto">Failed to load parking map.</div>';
    }
}

async function renderTable() {
    const tbody = document.getElementById('vehiclesTbody');
    tbody.innerHTML = `<tr><td colspan="8" class="text-center">Loading...</td></tr>`;

    const params = new URLSearchParams({
        status: 'active',
        sort_by: `${tableState.sortCol}_${tableState.sortDir}`
    });
    if (tableState.search) params.set('vehicle_number', tableState.search);

    try {
        const tickets = await fetchWithAuth(`/admin/tickets?${params.toString()}`);
        allTickets = tickets;
        // Client-side filtering for Lot and Type
        let filteredData = tickets;
        if (tableState.filterLot) filteredData = filteredData.filter(t => t.lot_name.includes(tableState.filterLot));
        if (tableState.filterType) filteredData = filteredData.filter(t => t.vehicle_type === tableState.filterType); // Assuming vehicle_type is available

        const start = (tableState.currentPage - 1) * tableState.pageSize;
        const rows = filteredData.slice(start, start + tableState.pageSize);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center">No active vehicles found.</td></tr>`;
        } else {
            tbody.innerHTML = rows.map(v => {
                const badge = v.vehicle_type === 'Large' ? 'success' : (v.vehicle_type === 'Motorcycle' ? 'secondary' : 'primary');
                return `<tr data-plate="${v.vehicle_number}">
                    <td>${v.ticket_id}</td>
                    <td>${v.vehicle_number}</td>
                    <td><span class="badge text-bg-${badge}">${v.vehicle_type || 'N/A'}</span></td>
                    <td>${v.spot_number}</td>
                    <td>${v.lot_name}</td>
                    <td>${fmtTime(v.entry_time)}</td>
                    <td>${durationFrom(v.entry_time)}</td>
                    <td>
                      <div class="btn-group btn-group-sm">
                        <button class="btn btn-sm btn-light view-details-btn" data-ticket-id="${v.ticket_id}" title="View Ticket Details"><i class="fa-solid fa-up-right-from-square"></i></button>                      </div>
                    </td>
                </tr>`;
            }).join('');
        }
        const info = document.getElementById('paginationInfo');
        const total = filteredData.length;
        const from = Math.min(total, start + 1);
        const to = Math.min(total, start + rows.length);
        info.textContent = `Showing ${from}–${to} of ${total}`;
        document.getElementById('prevPage').disabled = tableState.currentPage === 1;
        const totalPages = Math.max(1, Math.ceil(total / tableState.pageSize));
        document.getElementById('nextPage').disabled = tableState.currentPage >= totalPages;

    } catch (error) {
        console.error("Error rendering table:", error);
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed to load vehicle data.</td></tr>`;
    }
}

async function fetchLiveActivity() {
    try {
        const tickets = await fetchWithAuth('/admin/tickets?sort_by=entry_time_desc');
        const feedEl = document.getElementById('activityFeed');
        feedEl.innerHTML = '';
        tickets.slice(0, 5).forEach(t => {
            const isEntry = t.status.toLowerCase() === 'active';
            const icon = isEntry ? 'fa-right-to-bracket text-success' : 'fa-right-from-bracket text-danger';

            // CORRECTED: Use the fmtTime helper function for proper timezone conversion
            const time = fmtTime(t.exit_time || t.entry_time);

            const li = document.createElement('li');
            li.className = 'list-group-item d-flex align-items-center gap-2';
            li.innerHTML = `<i class="fa-solid ${icon}"></i>
                        <div class="flex-grow-1">
                          <div><strong>${t.vehicle_number}</strong> ${isEntry ? 'entered' : 'exited'} • ${t.lot_name} • ${t.spot_number}</div>
                          <div class="small text-muted">${time}</div>
                        </div>`;
            feedEl.appendChild(li);
        });
    } catch (error) {
        console.error("Error fetching live activity:", error);
    }
}
// --- EVENT LISTENERS ---
document.getElementById('lotSelector').addEventListener('change', (e) => {
    const lotIdMap = { 'A': 1, 'B': 2, 'C': 3 };
    selectedLotId = lotIdMap[e.target.value] || 1;
    renderMap();
});

document.getElementById('filterLot').addEventListener('change', (e) => {
    tableState.filterLot = e.target.value;
    tableState.currentPage = 1;
    renderTable(); // Re-render with client-side filter
});

document.getElementById('filterType').addEventListener('change', (e) => {
    tableState.filterType = e.target.value;
    tableState.currentPage = 1;
    renderTable(); // Re-render with client-side filter
});

document.getElementById('filterSearch').addEventListener('input', (e) => {
    tableState.search = e.target.value.trim();
    tableState.currentPage = 1;
    renderTable(); // Re-render, will trigger new API call
});
document.addEventListener('click', (e) => {
    if (e.target.closest('#prevPage')) {
        tableState.currentPage = Math.max(1, tableState.currentPage - 1);
        renderTable();
    }
    if (e.target.closest('#nextPage')) {
        tableState.currentPage++;
        renderTable();
    }
});
function getStatusBadge(status) {
    const statusMap = {
        'ACTIVE': 'warning',
        'CLOSED': 'success',
        'EXPIRED': 'danger' // Assuming you might have this status
    };
    const badgeClass = statusMap[status.toUpperCase()] || 'secondary';
    return `<span class="badge text-bg-${badgeClass}">${status}</span>`;
}
async function handleAssistedExit(tickets) {
    const {
        value: paymentMethod
    } = await Swal.fire({
        title: 'Confirm Assisted Exit',
        html: `Process a lost ticket or manual exit for <strong>${tickets.vehicle_number}</strong>? A penalty may be applied.`,
        icon: 'warning',
        input: 'select',
        inputOptions: {
            'Cash': 'Cash',
            'Card': 'Card',
            'UPI': 'UPI'
        },
        inputPlaceholder: 'Select payment method',
        showCancelButton: true,
        confirmButtonText: 'Yes, process exit',
        inputValidator: (value) => {
            if (!value) {
                return 'You need to choose a payment method!'
            }
        }
    });

    if (paymentMethod) {
        Swal.fire({
            title: 'Processing...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const exitResult = await fetchWithAuth('/admin/exit/assisted', {
                method: 'POST',
                body: JSON.stringify({
                    vehicle_number: tickets.vehicle_number,
                    exit_reason: "ASSISTED_BY_ADMIN",
                    payment_method: paymentMethod,
                    amount_paid: 50.00, // Example penalty amount
                    processed_by_user_id: 1 // Placeholder for the logged-in user's ID
                })
            });

            Swal.fire('Success!', exitResult.message, 'success');
            renderTable(); // Refresh the table to show the updated status

        } catch (error) {
            Swal.fire('Action Failed', error.message, 'error');
        }
    }
}
document.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('.view-details-btn');
    if (viewBtn) {
        const ticketId = viewBtn.dataset.ticketId;
        const ticket = allTickets.find(t => t.ticket_id == ticketId);

        if (!ticket) {
            console.error('Ticket data not found for ID:', ticketId);
            return;
        }
        const isTicketActive = ticket.status.toUpperCase() === 'ACTIVE';

        Swal.fire({
            title: `Ticket Details`,
            html: `
                <div class="text-start p-2">
                    <p class="mb-2"><strong>Ticket ID:</strong> #${ticket.ticket_id}</p>
                    <p class="mb-2"><strong>Vehicle Plate:</strong> ${ticket.vehicle_number}</p>
                    <p class="mb-2"><strong>Spot:</strong> ${ticket.spot_number} (${ticket.lot_name})</p>
                    <p class="mb-2"><strong>Entry Time:</strong> ${new Date(ticket.entry_time).toLocaleString()}</p>
                    <hr>
                    <p class="mb-0"><strong>Status:</strong> ${getStatusBadge(ticket.status)}</p>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-life-ring me-2"></i> Assist Exit',
            cancelButtonText: 'Close',
            confirmButtonColor: '#dc3545',
            showConfirmButton: isTicketActive,
        }).then((result) => {
            if (result.isConfirmed) {
                handleAssistedExit(ticket);
            }
        });
    }
});

// --- INITIAL PAGE LOAD ---
window.addEventListener('DOMContentLoaded', () => {
    updateKPIs();
    renderMap();
    renderTable();
    fetchLiveActivity();
    setInterval(() => {
        updateKPIs();
        renderMap();
        renderTable();
        fetchLiveActivity();
    }, 30000); // Refresh every 30 seconds
});
// Wait for the page to fully load
document.addEventListener('DOMContentLoaded', function () {
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