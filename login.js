const form = document.querySelector('#loginForm');
const errorMessage = document.querySelector('#loginError');

const isLiveServer = ['5500', '5501'].includes(window.location.port);
const isLocalFile = window.location.protocol === 'file:';

if (isLiveServer || isLocalFile) {
    window.location.replace('http://localhost:3000/login.html');
} else form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';
    const button = form.querySelector('button');
    button.disabled = true;
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: document.querySelector('#username').value.trim().toLowerCase(), password: document.querySelector('#password').value })
        });
        const raw = await response.text();
        let data;
        try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('Server returned an invalid response. Please restart the app.'); }
        if (!response.ok) throw new Error(data.error || `Sign-in failed (${response.status})`);
        if (!data.user?.role) throw new Error('Sign-in response was incomplete. Please restart the app.');
        const destinations = { owner: '/dashboard.html', admin: '/dashboard.html', teacher: '/teacher-portal.html', staff: '/staff-portal.html', student: '/student-portal.html' };
        window.location.href = destinations[data.user.role] || '/login.html';
    } catch (error) {
        errorMessage.textContent = error instanceof TypeError ? 'Cannot reach the server. Open http://localhost:3000/login.html.' : error.message;
        button.disabled = false;
    }
});
