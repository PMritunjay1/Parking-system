dayjs.extend(window.dayjs_plugin_utc);
dayjs.extend(window.dayjs_plugin_timezone);
const API_BASE_URL = 'http://127.0.0.1:8000';
function updateClock() {
    const el = document.getElementById('gateTime');
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}
updateClock();
setInterval(updateClock, 1000);

// Toast helper
let toast;

function showToast(message) {
    const toastEl = document.getElementById('kioskToast');
    toastEl.querySelector('.toast-body').textContent = message;
    if (!toast) toast = new bootstrap.Toast(toastEl, {
        delay: 3000
    });
    toast.show();
}
function logLine(text) {
    document.getElementById('logLine').textContent = text;
}
const state = {
    currentStep: 'scan',
    ticketDetails: null,
    calculatedFee: 0,
    paymentStatus: 'idle',
    countdown: 120,
    timerId: null,
    selectedPaymentMethod: null,
    gateId: 'GATE-EXIT-01'
};
function setStep(step) {
    state.currentStep = step;
    ['screen-scan', 'screen-payment', 'screen-status', 'screen-assistance'].forEach(id => {
        document.getElementById(id).classList.add('d-none');
    });
    if (step === 'scan') {
        document.getElementById('screen-scan').classList.remove('d-none');
        stopTimer();
        logLine('Ready. Waiting for ticket scan...');
    }
    if (step === 'payment') {
        document.getElementById('screen-payment').classList.remove('d-none');
        startPaymentFlow();
        logLine('Ticket validated. Awaiting payment method selection...');
    }
    if (step === 'status') {
        document.getElementById('screen-status').classList.remove('d-none');
    }
    if (step === 'assistance') {
        document.getElementById('screen-assistance').classList.remove('d-none');
        stopTimer();
    }
}

async function validateAndShowPayment(ticketId) {
    // Show a "Validating..." pop-up to the user
    Swal.fire({
        title: 'Validating Ticket...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const details = await fetch(`${API_BASE_URL}/exit/details/${ticketId}`).then(res => {
            if (!res.ok) {
                return res.json().then(err => Promise.reject(err));
            }
            return res.json();
        });

        Swal.close();

        if (!details || !details.entry_time) {
            throw new Error("Received invalid ticket data from the server.");
        }

        state.ticketDetails = {
            ...details,
            entryTime: details.entry_time,
            ticketId: details.ticket_id              // <-- keep consistent naming
        };
        state.calculatedFee = details.calculated_fee;
        setStep('payment');

    } catch (error) {
        // This 'catch' block will now correctly handle API failures
        console.error("Ticket validation failed:", error);
        Swal.fire({
            icon: 'error',
            title: 'Invalid Ticket',
            text: error.detail || 'This ticket could not be found or is no longer active.'
        });
        logLine('Validation failed. Please try again.');
    }
}
function formatDuration(ms) {
    const totalMin = Math.max(1, Math.round(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return (h > 0 ? h + 'h ' : '') + m + 'm';
}



function showPaymentSummary() {
    const entryTimeUtc = dayjs.utc(state.ticketDetails.entry_time);
    const nowUtc = dayjs.utc();
    const durationMs = nowUtc.diff(entryTimeUtc);
    const durationStr = formatDuration(durationMs);

    const fee = state.calculatedFee;
    document.getElementById('durationValue').textContent = durationStr;
    document.getElementById('amountValue').textContent = '₹ ' + fee.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Payment flow
function startPaymentFlow() {
    state.countdown = 120;
    updateCountdown();
    stopTimer();
    state.timerId = setInterval(() => {
        state.countdown -= 1;
        updateCountdown();
        if (state.countdown <= 0) {
            stopTimer();
            paymentTimeout();
        }
    }, 1000);
    showPaymentSummary();
    document.getElementById('upiSection').classList.add('d-none');
    document.querySelectorAll('#paymentButtons .payment-option').forEach(btn => btn.classList.remove('active'));
    state.selectedPaymentMethod = null;
}

function stopTimer() {
    if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
    }
}

function updateCountdown() {
    const label = document.getElementById('countdownLabel');
    const bar = document.getElementById('timeoutBar');
    label.textContent = state.countdown;
    const pct = Math.max(0, (state.countdown / 120) * 100);
    bar.style.width = pct + '%';
    if (pct < 30) {
        bar.classList.add('bg-danger');
        bar.classList.remove('bg-warning');
    } else if (pct < 60) {
        bar.classList.add('bg-warning');
        bar.classList.remove('bg-danger');
    } else {
        bar.classList.remove('bg-warning', 'bg-danger');
    }
}

function paymentTimeout() {
    showToast('Payment timed out. Assistance required.');
    Swal.fire({
        icon: 'warning',
        title: 'Payment Timeout',
        text: 'Your session has timed out. An attendant can help you complete the exit.',
        confirmButtonText: 'OK'
    });
    setStep('assistance');
}
function simulateCardPayment() {
    return new Promise((resolve, reject) => {
        Swal.fire({
            title: 'Enter Card Details',
            html: `
                <input id="swal-card-number" class="swal2-input" placeholder="Card Number (16 digits)" maxlength="16">
                <input id="swal-card-expiry" class="swal2-input" placeholder="MM/YY" maxlength="5">
                <input id="swal-card-cvc" class="swal2-input" placeholder="CVC (3-4 digits)" maxlength="4">
            `,
            confirmButtonText: 'Pay Now',
            showCancelButton: true,
            didOpen: () => {
                // Auto-add slash to expiry date for better UX
                const expiryInput = document.getElementById('swal-card-expiry');
                expiryInput.addEventListener('input', () => {
                    if (expiryInput.value.length === 2 && !expiryInput.value.includes('/')) {
                        expiryInput.value += '/';
                    }
                });
            },
            preConfirm: () => {
                // --- VALIDATION LOGIC ---
                const cardNumber = document.getElementById('swal-card-number').value;
                const cardExpiry = document.getElementById('swal-card-expiry').value;
                const cardCvc = document.getElementById('swal-card-cvc').value;

                // 1. Card Number Validation (must be 16 digits)
                if (!/^\d{16}$/.test(cardNumber)) {
                    Swal.showValidationMessage('Please enter a valid 16-digit card number.');
                    return false;
                }
                // 2. Expiry Date Validation (must be MM/YY and not in the past)
                const expiryRegex = /^(0[1-9]|1[0-2])\/(\d{2})$/;
                if (!expiryRegex.test(cardExpiry)) {
                    Swal.showValidationMessage('Please enter a valid expiry date in MM/YY format.');
                    return false;
                }
                const [month, year] = cardExpiry.split('/');
                const expiryDate = new Date(`20${year}`, month - 1);
                const now = new Date();
                now.setMonth(now.getMonth() - 1); // Allow current month
                if (expiryDate < now) {
                    Swal.showValidationMessage('Card has expired.');
                    return false;
                }

                // 3. CVC Validation (must be 3 or 4 digits)
                if (!/^\d{3,4}$/.test(cardCvc)) {
                    Swal.showValidationMessage('Please enter a valid 3 or 4-digit CVC.');
                    return false;
                }

                // If all validation passes, return true to proceed
                return true;
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // Show a processing state
                Swal.fire({
                    title: 'Processing Transaction...',
                    text: 'Please do not close this window.',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading(),
                    timer: 3000 // Simulate a 3-second processing time
                }).then(() => {
                    if (Math.random() > 0.15) { // 85% chance of success
                        resolve('Payment approved');
                    } else {
                        reject('Transaction Declined');
                    }
                });
            } else {
                // User clicked cancel
                reject('Payment cancelled by user');
            }
        });
    });
}
async function handlePayment(method) {
    logLine(`Processing ${method} payment...`);
    try {
        if (method === 'card') {
            await simulateCardPayment();
        }
        Swal.fire({
            title: `Processing ${method.charAt(0).toUpperCase() + method.slice(1)} Payment...`,
            text: 'Please wait, do not close this window.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
        const requestBody = {
            ticket_id: state.ticketDetails.ticket_id,
            amount_paid: state.calculatedFee,
            payment_method: method
        };

        const paymentResult = await fetch(`${API_BASE_URL}/exit/payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        }).then(res => {
            if (!res.ok) return res.json().then(err => Promise.reject(err));
            return res.json();
        });

        Swal.close();

        if (paymentResult.payment_status === 'successful') {
            setSuccessStatus('Payment Successful', 'The barrier is opening. Please exit safely.');
        } else {
            setFailureStatus('Payment Failed', 'The transaction was declined. Please try another method.');
        }

    } catch (error) {
        console.error("Payment processing failed:", error);
        Swal.close();
        setFailureStatus('Payment Failed', error.detail || 'An unexpected error occurred.');
    }
}

let upiQR;

function showUpiQr() {
    const qrContainer = document.getElementById('upiQr');
    qrContainer.innerHTML = '';
    const upiAmount = state.calculatedFee.toFixed(2);
    const upiLink = 'upi://pay?pa=9935078388@ptsbi&pn=MP&am=' + encodeURIComponent(upiAmount) + '&cu=INR&tn=' + encodeURIComponent('Exit ' + state.ticketDetails.ticketId);
    upiQR = new QRCode(qrContainer, {
        text: upiLink,
        width: 200,
        height: 200,
        colorDark: '#0b1220',
        colorLight: '#ffffff'
    });
    document.getElementById('upiSection').classList.remove('d-none');
}


function setSuccessStatus(title, msg) {
    stopTimer();
    document.getElementById('statusIcon').className = 'fa-solid fa-circle-check status-icon text-success';
    document.getElementById('statusTitle').textContent = title;
    document.getElementById('statusMessage').textContent = msg;
    setStep('status');
    logLine('Payment complete. Opening barrier...');
    showToast('Barrier opening. Drive safely.');
    // auto reset to scan after delay
    setTimeout(() => {
        setStep('scan');
    }, 7000);
}

function setFailureStatus(title, msg) {
    document.getElementById('statusIcon').className = 'fa-solid fa-circle-xmark status-icon text-danger';
    document.getElementById('statusTitle').textContent = title;
    document.getElementById('statusMessage').textContent = msg;
    setStep('status');
    logLine('Payment failed. Awaiting next action.');
    // Offer retry by returning to payment after 4s
    setTimeout(() => {
        setStep('payment');
    }, 4000);
}

function notifyAttendant() {
    stopTimer();
    Swal.fire({
        icon: 'info',
        title: 'Attendant Notified',
        text: 'An attendant has been alerted to assist you at the gate.',
        confirmButtonText: 'OK'
    });
    showToast('Attendant notified');
    setStep('assistance');
    logLine('Assistance requested. Attendant notified.');
}

// Event bindings
document.getElementById('btnShowManual').addEventListener('click', () => {
    document.getElementById('manualPanel').classList.add('show');
});
document.getElementById('btnHideManual').addEventListener('click', () => {
    document.getElementById('manualPanel').classList.remove('show');
});
document.getElementById('btnSubmitTicketId').addEventListener('click', () => {
    const ticketId = document.getElementById('ticketIdInput').value;
    validateAndShowPayment(ticketId);
});

document.getElementById('btnSimulateScan').addEventListener('click', () => {
    // We'll simulate scanning a valid ticket ID for testing.
    // In a real scenario, this would come from a QR scanner.
    const randomTestTicketId = Math.floor(Math.random() * 20 + 1); // Assumes ticket IDs 1-20 exist
    validateAndShowPayment(randomTestTicketId);
});

document.getElementById('btnHelpLost').addEventListener('click', notifyAttendant);
document.getElementById('btnCallAttendant').addEventListener('click', notifyAttendant);

document.getElementById('btnCancelPayment').addEventListener('click', () => {
    setStep('scan');
});

document.getElementById('btnConfirmUpiPayment').addEventListener('click', () => {
    handlePayment('upi');
});

document.getElementById('btnAssistCancel').addEventListener('click', () => {
    setStep('scan');
});
document.getElementById('btnAssistCall').addEventListener('click', notifyAttendant);

document.getElementById('btnNewExit').addEventListener('click', () => {
    setStep('scan');
});

// Payment method selection
// Find the event listener for '.payment-option' and REPLACE it with this:
document.querySelectorAll('#paymentButtons .payment-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const method = e.currentTarget.getAttribute('data-method');
        state.selectedPaymentMethod = method;

        document.querySelectorAll('#paymentButtons .payment-option').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        if (method === 'upi') {
            showUpiQr(); // Show the QR code, but don't process yet
        } else {
            // For Card and Cash, process immediately
            document.getElementById('upiSection').classList.add('d-none');
            handlePayment(method);
        }
    });
});

document.getElementById('btnConfirmUpiPayment').addEventListener('click', () => {
    handlePayment('upi');
});
// Language selection (demo)
document.querySelectorAll('.dropdown-menu [data-lang]').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const lang = e.currentTarget.getAttribute('data-lang');
        showToast('Language set to ' + (lang === 'en' ? 'English' : 'हिंदी'));
    });
});
document.addEventListener('DOMContentLoaded', function () {
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', function () {
            // In a real app, you would gather form data and send it to your server here.
            // Example: const name = document.getElementById('contactName').value;

            // For now, we'll just show a success message.
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
// Initialize
setStep('scan');