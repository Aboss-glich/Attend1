const forgotForm = document.querySelector('#forgotForm');
const forgotMessage = document.querySelector('#forgotMessage');
forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    forgotMessage.textContent = '';
    const button = forgotForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const response = await fetch('/api/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.querySelector('#forgotUsername').value, email: document.querySelector('#forgotEmail').value }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not submit the recovery request.');
        forgotMessage.textContent = result.message || 'Please contact the school administrator.';
    } catch (error) {
        forgotMessage.textContent = error instanceof TypeError ? 'Cannot reach the server. Open this app through http://localhost:3000.' : error.message;
    } finally {
        button.disabled = false;
    }
});