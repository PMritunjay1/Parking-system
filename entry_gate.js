dayjs.extend(window.dayjs_plugin_utc);
dayjs.extend(window.dayjs_plugin_timezone);
const API_BASE_URL = 'http://127.0.0.1:8000';

// --- STATE MANAGEMENT ---
const state = {
    currentStep: 'welcome',
    selectedVehicleType: '',
    inputValue: '',
    ticketDetails: null,
    errorMessage: '',
    resetTimerId: null
};

const config = {
    statusResetMs: 5000,
    numberMaxLen: 12
};

// --- DOM ELEMENTS ---
const stepIndicator = document.getElementById('stepIndicator');
const selectedTypeBadge = document.getElementById('selectedTypeBadge');
const numberDisplay = document.getElementById('numberDisplay');

// --- UI HELPER FUNCTIONS ---
function setStep(step) {
    if (step === 'welcome') {
        console.trace("setStep('welcome') was called from this location:");
    }
    state.currentStep = step;
    document.querySelectorAll('.flow-step').forEach(s => s.classList.remove('active'));
    const target = document.querySelector(`.flow-step[data-step="${step}"]`);
    if (target) target.classList.add('active');
    stepIndicator.textContent = {}[step];
}

function resetFlow() {
    // This trace will tell us exactly what function called resetFlow.
    console.trace("resetFlow() was called from this location:");

    clearTimeout(state.resetTimerId);
    state.selectedVehicleType = '';
    state.inputValue = '';
    state.ticketDetails = null;
    document.getElementById('selectedTypeBadge').textContent = 'No type selected';
    document.getElementById('numberDisplay').textContent = '';
    setStep('welcome');
}

// --- API INTEGRATION FUNCTIONS ---
async function initializeKiosk() {
    try {
        const configData = await fetch(`${API_BASE_URL}/entry/config`).then(res => res.json());

        // This JS populates the three new fee sections in the HTML above
        for (const [type, rates] of Object.entries(configData.fee_structure_details)) {
            const feeContainer = document.getElementById(`fee${type}`);
            if (feeContainer) {
                let feeHtml = `<li>First Hour: ₹${rates.first_hour.toFixed(2)}</li>`;
                feeHtml += `<li>Subsequent Hour: ₹${rates.subsequent_hour.toFixed(2)}</li>`;
                feeHtml += `<li>Lost Ticket Penalty: ₹${rates.lost_ticket_penalty.toFixed(2)}</li>`;
                feeContainer.innerHTML = `<ul class="mb-0 ps-3">${feeHtml}</ul>`;
            }
        }

        // This part creates the vehicle type buttons on the next screen
        const vehicleTypeGrid = document.getElementById('vehicleTypeGrid');
        const vehicleIcons = { 'Motorcycle': 'fa-motorcycle', 'Compact': 'fa-car-side', 'Large': 'fa-bus' };
        vehicleTypeGrid.innerHTML = configData.supported_vehicle_types.map(type => {
            const icon = vehicleIcons[type] || 'fa-car';
            return `<div class="col-6 col-md-4">
                        <button class="vehicle-type-btn btn btn-outline-secondary w-100 py-3" data-type="${type}">
                            <i class="fa-solid ${icon} fa-2x d-block mb-2"></i>
                            <span class="fw-semibold">${type}</span>
                        </button>
                    </div>`;
        }).join('');

    } catch (error) {
        console.error("Failed to load kiosk configuration:", error);
    }
}
const fmtTime = (iso) => {
    if (!iso) return '—';
    // Parse the UTC time and display it in the Asia/Kolkata timezone
    return dayjs.utc(iso).tz('Asia/Kolkata').format('DD/MM/YYYY h:mm A');
};
async function handleConfirm() {
    const vehicleNumber = state.inputValue.trim();
    if (!vehicleNumber) {
        Swal.fire({ icon: 'warning', title: 'Input Required', text: 'Please enter your vehicle number.' });
        return;
    }
    const vehicleNumberPattern = /^(?:[A-Z]{2}[0-9]{2}[A-Z]{1}[0-9]{4}|[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4})$/i;

    if (!vehicleNumberPattern.test(vehicleNumber)) {
        Swal.fire({
            icon: 'error',
            title: 'Invalid Vehicle Number Format',
            text: 'Please enter a valid format (e.g., UP52A1429 or UP52AP1429).'
        });
        return; // Stop the function here
    }

    setStep('processing');
    try {
        const requestBody = {
            vehicle_number: vehicleNumber.toUpperCase(),
            vehicle_type: state.selectedVehicleType
        };

        const ticketData = await fetch(`${API_BASE_URL}/entry/ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        }).then(res => {
            if (!res.ok) return res.json().then(err => Promise.reject(err));
            return res.json();
        });

        state.ticketDetails = {
            ticketId: ticketData.ticket_id,
            spotId: ticketData.spot_number,
            entryTime: ticketData.entry_time, // CORRECT: Store the original UTC string
            vehicleNumber: vehicleNumber,
            vehicleType: state.selectedVehicleType,
            qrCodeData: ticketData.qr_code_data
        };
        onProcessSuccess();
    } catch (error) {
        console.error("Failed to issue ticket:", error);
        state.errorMessage = error.detail || 'System Error. Please try again.';
        onProcessFailure();
    }
}

let resetIntervalId = null;

function startResetTimer(durationMs) {
    clearInterval(resetIntervalId);

    const progressBar = document.getElementById('reset-progress-bar');
    const timerLabel = document.getElementById('reset-timer-label');
    const startTime = Date.now();

    resetIntervalId = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remainingMs = Math.max(0, durationMs - elapsed);
        const remainingSec = Math.ceil(remainingMs / 1000);
        const progressPct = (remainingMs / durationMs) * 100;

        progressBar.style.width = `${progressPct}%`;
        timerLabel.textContent = `This screen will reset in ${remainingSec} sec.`;

        if (remainingMs <= 0) {
            clearInterval(resetIntervalId);
            resetFlow();
        }
    }, 250); // Update 4 times per second
}

function onProcessSuccess() {
    setStep('displayTicket');

    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
        text: state.ticketDetails.qrCodeData,
        width: 220,
        height: 220
    });

    const list = document.getElementById('ticketDetails');
    list.innerHTML = `
        <li class="mb-2"><strong>Ticket ID:</strong> ${state.ticketDetails.ticketId}</li>
        <li class="mb-2"><strong>Spot:</strong> ${state.ticketDetails.spotId}</li>
        <li class="mb-2"><strong>Vehicle:</strong> ${state.ticketDetails.vehicleNumber}</li>
        <li class="mb-2"><strong>Type:</strong> ${state.ticketDetails.vehicleType}</li>
        <li class="mb-2"><strong>Entry Time:</strong> ${fmtTime(state.ticketDetails.entryTime)}</li>`;

    startResetTimer(60000);
} function onProcessFailure() {
    setStep('status');
    const statusIcon = document.getElementById('statusIcon');
    const statusMessage = document.getElementById('statusMessage');
    statusIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-danger"></i>';
    statusMessage.textContent = state.errorMessage;
    state.resetTimerId = setTimeout(resetFlow, config.statusResetMs);
}

// --- INITIALIZE KEYBOARD AND EVENT LISTENERS ---
const keyboardGrid = document.getElementById('keyboardGrid');
const keys = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', '-', 'BACK', 'CLEAR'];
keyboardGrid.innerHTML = keys.map(k => {
    let content = k;
    if (k === 'BACK') content = `<i class='fa-solid fa-delete-left'></i>`;
    if (k === 'CLEAR') content = `<i class='fa-solid fa-eraser'></i>`;
    const btnClass = ['BACK', 'CLEAR'].includes(k) ? 'btn-light' : 'btn-outline-secondary';
    return `<button class="kb-key btn ${btnClass}" data-key="${k}">${content}</button>`;
}).join('');

document.getElementById('startButton').addEventListener('click', () => setStep('selectType'));
document.getElementById('backToWelcome').addEventListener('click', resetFlow);
document.getElementById('confirmNumber').addEventListener('click', (e) => { e.preventDefault(); handleConfirm(); });
document.getElementById('backToType').addEventListener('click', () => setStep('selectType'));
document.getElementById('newEntryButton').addEventListener('click', resetFlow);

document.getElementById('vehicleTypeGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.vehicle-type-btn');
    if (!btn) return;
    state.selectedVehicleType = btn.dataset.type;
    selectedTypeBadge.textContent = state.selectedVehicleType;
    setStep('enterNumber');
});
// Add this with your other event listeners
document.querySelectorAll('.dropdown-menu [data-lang]').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const lang = e.currentTarget.getAttribute('data-lang');
        showToast('Language set to ' + (lang === 'en' ? 'English' : 'हिंदी'));
    });
});
keyboardGrid.addEventListener('click', (e) => {
    const keyBtn = e.target.closest('.kb-key');
    if (!keyBtn) return;
    const key = keyBtn.dataset.key;
    if (key === 'BACK') {
        state.inputValue = state.inputValue.slice(0, -1);
    } else if (key === 'CLEAR') {
        state.inputValue = '';
    } else if (state.inputValue.length < config.numberMaxLen) {
        state.inputValue += key;
    }
    numberDisplay.value = state.inputValue;

});
numberDisplay.addEventListener('input', () => {
    state.inputValue = numberDisplay.value.toUpperCase();
    if (state.inputValue.length > config.numberMaxLen) {
        state.inputValue = state.inputValue.slice(0, config.numberMaxLen);
    }
    numberDisplay.value = state.inputValue;
});
function updateTime() {
    const el = document.getElementById('gateTime');
    if (el) {
        el.textContent = dayjs().tz("Asia/Kolkata").format('HH:mm:ss');
    }
}

// --- PAGE LOAD INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    initializeKiosk();
    setStep('welcome');
    updateTime();
    setInterval(updateTime, 10000);
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
            const contactModal = document.getElementById('contactModal');
            const modal = bootstrap.Modal.getInstance(contactModal);
            if (modal) {
                modal.hide();
            }
        });
    }
});