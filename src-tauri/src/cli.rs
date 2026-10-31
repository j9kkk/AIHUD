//! 子进程桥：只允许白名单命令（gemini 的 agy CLI 取数通道）。

use anyhow::{bail, Result};
use serde::Serialize;
use std::time::Duration;

pub const ALLOWED_COMMANDS: &[&str] = &["agy", "gemini"];

#[derive(Debug, Serialize)]
pub struct CliOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

pub async fn run(cmd: String, args: Vec<String>, timeout_ms: u64) -> Result<CliOutput> {
    if !ALLOWED_COMMANDS.contains(&cmd.as_str()) {
        bail!("命令不在白名单: {cmd}");
    }
    for a in &args {
        if a.contains("&&") || a.contains(';') || a.contains('|') || a.contains('$') {
            bail!("参数包含非法字符");
        }
    }

    let fut = tokio::process::Command::new(&cmd)
        .args(&args)
        .env_clear()
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .output();

    match tokio::time::timeout(Duration::from_millis(timeout_ms.min(20_000)), fut).await {
        Ok(Ok(out)) => Ok(CliOutput {
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(anyhow::anyhow!("子进程启动失败: {e}")),
        Err(_) => Ok(CliOutput {
            code: -1,
            stdout: String::new(),
            stderr: "timeout".into(),
            timed_out: true,
        }),
    }
}

