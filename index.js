const API_BASE_URL = 'http://127.0.0.1:8000';
const form = document.getElementById('loginForm');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const errorAlert = document.getElementById('errorAlert');
const errorText = document.getElementById('errorText');
const btn = document.getElementById('loginBtn');
const spinner = document.getElementById('btnSpinner');
const togglePassword = document.getElementById('togglePassword');

// Toggle password visibility
togglePassword.addEventListener('click', () => {
    const isPwd = passwordEl.getAttribute('type') === 'password';
    passwordEl.setAttribute('type', isPwd ? 'text' : 'password');
    togglePassword.classList.toggle('fa-eye');
    togglePassword.classList.toggle('fa-eye-slash');
    togglePassword.setAttribute('aria-pressed', isPwd ? 'true' : 'false');
});

// Helper: UI Loading state
function setLoading(isLoading) {
    if (isLoading) {
        spinner.classList.remove('d-none');
        btn.setAttribute('disabled', 'disabled');
        usernameEl.setAttribute('disabled', 'disabled');
        passwordEl.setAttribute('disabled', 'disabled');
    } else {
        spinner.classList.add('d-none');
        btn.removeAttribute('disabled');
        usernameEl.removeAttribute('disabled');
        passwordEl.removeAttribute('disabled');
    }
}

// Validate required fields
function validate() {
    let valid = true;
    if (!usernameEl.value.trim()) {
        usernameEl.classList.add('is-invalid');
        valid = false;
    } else {
        usernameEl.classList.remove('is-invalid');
    }
    if (!passwordEl.value.trim()) {
        passwordEl.classList.add('is-invalid');
        valid = false;
    } else {
        passwordEl.classList.remove('is-invalid');
    }
    return valid;
}

// Hide inline error if user edits
[usernameEl, passwordEl].forEach(el => {
    el.addEventListener('input', () => {
        el.classList.remove('is-invalid');
        errorAlert.classList.add('d-none');
    });
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorAlert.classList.add('d-none');

    if (!validate()) {
        errorText.textContent = 'Please fill in both fields.';
        errorAlert.classList.remove('d-none');
        return;
    }

    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    setLoading(true);

    try {
        // Your FastAPI backend expects form data, not JSON, for login.
        // We create it using URLSearchParams.
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        // Make the real API call to the /auth/login endpoint
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            // If login fails (e.g., 401 Unauthorized), handle the error
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Incorrect username or password');
        }

        const authData = await response.json();

        // On success, save the access token to localStorage
        localStorage.setItem('accessToken', authData.access_token);
        localStorage.setItem('userRole', authData.user_role);

        const redirectMap = {
            'Administrator': './admin_dashboard.html',
            'Attendant': './entry_gate.html',
            'manager': './reports_page.html',
            'records': './records_search.html',
        };
        const redirectUrl = redirectMap[authData.user_role] || './admin_dashboard.html';

        Swal.fire({
            title: 'Welcome',
            text: `${authData.user_role} authenticated successfully. Redirecting...`,
            icon: 'success',
            timer: 1400,
            showConfirmButton: false
        });

        setTimeout(() => {
            window.location.href = redirectUrl;
        }, 1200);

    } catch (error) {
        errorText.textContent = error.message;
        errorAlert.classList.remove('d-none');
        Swal.fire({
            title: 'Login Failed',
            text: error.message,
            icon: 'error',
            confirmButtonText: 'Retry'
        });
        setLoading(false);
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