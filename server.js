// server/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { db } = require("./db");
require("dotenv").config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

// =============== MULTER CONFIG ===============
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + file.originalname;
    cb(null, unique);
  },
});
const upload = multer({ storage });

// =============== MEMORY STORAGE FILE META ===============
let files = {};

// =============== USER ENDPOINTS ===============

// Register
app.post("/register", (req, res) => {
  const { username, email, password } = req.body;

  db.query(
    "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
    [username, email, password],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: "User berhasil terdaftar" });
    }
  );
});

// Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.length === 0)
        return res.status(401).json({ success: false, message: "Login gagal" });

      res.json({ success: true, user: result[0] });
    }
  );
});

// User sementara berdasarkan IP/device
app.post("/user/temp", (req, res) => {
  const { ip, device_info } = req.body;

  db.query(
    "SELECT * FROM users WHERE ip_address = ? AND is_temp = 1",
    [ip],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      if (result.length > 0) return res.json({ user: result[0] });

      db.query(
        "INSERT INTO users (username, ip_address, device_info, is_temp) VALUES (?, ?, ?, 1)",
        ["Guest_" + Date.now(), ip, device_info],
        (err2, result2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          db.query(
            "SELECT * FROM users WHERE id = ?",
            [result2.insertId],
            (err3, newUser) => {
              if (err3) return res.status(500).json({ error: err3.message });
              res.json({ user: newUser[0] });
            }
          );
        }
      );
    }
  );
});

// =============== FILE UPLOAD/DOWNLOAD ===============

// Upload
app.post("/upload", upload.single("file"), (req, res) => {
  const { user_id } = req.body;
  const file = req.file;
  if (!file) return res.status(400).send("Tidak ada file yang diupload.");

  const code = crypto.randomBytes(3).toString("hex").toUpperCase();

  // simpan metadata di memory
  files[code] = {
    filename: file.originalname,
    path: file.path,
    uploadedAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 60 * 1000, // 5 jam
  };

  // Simpan ke database
  db.query(
    "INSERT INTO file_records (user_id, file_name, file_code) VALUES (?, ?, ?)",
    [user_id || null, file.originalname, code]
  );

  res.json({ code, filename: file.originalname });
});

// Download
app.get("/download/:code", (req, res) => {
  const code = req.params.code;
  const data = files[code];
  if (!data) return res.status(404).send("File tidak ditemukan.");

  // update counter
  db.query(
    "UPDATE file_records SET download_count = download_count + 1 WHERE file_code = ?",
    [code]
  );

  res.download(data.path, data.filename);
});

// Riwayat file user
app.get("/records/:user_id", (req, res) => {
  db.query(
    "SELECT * FROM file_records WHERE user_id = ? ORDER BY id DESC",
    [req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(result);
    }
  );
});

// =============== AUTO DELETE FILE ===============
setInterval(() => {
  const now = Date.now();
  Object.keys(files).forEach((code) => {
    if (files[code].expiresAt < now) {
      fs.unlinkSync(files[code].path);
      delete files[code];
      console.log(`File ${code} dihapus otomatis`);
    }
  });
}, 10 * 60 * 1000); // setiap 10 menit

app.listen(PORT, () => console.log(`✅ Server berjalan di http://localhost:${PORT}`));
