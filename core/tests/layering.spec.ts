import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FORBIDDEN_PROVIDERS = ['claude', 'codex', 'workbuddy', 'gemini'];

function findFiles(dir: string, extensions: string[] = ['.ts', '.js']): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 去除代码中的注释（多行注释与单行注释），避免注释中的说明文字被误扫
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * 检查代码文本中是否包含指定字面量（作为完整标识符或字符串字面量）
 */
function findForbiddenOccurrences(content: string, forbidden: string[]): string[] {
  const code = stripComments(content);
  const found: string[] = [];
  for (const item of forbidden) {
    // 匹配引号中的字面量，或作为独立标识符/单词
    const regex = new RegExp(`['"\`]?\\b${item}\\b['"\`]?`, 'i');
    if (regex.test(code)) {
      found.push(item);
    }
  }
  return found;
}

describe('分层契约与静态扫描 (Layering Invariants)', () => {
  const coreSrcDir = path.resolve(__dirname, '../src');

  describe('静态扫描：presentation 目录下不得出现 provider 字面量', () => {
    it('core/src/presentation 目录下零 provider 字面量', () => {
      const presentationDir = path.join(coreSrcDir, 'presentation');
      const files = findFiles(presentationDir);
      expect(files.length).toBeGreaterThan(0);

      const violations: { file: string; forbidden: string[] }[] = [];
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const found = findForbiddenOccurrences(content, FORBIDDEN_PROVIDERS);
        if (found.length > 0) {
          violations.push({ file: path.relative(coreSrcDir, file), forbidden: found });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('静态扫描：scheduler 目录下不得出现 provider 字面量', () => {
    it('core/src/scheduler 目录下零 provider 字面量（若存在）', () => {
      const schedulerDir = path.join(coreSrcDir, 'scheduler');
      const files = findFiles(schedulerDir);

      const violations: { file: string; forbidden: string[] }[] = [];
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const found = findForbiddenOccurrences(content, FORBIDDEN_PROVIDERS);
        if (found.length > 0) {
          violations.push({ file: path.relative(coreSrcDir, file), forbidden: found });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('静态扫描：domain 逻辑层（health.ts / visual.ts / format.ts / redact.ts）不得出现 provider 字面量', () => {
    it('健康状态机与领域计算工具零 provider 分支', () => {
      const targetFiles = [
        path.join(coreSrcDir, 'domain/health.ts'),
        path.join(coreSrcDir, 'domain/visual.ts'),
        path.join(coreSrcDir, 'domain/format.ts'),
        path.join(coreSrcDir, 'domain/redact.ts'),
        path.join(coreSrcDir, 'domain/index.ts'),
      ];

      const violations: { file: string; forbidden: string[] }[] = [];
      for (const file of targetFiles) {
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, 'utf-8');
        const found = findForbiddenOccurrences(content, FORBIDDEN_PROVIDERS);
        if (found.length > 0) {
          violations.push({ file: path.relative(coreSrcDir, file), forbidden: found });
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('静态扫描：bootstrap 装配零 provider 字面量', () => {
    it('core/src/bootstrap.ts 纯依赖注入，零具体渠道硬编码', () => {
      const bootstrapFile = path.join(coreSrcDir, 'bootstrap.ts');
      expect(fs.existsSync(bootstrapFile)).toBe(true);

      const content = fs.readFileSync(bootstrapFile, 'utf-8');
      const found = findForbiddenOccurrences(content, FORBIDDEN_PROVIDERS);
      expect(found).toEqual([]);
    });
  });

  describe('分层依赖规则（docs/ARCHITECTURE.md 9.2）：presentation 仅依赖 domain', () => {
    it('presentation 目录下的文件禁止 import drivers 或 scheduler', () => {
      const presentationDir = path.join(coreSrcDir, 'presentation');
      const files = findFiles(presentationDir);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        expect(content).not.toMatch(/from\s+['"].*drivers/);
        expect(content).not.toMatch(/from\s+['"].*scheduler/);
      }
    });
  });
});
