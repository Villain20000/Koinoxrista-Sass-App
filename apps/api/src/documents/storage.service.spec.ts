import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { LocalDiskStorage } from './storage.service';

describe('LocalDiskStorage', () => {
  let rootDir: string;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'polykatoikia-docs-'),
    );
    storage = new LocalDiskStorage();
    // Reflect the temp dir (constructor reads DOCS_DIR at instantiation).
    (storage as unknown as { rootDir: string }).rootDir = rootDir;
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('writes, reads and deletes files under the configured directory', async () => {
    const payload = Buffer.from('koinoxrista');

    await storage.put('a/b/file.pdf', payload);
    const readBack = await storage.get('a/b/file.pdf');
    expect(readBack).toEqual(payload);

    const onDisk = await fs.readFile(
      path.join(rootDir, 'a', 'b', 'file.pdf'),
    );
    expect(onDisk).toEqual(payload);

    await storage.remove('a/b/file.pdf');
    await expect(storage.get('a/b/file.pdf')).rejects.toThrow();
  });

  it('falls back to .data/uploads when DOCS_DIR is unset', () => {
    const previous = process.env.DOCS_DIR;
    delete process.env.DOCS_DIR;

    try {
      const fallback = new LocalDiskStorage();
      expect(
        (fallback as unknown as { rootDir: string }).rootDir,
      ).toBe('.data/uploads');
    } finally {
      if (previous !== undefined) process.env.DOCS_DIR = previous;
    }
  });

  it('rejects traversal keys', async () => {
    await expect(storage.get('../escape.txt')).rejects.toThrow();
    await expect(storage.put('/etc/passwd', Buffer.alloc(0))).rejects.toThrow();
  });
});
