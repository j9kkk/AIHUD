//! Keychain 访问层。
//!
//! 约定（ARCHITECTURE §7）：
//! - service 固定 `app.aihud.desktop`，account 为 `<provider>/<account_id>`；
//! - 只暴露「存在/租约」两种结果，明文 token 不出本进程内存；
//! - 删除必须幂等。

use anyhow::{Context, Result};
use serde::Serialize;

const SERVICE: &str = "app.aihud.desktop";

fn entry(account_id: &str, provider: &str) -> Result<keyring::Entry> {
    let user = format!("{provider}/{account_id}");
    keyring::Entry::new(SERVICE, &user).context("创建 Keychain 条目失败")
}

#[derive(Debug, Serialize)]
pub struct LeaseInfo {
    pub lease_id: String,
    pub revision: String,
    pub has_secret: bool,
}

/// 探测凭据是否可读，返回不透明的 revision（凭据指纹），不含任何明文。
pub fn probe(account_id: &str, provider: &str) -> Result<Option<LeaseInfo>> {
    let e = entry(account_id, provider)?;
    match e.get_password() {
        Ok(secret) => {
            let revision = short_hash(&secret);
            Ok(Some(LeaseInfo {
                lease_id: format!("lease_{}", uuid_like(&revision)),
                revision,
                has_secret: true,
            }))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(anyhow::anyhow!("Keychain 读取失败: {err}")),
    }
}

/// 仅供壳层内部（http 注入）使用；不得暴露为 IPC 命令。
pub(crate) fn read_secret(account_id: &str, provider: &str) -> Result<String> {
    entry(account_id, provider)?
        .get_password()
        .context("Keychain 读取明文失败")
}

pub fn write(account_id: &str, provider: &str, secret: &str) -> Result<()> {
    entry(account_id, provider)?
        .set_password(secret)
        .context("Keychain 写入失败")
}

pub fn delete(account_id: &str, provider: &str) -> Result<bool> {
    match entry(account_id, provider)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(anyhow::anyhow!("Keychain 删除失败: {err}")),
    }
}

/// 16 位十六进制指纹；只用于版本比对，不可逆推明文。
fn short_hash(secret: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    secret.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn uuid_like(seed: &str) -> String {
    let mut s = seed.to_string();
    while s.len() < 12 {
        s.push('0');
    }
    s[..12].to_string()
}

