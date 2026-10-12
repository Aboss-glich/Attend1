const LEAVE_KEY = 'attendly-leaves-v1';
const indiaDateParts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const indiaDateValues = Object.fromEntries(indiaDateParts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
const today = `${indiaDateValues.year}-${indiaDateValues.month}-${indiaDateValues.day}`;
let leaves = JSON.parse(localStorage.getItem(LEAVE_KEY) || 'null');
if (!Array.isArray(leaves)) {
    leaves = [
        { id: 'leave-1', student: 'Meera Joshi', className: 'Class 10-A', from: '2026-08-24', to: '2026-08-25', reason: 'Medical leave', status: 'pending' },
        { id: 'leave-2', student: 'Aarav Sharma', className: 'Class 10-A', from: '2026-08-10', to: '2026-08-10', reason: 'Family emergency', status: 'approved' }
    ];
    localStorage.setItem(LEAVE_KEY, JSON.stringify(leaves));
}
let activeStatus = 'all';
const rows = document.querySelector('#leaveRows');
const search = document.querySelector('#leaveSearch');
const dialog = document.querySelector('#leaveDialog');
const form = document.querySelector('#leaveForm');
function save() {
    localStorage.setItem(LEAVE_KEY, JSON.stringify(leaves));
    fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leaves }) }).catch(() => {});
}
async function loadLeaves() {
    try {
        const response = await fetch('/api/leaves');
        if (!response.ok) {
            const backup = await fetch('/api/data').catch(() => null);
            if (backup && backup.ok) {
                const data = await backup.json();
                if (Array.isArray(data.leaves)) {
                    leaves = data.leaves;
                    localStorage.setItem(LEAVE_KEY, JSON.stringify(leaves));
                }
            }
            return;
        }
        const data = await response.json();
        if (Array.isArray(data.leaves)) {
            leaves = data.leaves;
            localStorage.setItem(LEAVE_KEY, JSON.stringify(leaves));
        }
    } catch (error) {
        console.warn('Backend unavailable, using local leave data.', error);
    }
}
function daysBetween(from, to) { return Math.max(1, Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1); }
function formatDate(value) { return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function initials(name) { return String(name).split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2); }
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function render() {
    const query = search.value.toLowerCase();
    const visible = leaves.filter((leave) => (activeStatus === 'all' || leave.status === activeStatus) && `${leave.student} ${leave.className} ${leave.reason}`.toLowerCase().includes(query));
    rows.innerHTML = visible.map((leave) => {
        const student = escapeHtml(leave.student);
        const className = escapeHtml(leave.className.replace('Class ', ''));
        const reason = escapeHtml(leave.reason);
        const statusLabel = escapeHtml(leave.status[0].toUpperCase() + leave.status.slice(1));
        const duration = daysBetween(leave.from, leave.to);
        return `<tr><td><div class="student"><span class="student-avatar green">${escapeHtml(initials(leave.student))}</span>${student}</div></td><td>${className}</td><td>${formatDate(leave.from)}${leave.from !== leave.to ? ` - ${formatDate(leave.to)}` : ''}<small class="table-subtext">${duration} day${duration === 1 ? '' : 's'}</small></td><td>${reason}</td><td><span class="leave-status ${escapeHtml(leave.status)}">${statusLabel}</span></td><td><div class="leave-actions">${leave.status === 'pending' ? `<button class="approve" data-id="${escapeHtml(leave.id)}">Approve</button><button class="reject" data-id="${escapeHtml(leave.id)}">Reject</button>` : `<button class="delete-leave" data-id="${escapeHtml(leave.id)}" aria-label="Delete request">×</button>`}</div></td></tr>`;
    }).join('');
    document.querySelector('#leaveEmpty').hidden = visible.length > 0;
    const count = (status) => leaves.filter((leave) => leave.status === status).length;
    document.querySelector('#pendingCount').textContent = count('pending'); document.querySelector('#approvedCount').textContent = count('approved'); document.querySelector('#rejectedCount').textContent = count('rejected'); document.querySelector('#leaveDays').textContent = leaves.filter((leave) => leave.status === 'approved').reduce((sum, leave) => sum + daysBetween(leave.from, leave.to), 0);
    document.querySelector('#allLeaveCount').textContent = leaves.length; document.querySelector('#pendingFilterCount').textContent = count('pending'); document.querySelector('#approvedFilterCount').textContent = count('approved'); document.querySelector('#rejectedFilterCount').textContent = count('rejected');
}
function clearForm() { form.reset(); document.querySelector('#leaveFrom').value = today; document.querySelector('#leaveTo').value = today; }
function message(text) { const element = document.querySelector('#leaveMessage'); element.textContent = text; setTimeout(() => { element.textContent = ''; }, 3000); }
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { activeStatus = button.dataset.status; document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button)); render(); }));
search.addEventListener('input', render);
document.querySelector('#addLeaveButton').addEventListener('click', () => { clearForm(); dialog.showModal(); });
document.querySelector('#closeLeaveDialog').addEventListener('click', () => { dialog.close(); clearForm(); });
document.querySelector('#cancelLeaveDialog').addEventListener('click', () => { dialog.close(); clearForm(); });
rows.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const leaveId = button.dataset.id;
    if (!leaveId) return;
    const action = button.classList.contains('approve') ? 'approved' : button.classList.contains('reject') ? 'rejected' : button.classList.contains('delete-leave') ? 'delete' : null;
    if (!action) return;
    try {
        if (action === 'delete') {
            const response = await fetch(`/api/leaves/${leaveId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
            if (!response.ok) throw new Error('Unable to delete leave request.');
            leaves = leaves.filter((item) => item.id !== leaveId);
            render();
            message('Request deleted.');
            return;
        }
        const response = await fetch(`/api/leaves/${leaveId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action }) });
        if (!response.ok) throw new Error('Unable to update leave status.');
        const { leave } = await response.json();
        const index = leaves.findIndex((item) => item.id === leaveId);
        if (index >= 0) leaves[index] = { ...leaves[index], ...leave };
        render();
        message(action === 'approved' ? 'Leave approved.' : 'Leave rejected.');
    } catch (error) {
        console.error(error);
        message(error.message || 'Action failed.');
    }
});
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const from = document.querySelector('#leaveFrom').value;
    const to = document.querySelector('#leaveTo').value;
    if (to < from) { document.querySelector('#leaveTo').setCustomValidity('End date must be after start date.'); form.reportValidity(); document.querySelector('#leaveTo').setCustomValidity(''); return; }
    const payload = {
        student: document.querySelector('#leaveStudent').value.trim(),
        className: document.querySelector('#leaveClass').value,
        from,
        to,
        reason: document.querySelector('#leaveReason').value.trim()
    };
    try {
        const response = await fetch('/api/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to submit leave request.');
        leaves = [result.leave, ...leaves.filter((item) => item.id !== result.leave.id)];
        dialog.close();
        clearForm();
        render();
        message('Leave request submitted.');
    } catch (error) {
        console.error(error);
        message(error.message || 'Leave request failed.');
    }
});
clearForm();
loadLeaves().then(() => loadClassOptions(['#leaveClass']).then(render));