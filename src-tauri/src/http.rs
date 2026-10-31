//! 受控 HTTP 出口。
//!
//! 只有白名单 origin 允许发出请求；Authorization / Cookie / x-api-key
//! 只能由本层从 Keychain 注入，前端传入一律拒绝。

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const ALLOWED_ORIGINS: &[&str] = &[
    "https://api.anthropic.com",
    "https://chatgpt.com",
    "https://www.workbuddy.cn",
    "https://www.workbuddy.ai",
    "https://generativelanguage.googleapis.com",
];

const MAX_BODY_BYTES: usize = 512 * 1024;

pub struct HttpClient {
    inner: reqwest::Client,
}

#[derive(Debug, Deserialize)]
pub struct RequestSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    /// 由 Rust 侧从 Keychain 取 token 注入；TS 侧永远拿不到明文。
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_timeout() -> u64 {
    10_000
}

#[derive(Debug, Serialize)]
pub struct Reply {
    pub status: u16,
    pub headers: std::collections::BTreeMap<String, String>,
    pub body: String,
    pub body_truncated: bool,
}

impl HttpClient {
    pub fn new() -> Result<Self> {
        let inner = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("AIHUD/0.1 (macOS)")
            .build()?;
        Ok(Self { inner })
    }

    pub async fn send(&self, spec: RequestSpec) -> Result<Reply> {
        let parsed = url::Url::parse(&spec.url)?;
        let origin = format!(
            "{}://{}",
            parsed.scheme(),
            parsed.host_str().unwrap_or_default()
        );
        if !ALLOWED_ORIGINS.contains(&origin.as_str()) {
            bail!("origin 不在白名单: {origin}");
        }
        if parsed.scheme() != "https" {
            bail!("只允许 https");
        }

        let method = reqwest::Method::from_bytes(spec.method.to_uppercase().as_bytes())?;
        let mut req = self
            .inner
            .request(method, parsed)
            .timeout(Duration::from_millis(spec.timeout_ms.min(30_000)));

        for (k, v) in &spec.headers {
            let lower = k.to_lowercase();
            if matches!(lower.as_str(), "authorization" | "cookie" | "x-api-key") {
                bail!("禁止前端设置敏感头: {k}");
            }
            req = req.header(k, v);
        }

        // 由 Rust 注入凭据
        if let (Some(account_id), Some(provider)) = (spec.account_id, spec.provider) {
            if let Some(lease) = crate::keychain::probe(&account_id, &provider)? {
                if lease.has_secret {
                    if let Ok(secret) = crate::keychain::read_secret(&account_id, &provider) {
                        req = req.bearer_auth(secret);
                    }
                }
            }
        }

        let resp = req.send().await?;
        let status = resp.status().as_u16();
        let mut headers = std::collections::BTreeMap::new();
        for (k, v) in resp.headers() {
            if let Ok(s) = v.to_str() {
                headers.insert(k.to_string(), s.to_string());
            }
        }
        let bytes = resp.bytes().await?;
        let truncated = bytes.len() > MAX_BODY_BYTES;
        let slice = &bytes[..bytes.len().min(MAX_BODY_BYTES)];
        Ok(Reply {
            status,
            headers,
            body: String::from_utf8_lossy(slice).to_string(),
            body_truncated: truncated,
        })
    }
}

