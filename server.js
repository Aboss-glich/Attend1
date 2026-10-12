const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const root = __dirname;
const defaultPort = Number(process.env.PORT || 3000);
const dataFile = path.join(root, 'storage.json');
const backupFile = path.join(root, 'storage.json.backup');
const authFile = path.join(root, 'auth-users.json');
const sessions = new Map();
const attendanceSessions = new Map();
let users = [];

function loadUsers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (error) {}
  return [];
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, storedHash) {
  const [salt, expected] = String(storedHash || '').split(':');
  if (typeof password !== 'string' || !salt || !expected || !/^[a-f0-9]{128}$/i.test(expected)) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

users = loadUsers();

const defaultData = {
  students: {
    'Class 10-A': [
      { name: 'Aarav Sharma', roll: '01', color: 'green', rate: 96 },
      { name: 'Diya Patel', roll: '02', color: 'pink', rate: 94 },
      { name: 'Kabir Singh', roll: '03', color: 'blue', rate: 89 },
      { name: 'Meera Joshi', roll: '04', color: 'purple', rate: 82 },
      { name: 'Rohan Verma', roll: '05', color: 'orange', rate: 98 },
      { name: 'Ishita Rao', roll: '06', color: 'yellow', rate: 91 }
    ],
    'Class 10-B': [
      { name: 'Vivaan Mehta', roll: '01', color: 'blue', rate: 93 },
      { name: 'Anaya Shah', roll: '02', color: 'pink', rate: 97 },
      { name: 'Arjun Nair', roll: '03', color: 'orange', rate: 88 },
      { name: 'Sara Khan', roll: '04', color: 'purple', rate: 91 }
    ],
    'Class 9-A': [
      { name: 'Aditya Rao', roll: '01', color: 'green', rate: 90 },
      { name: 'Myra Kapoor', roll: '02', color: 'yellow', rate: 95 },
      { name: 'Reyansh Das', roll: '03', color: 'blue', rate: 86 }
    ]
  },
  attendance: {},
  leaves: [],
  settings: {},
  teachers: [],
  parents: {},
  classMetadata: {}
};

function ensureStorageFile() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

function readStorage() {
  ensureStorageFile();
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      students: parsed.students || defaultData.students,
      attendance: parsed.attendance || defaultData.attendance,
      leaves: parsed.leaves || defaultData.leaves,
      settings: parsed.settings || defaultData.settings,
      teachers: parsed.teachers || defaultData.teachers,
      parents: parsed.parents || defaultData.parents,
      classMetadata: parsed.classMetadata || defaultData.classMetadata
    };
  } catch (error) {
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function writeStorage(data) {
  const temporaryFile = `${dataFile}.tmp`;
  if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, backupFile);
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporaryFile, dataFile);
}

function validDataShape(data) {
  return data && typeof data === 'object' && !Array.isArray(data) && data.students && typeof data.students === 'object' && !Array.isArray(data.students) && Object.values(data.students).every(Array.isArray) && data.attendance && typeof data.attendance === 'object' && !Array.isArray(data.attendance);
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validAttendanceRecord(record, students) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const validRolls = new Set(students.map((student) => student.roll));
  return Object.entries(record).every(([roll, value]) => validRolls.has(roll) && value && ['unmarked', 'present', 'late', 'absent'].includes(value.status) && (value.checkIn === undefined || typeof value.checkIn === 'string'));
}

function validLeaveEntry(leave) {
  if (!leave || typeof leave !== 'object' || Array.isArray(leave)) return false;
  if (typeof leave.id !== 'string' || !leave.id.trim()) return false;
  if (typeof leave.student !== 'string' || !leave.student.trim()) return false;
  if (typeof leave.className !== 'string' || !leave.className.trim()) return false;
  if (typeof leave.from !== 'string' || !isDate(leave.from)) return false;
  if (typeof leave.to !== 'string' || !isDate(leave.to)) return false;
  if (new Date(`${leave.to}T00:00:00`) < new Date(`${leave.from}T00:00:00`)) return false;
  if (typeof leave.reason !== 'string' || !leave.reason.trim()) return false;
  if (!['pending', 'approved', 'rejected'].includes(leave.status)) return false;
  return true;
}

function leaveAccessAllowed(user, leave, data) {
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.role === 'teacher') return assignedClasses(user, data).includes(leave.className);
  if (user.role === 'student') return leave.student === user.name && leave.className === user.className;
  return false;
}

app.use(express.json());
app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') return response.status(400).json({ error: 'Request body must be valid JSON' });
  next(error);
});

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function currentUser(request) {
  const token = parseCookies(request).attendly_session;
  return token ? sessions.get(token) : null;
}

function allowedPath(user, requestPath) {
  if (user.role === 'owner') return true;
  if (user.role === 'admin') return requestPath !== '/settings.html';
  if (user.role === 'teacher') return !['/classes.html', '/leaves.html', '/parents.html', '/teachers.html', '/settings.html'].includes(requestPath);
  if (user.role === 'staff') return ['/staff-portal.html', '/dashboard.html', '/reports.html'].includes(requestPath);
  return ['/student-portal.html', '/student-attendance.html', '/qr-checkin.html'].includes(requestPath);
}

function assignedClasses(user, data) {
  if (user.role === 'student') return user.className && data.students[user.className] ? [user.className] : [];
  if (user.role !== 'teacher') return Object.keys(data.students);
  const teacher = data.teachers.find((item) => item.name.toLowerCase() === user.name.toLowerCase());
  return teacher?.className ? [teacher.className] : ['Class 10-A'];
}

function scopedData(user, data) {
  if (user.role === 'owner') return data;
  if (user.role === 'admin') return data;
  if (user.role === 'student') {
    const students = data.students[user.className] || [];
    const student = students.find((item) => item.roll === user.roll);
    return { ...data, students: student ? { [user.className]: [student] } : {}, attendance: Object.fromEntries(Object.entries(data.attendance).map(([key, records]) => [key, records[user.roll] ? { [user.roll]: records[user.roll] } : {}]).filter(([, records]) => Object.keys(records).length)), leaves: data.leaves.filter((item) => item.student === user.name && item.className === user.className), parents: {} };
  }
  const allowedClasses = new Set(assignedClasses(user, data));
  return {
    ...data,
    students: Object.fromEntries(Object.entries(data.students).filter(([className]) => allowedClasses.has(className))),
    attendance: Object.fromEntries(Object.entries(data.attendance).filter(([key]) => allowedClasses.has(key.split('|')[0]))),
    leaves: user.role === 'teacher' ? data.leaves.filter((item) => allowedClasses.has(item.className)) : [],
    parents: user.role === 'teacher' ? Object.fromEntries(Object.entries(data.parents).filter(([key]) => allowedClasses.has(key.split('|')[0]))) : {},
    teachers: user.role === 'teacher' ? data.teachers.filter((item) => !item.className || allowedClasses.has(item.className)) : []
  };
}

function requireAuth(request, response, next) {
  const user = currentUser(request);
  if (!user) return response.status(401).json({ error: 'Authentication required' });
  request.user = user;
  next();
}

app.use((req, res, next) => {
  if (/%2e|%2f|%5c/i.test(req.originalUrl)) {
    return res.status(400).send('Invalid path');
  }
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'attendly',
    timestamp: new Date().toISOString(),
    mode: 'backend-ready'
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  const user = users.find((item) => item.username === normalizedUsername && passwordMatches(password, item.passwordHash));
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username: user.username, name: user.name, role: user.role, className: user.className, roll: user.roll });
  res.setHeader('Set-Cookie', `attendly_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
  res.json({ user: sessions.get(token) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).attendly_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'attendly_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

function publicUser(user) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

app.get('/api/users', requireAuth, (req, res) => {
  if (!['owner', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Owner or teacher access required' });
  const data = readStorage();
  const visible = req.user.role === 'owner' ? users : users.filter((user) => user.role === 'student' && user.className === assignedClasses(req.user, data)[0]);
  res.json({ users: visible.map(publicUser) });
});

app.post('/api/users', requireAuth, (req, res) => {
  const { username, name, password, role, className, roll, email, phone, subject } = req.body || {};
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!/^[a-z0-9._-]{3,32}$/.test(normalizedUsername) || typeof name !== 'string' || !name.trim() || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Username, name, and an 8+ character password are required' });
  if (!['teacher', 'staff', 'student'].includes(role)) return res.status(400).json({ error: 'Invalid account role' });
  const data = readStorage();
  if (users.some((user) => user.username === normalizedUsername)) return res.status(409).json({ error: 'Username already exists' });
  if (role === 'student') {
    const allowed = assignedClasses(req.user, data);
    if (!className || !allowed.includes(className) || !data.students[className]?.some((student) => student.roll === roll)) return res.status(403).json({ error: 'Student must belong to an assigned class' });
  } else if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can create staff accounts' });
  const user = { username: normalizedUsername, name: name.trim(), role, passwordHash: hashPassword(password), ...(className ? { className } : {}), ...(roll ? { roll } : {}), ...(email ? { email: String(email).trim() } : {}), ...(phone ? { phone: String(phone).trim() } : {}) };
  users.push(user);
  fs.writeFileSync(authFile, JSON.stringify(users, null, 2), 'utf8');
  if (role === 'teacher') {
    data.teachers.push({ id: `teacher-${Date.now()}`, name: user.name, subject: String(subject || 'General').trim(), className: className || '', phone: phone || '' });
    writeStorage(data);
  }
  res.status(201).json({ user: publicUser(user) });
});

app.put('/api/users/:username/password', requireAuth, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can reset passwords' });
  const user = users.find((item) => item.username === req.params.username.toLowerCase());
  const password = req.body?.password;
  if (!user) return res.status(404).json({ error: 'Account not found' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  user.passwordHash = hashPassword(password);
  fs.writeFileSync(authFile, JSON.stringify(users, null, 2), 'utf8');
  res.json({ ok: true, message: 'Password reset successfully' });
});

app.post('/api/forgot-password', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const user = users.find((item) => item.username === username && String(item.email || '').toLowerCase() === email);
  res.json({ ok: true, message: user ? 'Recovery request received. The owner must reset this account password.' : 'Recovery request received. If the account exists, the owner will review it.' });
});

app.put('/api/change-password', requireAuth, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can change account passwords' });
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = users.find((item) => item.username === req.user.username);
  if (!user || !passwordMatches(currentPassword, user.passwordHash)) return res.status(401).json({ error: 'Current password is incorrect' });
  user.passwordHash = hashPassword(newPassword);
  fs.writeFileSync(authFile, JSON.stringify(users, null, 2), 'utf8');
  sessions.delete(parseCookies(req).attendly_session);
  res.setHeader('Set-Cookie', 'attendly_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true, message: 'Password changed. Please sign in again.' });
});

app.post('/api/attendance-session', requireAuth, (req, res) => {
  if (!['admin', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Teacher or admin access required' });
  const { className, date } = req.body || {};
  const data = readStorage();
  if (!data.students[className] || !isDate(date) || !assignedClasses(req.user, data).includes(className)) return res.status(400).json({ error: 'A valid assigned class and date are required' });
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000;
  attendanceSessions.set(token, { className, date, expiresAt });
  res.json({ token, className, date, expiresAt });
});

app.post('/api/qr-checkin', requireAuth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student access required' });
  const session = attendanceSessions.get(req.body?.token);
  if (!session || session.expiresAt < Date.now()) return res.status(400).json({ error: 'This QR session has expired. Ask your teacher for a new QR code.' });
  if (session.className !== req.user.className) return res.status(403).json({ error: 'This QR code is for another class.' });
  const data = readStorage();
  const key = `${session.className}|${session.date}`;
  data.attendance[key] = data.attendance[key] || {};
  data.attendance[key][req.user.roll] = { status: 'present', checkIn: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) + ' IST' };
  writeStorage(data);
  res.json({ ok: true, className: session.className, date: session.date });
});

app.get('/api/classes', requireAuth, (req, res) => {
  const data = readStorage();
  res.json({ classes: assignedClasses(req.user, data) });
});

app.get('/api/students', requireAuth, (req, res) => {
  const { className } = req.query;
  const data = readStorage();
  const visible = scopedData(req.user, data);
  const selected = className ? visible.students[className] || [] : Object.values(visible.students).flat();
  res.json({ className, students: selected });
});

app.post('/api/attendance', requireAuth, (req, res) => {
  const { className, date, record } = req.body || {};
  const data = readStorage();
  if (req.user.role === 'staff' || req.user.role === 'student' || !assignedClasses(req.user, data).includes(className)) return res.status(403).json({ error: 'You cannot edit this class' });
  if (!className || !data.students[className]) {
    return res.status(400).json({ error: 'A valid className is required' });
  }
  if (!isDate(date) || !validAttendanceRecord(record, data.students[className])) {
    return res.status(400).json({ error: 'date or attendance record is invalid' });
  }

  data.attendance[`${className}|${date}`] = record;
  writeStorage(data);

  res.json({ ok: true, message: 'Attendance saved', className, date, record });
});

app.get('/api/attendance/:className/:date', requireAuth, (req, res) => {
  const { className, date } = req.params;
  const data = readStorage();
  if (!assignedClasses(req.user, data).includes(className)) return res.status(403).json({ error: 'Class access denied' });
  const key = `${className}|${date}`;
  const record = data.attendance[key] || {};
  res.json({ [key]: req.user.role === 'student' ? (record[req.user.roll] ? { [req.user.roll]: record[req.user.roll] } : {}) : record });
});

app.get('/api/leaves', requireAuth, (req, res) => {
  const data = readStorage();
  res.json({ leaves: scopedData(req.user, data).leaves || [] });
});

app.post('/api/leaves', requireAuth, (req, res) => {
  const data = readStorage();
  const { student, className, from, to, reason, status } = req.body || {};
  if (!['owner', 'admin', 'teacher', 'student'].includes(req.user.role)) return res.status(403).json({ error: 'Leave access denied' });
  const nextStudent = req.user.role === 'student' ? req.user.name : typeof student === 'string' ? student.trim() : '';
  const nextClass = req.user.role === 'student' ? req.user.className : typeof className === 'string' ? className.trim() : '';
  const nextFrom = typeof from === 'string' ? from.trim() : '';
  const nextTo = typeof to === 'string' ? to.trim() : '';
  const nextReason = typeof reason === 'string' ? reason.trim() : '';
  if (!nextStudent || !nextClass || !isDate(nextFrom) || !isDate(nextTo) || new Date(`${nextTo}T00:00:00`) < new Date(`${nextFrom}T00:00:00`)) {
    return res.status(400).json({ error: 'Student, class, and valid from/to dates are required' });
  }
  if (req.user.role === 'teacher' && !assignedClasses(req.user, data).includes(nextClass)) return res.status(403).json({ error: 'Class access denied' });
  if (req.user.role === 'student' && nextClass !== req.user.className) return res.status(403).json({ error: 'You can only submit leave for your own class' });
  if (!nextReason || nextReason.length > 200) return res.status(400).json({ error: 'Reason must be between 1 and 200 characters' });
  const leave = {
    id: `leave-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    student: nextStudent,
    className: nextClass,
    from: nextFrom,
    to: nextTo,
    reason: nextReason,
    status: req.user.role === 'student' ? 'pending' : (status === 'approved' || status === 'rejected' ? status : 'pending')
  };
  data.leaves.unshift(leave);
  writeStorage(data);
  res.status(201).json({ leave });
});

app.patch('/api/leaves/:id', requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['owner', 'admin', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Leave approval access denied' });
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Status must be approved, rejected, or pending' });
  const data = readStorage();
  const leave = data.leaves.find((item) => item.id === req.params.id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });
  if (req.user.role === 'teacher' && !assignedClasses(req.user, data).includes(leave.className)) return res.status(403).json({ error: 'Class access denied' });
  leave.status = status;
  writeStorage(data);
  res.json({ leave });
});

app.delete('/api/leaves/:id', requireAuth, (req, res) => {
  if (!['owner', 'admin', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Leave access denied' });
  const data = readStorage();
  const index = data.leaves.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Leave request not found' });
  const leave = data.leaves[index];
  if (req.user.role === 'teacher' && !assignedClasses(req.user, data).includes(leave.className)) return res.status(403).json({ error: 'Class access denied' });
  data.leaves.splice(index, 1);
  writeStorage(data);
  res.json({ ok: true, message: 'Leave request deleted' });
});

app.get('/api/data', requireAuth, (req, res) => {
  res.json(scopedData(req.user, readStorage()));
});

app.get('/api/backup', requireAuth, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  res.json({ version: 1, createdAt: new Date().toISOString(), data: readStorage() });
});

app.put('/api/restore', requireAuth, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  const incoming = req.body?.data || req.body;
  if (!validDataShape(incoming)) return res.status(400).json({ error: 'Backup file is invalid or incomplete' });
  const current = readStorage();
  const restored = {
    students: incoming.students,
    attendance: incoming.attendance,
    leaves: Array.isArray(incoming.leaves) ? incoming.leaves : current.leaves,
    settings: incoming.settings && typeof incoming.settings === 'object' ? incoming.settings : current.settings,
    teachers: Array.isArray(incoming.teachers) ? incoming.teachers : current.teachers,
    parents: incoming.parents && typeof incoming.parents === 'object' ? incoming.parents : current.parents,
    classMetadata: incoming.classMetadata && typeof incoming.classMetadata === 'object' ? incoming.classMetadata : current.classMetadata
  };
  writeStorage(restored);
  res.json({ ok: true, message: 'Backup restored successfully' });
});

app.put('/api/data', requireAuth, (req, res) => {
  if (!['owner', 'admin', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Owner, admin, or teacher access required' });
  const incoming = req.body || {};
  const current = readStorage();
  const scope = new Set(assignedClasses(req.user, current));
  if (req.user.role === 'teacher' && incoming.students && Object.keys(incoming.students).some((className) => !scope.has(className))) return res.status(403).json({ error: 'Class access denied' });
  if (req.user.role === 'teacher' && incoming.attendance && Object.keys(incoming.attendance).some((key) => !scope.has(key.split('|')[0]))) return res.status(403).json({ error: 'Attendance access denied' });
  if (incoming.leaves && !Array.isArray(incoming.leaves)) return res.status(400).json({ error: 'Leave data must be an array' });
  if (Array.isArray(incoming.leaves) && incoming.leaves.some((leave) => !validLeaveEntry(leave))) return res.status(400).json({ error: 'One or more leave entries are invalid' });
  if (req.user.role === 'teacher' && Array.isArray(incoming.leaves) && incoming.leaves.some((leave) => !scope.has(leave.className))) return res.status(403).json({ error: 'Leave class access denied' });
  const next = {
    students: req.user.role === 'owner' || req.user.role === 'admin' ? (incoming.students || current.students) : { ...current.students, ...(incoming.students || {}) },
    attendance: req.user.role === 'owner' || req.user.role === 'admin' ? (incoming.attendance || current.attendance) : { ...current.attendance, ...(incoming.attendance || {}) },
    leaves: incoming.leaves || current.leaves,
    settings: incoming.settings || current.settings,
    teachers: incoming.teachers || current.teachers,
    parents: incoming.parents || current.parents,
    classMetadata: incoming.classMetadata || current.classMetadata
  };

  writeStorage(next);
  res.json(next);
});

app.use((req, res, next) => {
  if (['/server.js', '/storage.json', '/package.json'].includes(req.path)) {
    return res.status(404).send('Not found');
  }
  next();
});

app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path === '/forgot-password.html' || req.path === '/api/login' || req.path === '/api/forgot-password' || req.path === '/api/logout' || req.path === '/api/health') return next();
  if (req.path === '/' && !currentUser(req)) return res.redirect('/login.html');
  if (req.path.endsWith('.html')) {
    const user = currentUser(req);
    if (!user) return res.redirect('/login.html');
    if (!allowedPath(user, req.path)) return res.redirect('/dashboard.html');
  }
  next();
});

app.use(express.static(root, { index: false }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();

  const safePath = req.path === '/' ? '/dashboard.html' : req.path;
  const relative = safePath.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return res.status(403).send('Forbidden');
  }

  const finalPath = fs.existsSync(resolved) ? resolved : path.join(root, 'dashboard.html');
  res.sendFile(finalPath);
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Attendly backend is running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Retrying on http://localhost:${nextPort}`);
      startServer(nextPort);
      return;
    }

    throw error;
  });
}

startServer(defaultPort);
