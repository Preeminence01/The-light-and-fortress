const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const PROFILE_DIR = path.join(UPLOAD_DIR, "profiles");
const MEDIA_DIR = path.join(UPLOAD_DIR, "media");
const DB_FILE = path.join(DATA_DIR, "db.json");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".pdf": "application/pdf"
};

function ensureStorage() {
    [DATA_DIR, UPLOAD_DIR, PROFILE_DIR, MEDIA_DIR].forEach((dir) => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ members: [], sessions: {}, updates: [], notifications: [], uploads: [] }, null, 2));
    }
}

function readDb() {
    ensureStorage();
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
}

function redirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function getCookie(req, name) {
    const cookie = req.headers.cookie || "";
    return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.split("=")[1] || "";
}

function getSession(req, db) {
    const token = getCookie(req, "lf_session");
    if (!token || !db.sessions[token]) return null;
    const member = db.members.find((item) => item.id === db.sessions[token].memberId);
    if (!member) return null;
    return { token, member };
}

function sanitizeMember(member) {
    const { passwordHash, salt, ...safeMember } = member;
    return safeMember;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
    return { salt, passwordHash: hash };
}

function verifyPassword(password, member) {
    const attempted = hashPassword(password, member.salt);
    return crypto.timingSafeEqual(Buffer.from(attempted.passwordHash, "hex"), Buffer.from(member.passwordHash, "hex"));
}

function collectBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function parseForm(buffer) {
    return Object.fromEntries(new URLSearchParams(buffer.toString("utf8")));
}

function parseMultipart(buffer, contentType) {
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
    if (!boundary) return { fields: {}, files: {} };

    const raw = buffer.toString("latin1");
    const parts = raw.split(`--${boundary}`).slice(1, -1);
    const fields = {};
    const files = {};

    parts.forEach((part) => {
        const clean = part.replace(/^\r\n/, "");
        const divider = clean.indexOf("\r\n\r\n");
        if (divider === -1) return;

        const header = clean.slice(0, divider);
        let body = clean.slice(divider + 4);
        if (body.endsWith("\r\n")) body = body.slice(0, -2);

        const name = header.match(/name="([^"]+)"/)?.[1];
        const filename = header.match(/filename="([^"]*)"/)?.[1];
        const mimeType = header.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
        if (!name) return;

        if (filename) {
            files[name] = {
                filename: path.basename(filename),
                mimeType,
                buffer: Buffer.from(body, "latin1")
            };
        } else {
            fields[name] = Buffer.from(body, "latin1").toString("utf8");
        }
    });

    return { fields, files };
}

function safeFileName(originalName) {
    const ext = path.extname(originalName).toLowerCase();
    const base = path.basename(originalName, ext).replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "upload";
    return `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${base}${ext}`;
}

function saveUpload(file, folder, allowedTypes) {
    if (!file || !file.filename || file.buffer.length === 0) return "";
    if (allowedTypes.length && !allowedTypes.some((type) => file.mimeType.startsWith(type))) {
        throw new Error("Unsupported file type.");
    }
    const fileName = safeFileName(file.filename);
    const filePath = path.join(folder, fileName);
    fs.writeFileSync(filePath, file.buffer);
    return `/uploads/${path.basename(folder)}/${fileName}`;
}

function requireLogin(req, res, db) {
    const session = getSession(req, db);
    if (!session) {
        sendJson(res, 401, { error: "Please login first." });
        return null;
    }
    return session;
}

async function handleApi(req, res) {
    const db = readDb();
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/register") {
        const body = await collectBody(req);
        const contentType = req.headers["content-type"] || "";
        const { fields, files } = contentType.includes("multipart/form-data")
            ? parseMultipart(body, contentType)
            : { fields: parseForm(body), files: {} };

        const name = (fields.name || "").trim();
        const email = (fields.email || "").trim().toLowerCase();
        const password = fields.password || "";
        const phone = (fields.phone || "").trim();
        const location = (fields.location || "").trim();
        const role = (fields.role || "Member").trim();
        const bio = (fields.bio || "").trim();

        if (!name || !email || !password) return sendJson(res, 400, { error: "Name, email, and password are required." });
        if (db.members.some((member) => member.email === email)) return sendJson(res, 409, { error: "A member with this email already exists." });

        let profilePicture = "";
        try {
            profilePicture = saveUpload(files.profilePicture, PROFILE_DIR, ["image/"]);
        } catch (error) {
            return sendJson(res, 400, { error: error.message });
        }

        const passwordData = hashPassword(password);
        const member = {
            id: crypto.randomUUID(),
            name,
            email,
            phone,
            location,
            role,
            bio,
            profilePicture,
            visibility: fields.visibility === "private" ? "private" : "public",
            joinedAt: new Date().toISOString(),
            ...passwordData
        };

        db.members.push(member);
        db.notifications.push({
            id: crypto.randomUUID(),
            title: "New member registered",
            message: `${name} joined The Light and Fortress Alliance.`,
            createdAt: new Date().toISOString()
        });
        writeDb(db);
        return sendJson(res, 201, { message: "Registration successful.", member: sanitizeMember(member) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
        const fields = parseForm(await collectBody(req));
        const email = (fields.email || "").trim().toLowerCase();
        const password = fields.password || "";
        const member = db.members.find((item) => item.email === email);
        if (!member || !verifyPassword(password, member)) return sendJson(res, 401, { error: "Invalid email or password." });

        const token = crypto.randomBytes(32).toString("hex");
        db.sessions[token] = { memberId: member.id, createdAt: new Date().toISOString() };
        writeDb(db);
        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Set-Cookie": `lf_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`
        });
        return res.end(JSON.stringify({ message: "Login successful.", member: sanitizeMember(member) }));
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
        const token = getCookie(req, "lf_session");
        if (token) delete db.sessions[token];
        writeDb(db);
        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Set-Cookie": "lf_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
        });
        return res.end(JSON.stringify({ message: "Logged out." }));
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
        const session = getSession(req, db);
        return sendJson(res, 200, { member: session ? sanitizeMember(session.member) : null });
    }

    if (req.method === "GET" && url.pathname === "/api/members") {
        const session = requireLogin(req, res, db);
        if (!session) return;
        const members = db.members
            .filter((member) => member.visibility === "public" || member.id === session.member.id)
            .map(sanitizeMember);
        return sendJson(res, 200, { members });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/members/")) {
        const session = requireLogin(req, res, db);
        if (!session) return;
        const id = url.pathname.split("/").pop();
        const member = db.members.find((item) => item.id === id);
        if (!member || (member.visibility === "private" && member.id !== session.member.id)) return sendJson(res, 404, { error: "Member not found." });
        return sendJson(res, 200, { member: sanitizeMember(member) });
    }

    if (req.method === "POST" && url.pathname === "/api/updates") {
        const session = requireLogin(req, res, db);
        if (!session) return;
        const fields = parseForm(await collectBody(req));
        const title = (fields.title || "").trim();
        const message = (fields.message || "").trim();
        if (!title || !message) return sendJson(res, 400, { error: "Title and message are required." });

        const update = {
            id: crypto.randomUUID(),
            memberId: session.member.id,
            memberName: session.member.name,
            title,
            message,
            createdAt: new Date().toISOString()
        };
        db.updates.unshift(update);
        db.notifications.unshift({
            id: crypto.randomUUID(),
            title: "New update",
            message: `${session.member.name}: ${title}`,
            createdAt: new Date().toISOString()
        });
        writeDb(db);
        return sendJson(res, 201, { message: "Update posted.", update });
    }

    if (req.method === "GET" && url.pathname === "/api/updates") {
        const session = requireLogin(req, res, db);
        if (!session) return;
        return sendJson(res, 200, { updates: db.updates });
    }

    if (req.method === "GET" && url.pathname === "/api/notifications") {
        const session = requireLogin(req, res, db);
        if (!session) return;
        return sendJson(res, 200, { notifications: db.notifications.slice(0, 50) });
    }

    if (req.method === "POST" && url.pathname === "/api/uploads") {
        const session = requireLogin(req, res, db);
        if (!session) return;
        const contentType = req.headers["content-type"] || "";
        if (!contentType.includes("multipart/form-data")) return sendJson(res, 400, { error: "Upload form must use multipart/form-data." });

        const { fields, files } = parseMultipart(await collectBody(req), contentType);
        const title = (fields.title || "").trim() || "Untitled upload";
        let fileUrl = "";
        try {
            fileUrl = saveUpload(files.media, MEDIA_DIR, ["image/", "video/"]);
        } catch (error) {
            return sendJson(res, 400, { error: error.message });
        }
        if (!fileUrl) return sendJson(res, 400, { error: "Please choose an image or video file." });

        const upload = {
            id: crypto.randomUUID(),
            memberId: session.member.id,
            memberName: session.member.name,
            title,
            fileUrl,
            fileType: files.media.mimeType,
            createdAt: new Date().toISOString()
        };
        db.uploads.unshift(upload);
        db.notifications.unshift({
            id: crypto.randomUUID(),
            title: "New media upload",
            message: `${session.member.name} uploaded ${title}.`,
            createdAt: new Date().toISOString()
        });
        writeDb(db);
        return sendJson(res, 201, { message: "Upload saved.", upload });
    }

    if (req.method === "GET" && url.pathname === "/api/uploads") {
        const session = requireLogin(req, res, db);
        if (!session) return;
        return sendJson(res, 200, { uploads: db.uploads });
    }

    sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    const requestedPath = path.normalize(path.join(ROOT, pathname));
    if (!requestedPath.startsWith(ROOT)) return sendJson(res, 403, { error: "Forbidden." });

    fs.stat(requestedPath, (error, stat) => {
        if (error || !stat.isFile()) {
            res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h1>404 - Page not found</h1>");
            return;
        }

        const ext = path.extname(requestedPath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        fs.createReadStream(requestedPath).pipe(res);
    });
}

ensureStorage();

http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
        handleApi(req, res).catch((error) => {
            console.error(error);
            sendJson(res, 500, { error: "Server error." });
        });
        return;
    }

    if (req.url === "/logout") {
        const db = readDb();
        const token = getCookie(req, "lf_session");
        if (token) delete db.sessions[token];
        writeDb(db);
        res.writeHead(302, {
            Location: "/login.html",
            "Set-Cookie": "lf_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
        });
        res.end();
        return;
    }

    serveStatic(req, res);
}).listen(PORT, () => {
    console.log(`The Light and Fortress backend is running at http://localhost:${PORT}`);
});
