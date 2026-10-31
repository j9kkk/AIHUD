//! SQLite 快照存储（不含任何密钥）。
//!
//! 表结构见 ARCHITECTURE §7 / §3.9：
//! - snapshots(account_id TEXT PRIMARY KEY, payload TEXT, updated_at INTEGER)
//! - usage_samples(account_id TEXT, hour_key TEXT, calls INTEGER, limits INTEGER, PRIMARY KEY(account_id, hour_key))

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(app: &tauri::AppHandle) -> Result<Self> {
        use tauri::Manager;
        let dir: PathBuf = app
            .path()
            .app_data_dir()
            .context("无法解析 appDataDir")?;
        std::fs::create_dir_all(&dir).ok();
        let db = dir.join("ai-hud.db");
        let conn = Connection::open(&db).with_context(|| format!("打开数据库失败: {}", db.display()))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS snapshots (
               account_id TEXT PRIMARY KEY,
               payload    TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS usage_samples (
               account_id TEXT NOT NULL,
               hour_key   TEXT NOT NULL,
               calls      INTEGER NOT NULL,
               limits     INTEGER NOT NULL,
               PRIMARY KEY (account_id, hour_key)
             );
             CREATE TABLE IF NOT EXISTS meta (
               k TEXT PRIMARY KEY,
               v TEXT NOT NULL
             );",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn load_snapshots(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT account_id, payload, updated_at FROM snapshots ORDER BY account_id")?;
        let rows = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "account_id": r.get::<_, String>(0)?,
                "payload": r.get::<_, String>(1)?,
                "updated_at": r.get::<_, i64>(2)?,
            }))
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(serde_json::to_string(&out)?)
    }

    /// 只接受数组；每条必须有 account_id 与 payload 字符串，其余字段忽略。
    pub fn save_snapshots(&self, raw: &str) -> Result<usize> {
        let parsed: serde_json::Value = serde_json::from_str(raw)?;
        let arr = parsed.as_array().context("payload 必须是数组")?;
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let mut n = 0usize;
        for item in arr {
            let id = item.get("account_id").and_then(|v| v.as_str()).context("缺 account_id")?;
            let payload = item.get("payload").and_then(|v| v.as_str()).context("缺 payload")?;
            let ts = item.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0);
            tx.execute(
                "INSERT INTO snapshots(account_id, payload, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
                rusqlite::params![id, payload, ts],
            )?;
            n += 1;
        }
        tx.commit()?;
        Ok(n)
    }
}

