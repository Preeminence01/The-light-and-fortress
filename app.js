async function api(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
}

function showMessage(targetId, message, type = "success") {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = `<div class="alert alert-${type}" role="alert">${message}</div>`;
}

function memberImage(member) {
    return member.profilePicture || "ChatGPT Image Jun 18, 2026, 01_53_04 AM.png";
}

function formatDate(value) {
    return new Date(value).toLocaleString();
}

async function setupAuthNav() {
    const area = document.querySelector("[data-auth-nav]");
    if (!area) return;
    const { member } = await api("/api/me");
    area.innerHTML = member
        ? `<a class="nav-link" href="dashboard.html">Dashboard</a><a class="nav-link" href="/logout">Logout</a>`
        : `<a class="nav-link" href="login.html">Login</a><a class="nav-link" href="register.html">Register</a>`;
}

async function requireMember() {
    const { member } = await api("/api/me");
    if (!member) window.location.href = "login.html";
    return member;
}

function initRegister() {
    const form = document.getElementById("registerForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await api("/api/register", { method: "POST", body: new FormData(form) });
            showMessage("registerMessage", "Registration successful. You can now login.", "success");
            form.reset();
        } catch (error) {
            showMessage("registerMessage", error.message, "danger");
        }
    });
}

function initLogin() {
    const form = document.getElementById("loginForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const body = new URLSearchParams(new FormData(form));
            await api("/api/login", { method: "POST", body });
            window.location.href = "dashboard.html";
        } catch (error) {
            showMessage("loginMessage", error.message, "danger");
        }
    });
}

async function initDashboard() {
    const dashboard = document.getElementById("dashboard");
    if (!dashboard) return;
    const member = await requireMember();
    dashboard.innerHTML = `
        <div class="member-profile card shadow-sm">
            <img src="${memberImage(member)}" alt="${member.name}">
            <div>
                <p class="eyebrow">Member dashboard</p>
                <h2>${member.name}</h2>
                <p>${member.role || "Member"} | ${member.location || "No location added"}</p>
                <p>${member.bio || "No bio added yet."}</p>
            </div>
        </div>
    `;
    await Promise.all([loadUpdates(), loadNotifications(), loadUploads()]);
}

async function loadMembers() {
    const list = document.getElementById("membersList");
    if (!list) return;
    await requireMember();
    const { members } = await api("/api/members");
    list.innerHTML = members.map((member) => `
        <div class="col-md-6 col-lg-4">
            <article class="member-card card shadow-sm h-100">
                <img src="${memberImage(member)}" alt="${member.name}">
                <div class="card-body">
                    <h3>${member.name}</h3>
                    <p><strong>Role:</strong> ${member.role || "Member"}</p>
                    <p><strong>Email:</strong> ${member.email}</p>
                    <p><strong>Phone:</strong> ${member.phone || "Not added"}</p>
                    <p><strong>Location:</strong> ${member.location || "Not added"}</p>
                    <p>${member.bio || ""}</p>
                </div>
            </article>
        </div>
    `).join("");
}

async function loadUpdates() {
    const list = document.getElementById("updatesList");
    if (!list) return;
    const { updates } = await api("/api/updates");
    list.innerHTML = updates.length ? updates.map((update) => `
        <article class="copy-card card shadow-sm">
            <div class="card-body">
                <h3>${update.title}</h3>
                <p>${update.message}</p>
                <small>Posted by ${update.memberName} on ${formatDate(update.createdAt)}</small>
            </div>
        </article>
    `).join("") : `<p class="text-muted">No updates yet.</p>`;
}

async function loadNotifications() {
    const list = document.getElementById("notificationsList");
    if (!list) return;
    const { notifications } = await api("/api/notifications");
    list.innerHTML = notifications.length ? notifications.map((note) => `
        <article class="support-action card shadow-sm">
            <h3>${note.title}</h3>
            <p>${note.message}</p>
            <small>${formatDate(note.createdAt)}</small>
        </article>
    `).join("") : `<p class="text-muted">No notifications yet.</p>`;
}

async function loadUploads() {
    const list = document.getElementById("uploadsList");
    if (!list) return;
    const { uploads } = await api("/api/uploads");
    list.innerHTML = uploads.length ? uploads.map((upload) => {
        const media = upload.fileType.startsWith("video/")
            ? `<video controls src="${upload.fileUrl}"></video>`
            : `<img src="${upload.fileUrl}" alt="${upload.title}">`;
        return `
            <article class="media-card card shadow-sm">
                ${media}
                <div class="card-body">
                    <h3>${upload.title}</h3>
                    <p>Uploaded by ${upload.memberName}</p>
                    <small>${formatDate(upload.createdAt)}</small>
                </div>
            </article>
        `;
    }).join("") : `<p class="text-muted">No uploads yet.</p>`;
}

function initUpdateForm() {
    const form = document.getElementById("updateForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await api("/api/updates", { method: "POST", body: new URLSearchParams(new FormData(form)) });
            form.reset();
            showMessage("updateMessage", "Update posted.", "success");
            await loadUpdates();
            await loadNotifications();
        } catch (error) {
            showMessage("updateMessage", error.message, "danger");
        }
    });
}

function initUploadForm() {
    const form = document.getElementById("uploadForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await api("/api/uploads", { method: "POST", body: new FormData(form) });
            form.reset();
            showMessage("uploadMessage", "Media uploaded.", "success");
            await loadUploads();
            await loadNotifications();
        } catch (error) {
            showMessage("uploadMessage", error.message, "danger");
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    setupAuthNav();
    initRegister();
    initLogin();
    initDashboard();
    loadMembers();
    initUpdateForm();
    initUploadForm();
});
